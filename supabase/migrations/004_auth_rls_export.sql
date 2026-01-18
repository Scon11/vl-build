-- ============================================
-- Migration 004: Auth, RLS, Export Layer
-- ============================================
-- This migration adds:
-- 1. user_profiles table with roles
-- 2. Audit columns to all tables
-- 3. Tender state machine / export columns
-- 4. export_logs table for audit trail
-- 5. RLS policies for all tables
-- ============================================

-- ============================================
-- 1. USER PROFILES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for role-based lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- Trigger to auto-create user_profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 2. AUDIT COLUMNS ON EXISTING TABLES
-- ============================================

-- Tenders: add created_by, updated_by, reviewed_by, exported_by
ALTER TABLE tenders 
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS exported_by UUID REFERENCES auth.users(id);

-- Tenders: add export state columns
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS export_status TEXT DEFAULT NULL 
    CHECK (export_status IS NULL OR export_status IN (
      'pending', 'in_progress', 'completed', 'failed', 'cancelled'
    )),
  ADD COLUMN IF NOT EXISTS export_provider TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS export_external_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS export_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_export_attempt_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ DEFAULT NULL;

-- Tenders: add original_file_path for private storage
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS original_file_path TEXT DEFAULT NULL;

-- Create index on export_status for efficient queries
CREATE INDEX IF NOT EXISTS idx_tenders_export_status ON tenders(export_status);

-- Final_fields: update reviewed_by to UUID and add updated_by
-- First, drop the old column if it's TEXT and recreate as UUID
DO $$ 
BEGIN
  -- Check if reviewed_by column exists and is TEXT type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'final_fields' 
    AND column_name = 'reviewed_by' 
    AND data_type = 'text'
  ) THEN
    ALTER TABLE final_fields DROP COLUMN reviewed_by;
    ALTER TABLE final_fields ADD COLUMN reviewed_by UUID REFERENCES auth.users(id);
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'final_fields' 
    AND column_name = 'reviewed_by'
  ) THEN
    ALTER TABLE final_fields ADD COLUMN reviewed_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

ALTER TABLE final_fields 
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Extraction_runs: add created_by
ALTER TABLE extraction_runs 
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- Customer_profiles: add updated_by
ALTER TABLE customer_profiles 
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Learning_events: add created_by (only if table exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_events') THEN
    ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- ============================================
-- 3. EXPORT LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS export_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  
  -- Export details
  provider TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'dry_run', 'export', 'retry', 'cancel', 'rollback'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'success', 'failed', 'cancelled'
  )),
  
  -- Idempotency
  idempotency_key TEXT UNIQUE,
  
  -- Request/Response data (for debugging)
  request_payload JSONB,
  response_payload JSONB,
  error_message TEXT,
  error_code TEXT,
  
  -- External reference
  external_id TEXT,
  
  -- Audit
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Performance tracking
  duration_ms INTEGER
);

-- Indexes for export_logs
CREATE INDEX IF NOT EXISTS idx_export_logs_tender ON export_logs(tender_id);
CREATE INDEX IF NOT EXISTS idx_export_logs_created_at ON export_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_logs_status ON export_logs(status);
CREATE INDEX IF NOT EXISTS idx_export_logs_idempotency ON export_logs(idempotency_key);

-- ============================================
-- 4. RULE LIFECYCLE COLUMNS
-- ============================================

-- Add lifecycle columns to customer_profiles for rule management
ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS rules_last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rules_last_reviewed_by UUID REFERENCES auth.users(id);

-- We'll track rule status within the JSONB arrays themselves
-- Each rule can have: { ..., status: "active" | "disabled" | "pending_review", disabled_at, disabled_by }

-- ============================================
-- 5. RLS POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE final_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
-- Only enable RLS on learning_events if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_events') THEN
    ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
ALTER TABLE export_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM user_profiles WHERE id = auth.uid();
  RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- USER_PROFILES POLICIES
-- ============================================

-- Users can read their own profile
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT USING (id = auth.uid());

-- Users can update their own profile (but not role)
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM user_profiles WHERE id = auth.uid()));

-- Admins can read all profiles
DROP POLICY IF EXISTS "Admins can read all profiles" ON user_profiles;
CREATE POLICY "Admins can read all profiles" ON user_profiles
  FOR SELECT USING (public.is_admin());

-- Admins can update all profiles
DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;
CREATE POLICY "Admins can update all profiles" ON user_profiles
  FOR UPDATE USING (public.is_admin());

-- ============================================
-- TENDERS POLICIES
-- ============================================

