-- Migration 009: Fix deduplication functions to handle NULL customer_id
-- 
-- The original functions use customer_id = p_customer_id which fails when both are NULL
-- because in SQL, NULL = NULL evaluates to FALSE.
-- 
-- Fix: Use IS NOT DISTINCT FROM which treats NULL = NULL as TRUE.

-- Fix the file hash deduplication function
CREATE OR REPLACE FUNCTION find_duplicate_tender_by_file_hash(
  p_customer_id UUID,
  p_file_hash TEXT,
  p_window_days INTEGER DEFAULT 7
)
RETURNS UUID AS $$
DECLARE
  v_tender_id UUID;
BEGIN
  SELECT id INTO v_tender_id
  FROM tenders
  WHERE customer_id IS NOT DISTINCT FROM p_customer_id
    AND file_hash = p_file_hash
    AND created_at > NOW() - (p_window_days || ' days')::INTERVAL
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_tender_id;
END;
$$ LANGUAGE plpgsql;

-- Fix the text hash deduplication function
CREATE OR REPLACE FUNCTION find_duplicate_tender_by_text_hash(
  p_customer_id UUID,
  p_text_hash TEXT,
  p_window_days INTEGER DEFAULT 7
)
RETURNS UUID AS $$
DECLARE
  v_tender_id UUID;
BEGIN
  SELECT id INTO v_tender_id
  FROM tenders
  WHERE customer_id IS NOT DISTINCT FROM p_customer_id
    AND text_hash = p_text_hash
    AND created_at > NOW() - (p_window_days || ' days')::INTERVAL
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_tender_id;
END;
$$ LANGUAGE plpgsql;

-- Also add an index to support NULL customer_id deduplication
CREATE INDEX IF NOT EXISTS idx_tenders_file_hash_null_customer ON tenders(file_hash)
  WHERE file_hash IS NOT NULL AND customer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenders_text_hash_null_customer ON tenders(text_hash)
  WHERE text_hash IS NOT NULL AND customer_id IS NULL;

COMMENT ON FUNCTION find_duplicate_tender_by_file_hash IS 'Find existing tender with same file hash within window (handles NULL customer_id)';
COMMENT ON FUNCTION find_duplicate_tender_by_text_hash IS 'Find existing tender with same text hash within window (handles NULL customer_id)';
