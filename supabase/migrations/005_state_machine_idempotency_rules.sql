-- ============================================
-- Migration 005: State Machine, Idempotency, Locks, Rules
-- ============================================
-- This migration adds:
-- 1. Updated tender status values
-- 2. Processing lock columns on tenders
-- 3. idempotency_keys table
-- 4. export_attempts table
-- 5. customer_rules table with lifecycle
-- ============================================

-- ============================================
-- 1. UPDATE TENDER STATUS VALUES
-- ============================================

-- Drop and recreate the check constraint with new values
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_status_check;

-- Add new status constraint
ALTER TABLE tenders ADD CONSTRAINT tenders_status_check 
  CHECK (status IN ('draft', 'extracted', 'needs_review', 'reviewed', 'export_pending', 'exported', 'export_failed'));

-- Migrate existing statuses
UPDATE tenders SET status = 'needs_review' WHERE status = 'draft';
-- 'reviewed' stays as 'reviewed'
-- 'exported' stays as 'exported'
-- 'cancelled' -> 'export_failed' (closest equivalent)
UPDATE tenders SET status = 'export_failed' WHERE status = 'cancelled';

-- Remove old export_status column if it exists (we're using status now)
ALTER TABLE tenders DROP COLUMN IF EXISTS export_status;

-- ============================================
-- 2. PROCESSING LOCK COLUMNS ON TENDERS
-- ============================================

ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lock_reason TEXT DEFAULT NULL;

-- Index for finding locked tenders
CREATE INDEX IF NOT EXISTS idx_tenders_locked ON tenders(locked_at) WHERE locked_at IS NOT NULL;

-- ============================================
-- 3. IDEMPOTENCY KEYS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint on key + route
  CONSTRAINT idempotency_keys_unique UNIQUE (key, route)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(created_at);

-- Auto-cleanup old idempotency keys (older than 24 hours)
-- This can be run as a scheduled job
CREATE OR REPLACE FUNCTION cleanup_old_idempotency_keys()
RETURNS void AS $$
BEGIN
  DELETE FROM idempotency_keys 
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. EXPORT ATTEMPTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS export_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'live')),
  provider TEXT NOT NULL,
  request_payload JSONB,
  mapped_payload JSONB,
  response_payload JSONB,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  error_code TEXT,
  external_id TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_export_attempts_tender ON export_attempts(tender_id);
CREATE INDEX IF NOT EXISTS idx_export_attempts_created ON export_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_attempts_status ON export_attempts(status);

-- ============================================
-- 5. CUSTOMER RULES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS customer_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  
  -- Rule definition
  rule_type TEXT NOT NULL CHECK (rule_type IN ('label_map', 'regex_map', 'cargo_hint')),
  pattern TEXT NOT NULL,  -- For label_map: the label, for regex_map: the regex pattern
  target_value TEXT NOT NULL,  -- The mapped value (subtype, commodity, etc.)
  description TEXT,
  
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'deprecated')),
  
  -- Audit
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  deprecated_by UUID REFERENCES auth.users(id),
  deprecated_at TIMESTAMPTZ,
  
  -- Source tracking
  learned_from_tender UUID REFERENCES tenders(id),
  confidence NUMERIC(3,2) DEFAULT 0.5,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_rules_customer ON customer_rules(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_rules_status ON customer_rules(status);
CREATE INDEX IF NOT EXISTS idx_customer_rules_type ON customer_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_customer_rules_active ON customer_rules(customer_id, status) WHERE status = 'active';

-- ============================================
-- 6. RLS POLICIES FOR NEW TABLES
-- ============================================

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_rules ENABLE ROW LEVEL SECURITY;

-- Idempotency keys: created by server, readable by authenticated users
CREATE POLICY "Auth users can read idempotency_keys" ON idempotency_keys
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Export attempts: readable by authenticated users
CREATE POLICY "Auth users can read export_attempts" ON export_attempts
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Customer rules: readable by all authenticated, writeable by admins
CREATE POLICY "Auth users can read customer_rules" ON customer_rules
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert customer_rules" ON customer_rules
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update customer_rules" ON customer_rules
  FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admins can delete customer_rules" ON customer_rules
  FOR DELETE USING (public.is_admin());

-- ============================================
-- 7. UPDATED_AT TRIGGER FOR CUSTOMER_RULES
-- ============================================

CREATE TRIGGER update_customer_rules_updated_at
  BEFORE UPDATE ON customer_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 8. HELPER FUNCTION TO GET ACTIVE RULES
-- ============================================

CREATE OR REPLACE FUNCTION get_active_customer_rules(p_customer_id UUID)
RETURNS TABLE (
  id UUID,
  rule_type TEXT,
  pattern TEXT,
  target_value TEXT,
  confidence NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT cr.id, cr.rule_type, cr.pattern, cr.target_value, cr.confidence
  FROM customer_rules cr
  WHERE cr.customer_id = p_customer_id
    AND cr.status = 'active'
  ORDER BY cr.confidence DESC, cr.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE idempotency_keys IS 'Stores idempotency keys for safe API retries';
COMMENT ON TABLE export_attempts IS 'Audit log for all export attempts (dry_run and live)';
COMMENT ON TABLE customer_rules IS 'Customer-specific rules with lifecycle management';

COMMENT ON COLUMN tenders.locked_at IS 'Timestamp when lock was acquired';
COMMENT ON COLUMN tenders.locked_by IS 'User who holds the lock';
COMMENT ON COLUMN tenders.lock_reason IS 'Reason for the lock (reprocessing, exporting, etc.)';

COMMENT ON COLUMN customer_rules.rule_type IS 'Type of rule: label_map, regex_map, or cargo_hint';
COMMENT ON COLUMN customer_rules.pattern IS 'The pattern to match (label text or regex)';
COMMENT ON COLUMN customer_rules.target_value IS 'The value to map to (reference subtype, commodity, etc.)';
COMMENT ON COLUMN customer_rules.status IS 'Lifecycle status: proposed (needs approval), active (in use), deprecated (disabled)';
