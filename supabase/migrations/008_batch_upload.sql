-- ============================================
-- Migration 008: Batch Upload + Sequential Review Queue
-- ============================================
-- This migration adds:
-- 1. tender_batches table for batch sessions
-- 2. tender_batch_items table for items in a batch
-- 3. Indexes for efficient queries
-- 4. RLS policies
-- ============================================

-- ============================================
-- 1. TENDER BATCHES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS tender_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  current_index INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user's batches
CREATE INDEX IF NOT EXISTS idx_tender_batches_created_by ON tender_batches(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tender_batches_status ON tender_batches(status) WHERE status = 'active';

-- ============================================
-- 2. TENDER BATCH ITEMS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS tender_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES tender_batches(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'file' CHECK (source_type IN ('file', 'paste')),
  "position" INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'needs_review', 'reviewed', 'skipped', 'failed')),
  deduped BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure unique position within batch
  CONSTRAINT tender_batch_items_batch_position_unique UNIQUE (batch_id, "position")
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_tender_batch_items_batch ON tender_batch_items(batch_id, "position");
CREATE INDEX IF NOT EXISTS idx_tender_batch_items_batch_state ON tender_batch_items(batch_id, state);
CREATE INDEX IF NOT EXISTS idx_tender_batch_items_tender ON tender_batch_items(tender_id);

-- ============================================
-- 3. RLS POLICIES
-- ============================================

ALTER TABLE tender_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_batch_items ENABLE ROW LEVEL SECURITY;

-- Batch policies: only creator can access their batches
DROP POLICY IF EXISTS "Users can read own batches" ON tender_batches;
CREATE POLICY "Users can read own batches" ON tender_batches
  FOR SELECT USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can create own batches" ON tender_batches;
CREATE POLICY "Users can create own batches" ON tender_batches
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can update own batches" ON tender_batches;
CREATE POLICY "Users can update own batches" ON tender_batches
  FOR UPDATE USING (created_by = auth.uid());

-- Batch items policies: access through batch ownership
DROP POLICY IF EXISTS "Users can read own batch items" ON tender_batch_items;
CREATE POLICY "Users can read own batch items" ON tender_batch_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tender_batches 
      WHERE tender_batches.id = tender_batch_items.batch_id 
      AND tender_batches.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create batch items for own batches" ON tender_batch_items;
CREATE POLICY "Users can create batch items for own batches" ON tender_batch_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tender_batches 
      WHERE tender_batches.id = tender_batch_items.batch_id 
      AND tender_batches.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own batch items" ON tender_batch_items;
CREATE POLICY "Users can update own batch items" ON tender_batch_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM tender_batches 
      WHERE tender_batches.id = tender_batch_items.batch_id 
      AND tender_batches.created_by = auth.uid()
    )
  );

-- ============================================
-- 4. UPDATED_AT TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_tender_batches_updated_at ON tender_batches;
CREATE TRIGGER update_tender_batches_updated_at
  BEFORE UPDATE ON tender_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tender_batch_items_updated_at ON tender_batch_items;
CREATE TRIGGER update_tender_batch_items_updated_at
  BEFORE UPDATE ON tender_batch_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. HELPER FUNCTIONS
-- ============================================

-- Get the next reviewable item in a batch
CREATE OR REPLACE FUNCTION get_next_batch_item(
  p_batch_id UUID,
  p_from_index INTEGER DEFAULT 0
)
RETURNS TABLE (
  item_id UUID,
  tender_id UUID,
  item_position INTEGER,
  item_state TEXT,
  item_file_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tbi.id AS item_id,
    tbi.tender_id,
    tbi."position" AS item_position,
    tbi.state AS item_state,
    tbi.file_name AS item_file_name
  FROM tender_batch_items tbi
  WHERE tbi.batch_id = p_batch_id
    AND tbi."position" >= p_from_index
    AND tbi.state NOT IN ('reviewed', 'skipped', 'failed')
  ORDER BY tbi."position"
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get batch summary counts
CREATE OR REPLACE FUNCTION get_batch_summary(p_batch_id UUID)
RETURNS TABLE (
  total INTEGER,
  ready INTEGER,
  needs_review INTEGER,
  reviewed INTEGER,
  skipped INTEGER,
  failed INTEGER,
  deduped INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER AS total,
    COUNT(*) FILTER (WHERE state = 'ready')::INTEGER AS ready,
    COUNT(*) FILTER (WHERE state = 'needs_review')::INTEGER AS needs_review,
    COUNT(*) FILTER (WHERE state = 'reviewed')::INTEGER AS reviewed,
    COUNT(*) FILTER (WHERE state = 'skipped')::INTEGER AS skipped,
    COUNT(*) FILTER (WHERE state = 'failed')::INTEGER AS failed,
    COUNT(*) FILTER (WHERE deduped = true)::INTEGER AS deduped
  FROM tender_batch_items
  WHERE batch_id = p_batch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE tender_batches IS 'Batch upload sessions for processing multiple tenders sequentially';
COMMENT ON TABLE tender_batch_items IS 'Individual items within a batch upload session';
COMMENT ON COLUMN tender_batches.current_index IS 'Current position in the review queue (0-based)';
COMMENT ON COLUMN tender_batch_items."position" IS 'Order in batch (0-based), matches user selection order';
COMMENT ON COLUMN tender_batch_items.state IS 'ready=pending, needs_review=extracted with warnings, reviewed=completed, skipped=user skipped, failed=extraction error';
COMMENT ON COLUMN tender_batch_items.deduped IS 'True if this file was a duplicate of an existing tender';