-- Authenticated users can read all tenders
DROP POLICY IF EXISTS "Users can read tenders" ON tenders;
CREATE POLICY "Users can read tenders" ON tenders
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Authenticated users can create tenders
DROP POLICY IF EXISTS "Users can create tenders" ON tenders;
CREATE POLICY "Users can create tenders" ON tenders
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Authenticated users can update tenders
DROP POLICY IF EXISTS "Users can update tenders" ON tenders;
CREATE POLICY "Users can update tenders" ON tenders
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================
-- EXTRACTION_RUNS POLICIES
-- ============================================

-- Authenticated users can read all extraction runs
DROP POLICY IF EXISTS "Users can read extraction_runs" ON extraction_runs;
CREATE POLICY "Users can read extraction_runs" ON extraction_runs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Authenticated users can create extraction runs
DROP POLICY IF EXISTS "Users can create extraction_runs" ON extraction_runs;
CREATE POLICY "Users can create extraction_runs" ON extraction_runs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- FINAL_FIELDS POLICIES
-- ============================================

-- Authenticated users can read all final fields
DROP POLICY IF EXISTS "Users can read final_fields" ON final_fields;
CREATE POLICY "Users can read final_fields" ON final_fields
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Authenticated users can create/update final fields
DROP POLICY IF EXISTS "Users can create final_fields" ON final_fields;
CREATE POLICY "Users can create final_fields" ON final_fields
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update final_fields" ON final_fields;
CREATE POLICY "Users can update final_fields" ON final_fields
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================
-- CUSTOMER_PROFILES POLICIES
-- ============================================

-- All authenticated users can read customer profiles
DROP POLICY IF EXISTS "Users can read customer_profiles" ON customer_profiles;
CREATE POLICY "Users can read customer_profiles" ON customer_profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins can create customer profiles
DROP POLICY IF EXISTS "Admins can create customer_profiles" ON customer_profiles;
CREATE POLICY "Admins can create customer_profiles" ON customer_profiles
  FOR INSERT WITH CHECK (public.is_admin());

-- Only admins can update customer profiles (including rules)
DROP POLICY IF EXISTS "Admins can update customer_profiles" ON customer_profiles;
CREATE POLICY "Admins can update customer_profiles" ON customer_profiles
  FOR UPDATE USING (public.is_admin());

-- Only admins can delete customer profiles
DROP POLICY IF EXISTS "Admins can delete customer_profiles" ON customer_profiles;
CREATE POLICY "Admins can delete customer_profiles" ON customer_profiles
  FOR DELETE USING (public.is_admin());

-- ============================================
-- LEARNING_EVENTS POLICIES (only if table exists)
-- ============================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_events') THEN
    -- Authenticated users can read learning events
    DROP POLICY IF EXISTS "Users can read learning_events" ON learning_events;
    CREATE POLICY "Users can read learning_events" ON learning_events
      FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- Learning events are created by server (service role), so no INSERT policy for regular users
-- The service role bypasses RLS

-- ============================================
-- EXPORT_LOGS POLICIES
-- ============================================

-- Authenticated users can read export logs
DROP POLICY IF EXISTS "Users can read export_logs" ON export_logs;
CREATE POLICY "Users can read export_logs" ON export_logs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Export logs are created by server (service role), so no INSERT policy for regular users
-- The service role bypasses RLS

-- ============================================
-- STORAGE POLICIES (for tender-files bucket)
-- ============================================
-- Note: These need to be applied via Supabase Dashboard or separate migration
-- The tender-files bucket should be set to PRIVATE
-- Policies:
-- - Authenticated users can upload files
-- - Authenticated users can read files via signed URLs

-- ============================================
-- UPDATE TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables that have updated_at
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_customer_profiles_updated_at ON customer_profiles;
CREATE TRIGGER update_customer_profiles_updated_at
  BEFORE UPDATE ON customer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_final_fields_updated_at ON final_fields;
CREATE TRIGGER update_final_fields_updated_at
  BEFORE UPDATE ON final_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE user_profiles IS 'User profiles with role-based access control';
COMMENT ON TABLE export_logs IS 'Audit log for all export operations';
COMMENT ON COLUMN tenders.export_status IS 'Current export state: pending, in_progress, completed, failed, cancelled';
COMMENT ON COLUMN tenders.export_provider IS 'Provider used for export (e.g., mcleod, dry_run)';
COMMENT ON COLUMN tenders.export_external_id IS 'External system ID returned from export';
COMMENT ON COLUMN tenders.original_file_path IS 'Path in private storage bucket (replaces public URL)';
COMMENT ON FUNCTION public.is_admin() IS 'Check if current user has admin role';
