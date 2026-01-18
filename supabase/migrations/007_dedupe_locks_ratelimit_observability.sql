-- ============================================
-- Migration 007: Deduplication, Rate Limiting, Observability
-- ============================================
-- This migration adds:
-- 1. File/text hash columns for deduplication
-- 2. Rate limiting table
-- 3. LLM usage tracking table
-- 4. Indexes for efficient lookups
-- ============================================

-- ============================================
-- 1. DEDUPLICATION COLUMNS ON TENDERS
-- ============================================

-- Add hash columns for deduplication
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS file_hash TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS text_hash TEXT DEFAULT NULL;

-- Create partial unique index for file deduplication within 7 days
-- This prevents duplicate files for the same customer within a week
CREATE INDEX IF NOT EXISTS idx_tenders_file_hash_customer ON tenders(customer_id, file_hash)
  WHERE file_hash IS NOT NULL;

-- Create partial unique index for text deduplication within 7 days
CREATE INDEX IF NOT EXISTS idx_tenders_text_hash_customer ON tenders(customer_id, text_hash)
  WHERE text_hash IS NOT NULL;

-- Function to find duplicate tender by file hash
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
  WHERE customer_id = p_customer_id
    AND file_hash = p_file_hash
    AND created_at > NOW() - (p_window_days || ' days')::INTERVAL
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_tender_id;
END;
$$ LANGUAGE plpgsql;

-- Function to find duplicate tender by text hash
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
  WHERE customer_id = p_customer_id
    AND text_hash = p_text_hash
    AND created_at > NOW() - (p_window_days || ' days')::INTERVAL
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_tender_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. RATE LIMITING TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  resource_id TEXT DEFAULT NULL, -- For per-resource limits (e.g., tender_id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient rate limit lookups
CREATE INDEX IF NOT EXISTS idx_rate_limit_user_route ON rate_limit_entries(user_id, route, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_resource ON rate_limit_entries(user_id, route, resource_id, created_at DESC)
  WHERE resource_id IS NOT NULL;

-- Auto-cleanup old rate limit entries (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limit_entries()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limit_entries 
  WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Function to check rate limit and record attempt
-- Returns TRUE if under limit, FALSE if rate limited
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_route TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER,
  p_resource_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_count INTEGER;
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := NOW() - (p_window_seconds || ' seconds')::INTERVAL;
  
  IF p_resource_id IS NULL THEN
    -- Global rate limit for route
    SELECT COUNT(*) INTO v_count
    FROM rate_limit_entries
    WHERE user_id = p_user_id
      AND route = p_route
      AND created_at > v_cutoff;
  ELSE
    -- Per-resource rate limit
    SELECT COUNT(*) INTO v_count
    FROM rate_limit_entries
    WHERE user_id = p_user_id
      AND route = p_route
      AND resource_id = p_resource_id
      AND created_at > v_cutoff;
  END IF;
  
  IF v_count >= p_max_requests THEN
    RETURN FALSE;
  END IF;
  
  -- Record this attempt
  INSERT INTO rate_limit_entries (user_id, route, resource_id)
  VALUES (p_user_id, p_route, p_resource_id);
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to get seconds until rate limit resets
CREATE OR REPLACE FUNCTION get_rate_limit_reset_seconds(
  p_user_id UUID,
  p_route TEXT,
  p_window_seconds INTEGER,
  p_resource_id TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_oldest TIMESTAMPTZ;
  v_cutoff TIMESTAMPTZ;
  v_reset_at TIMESTAMPTZ;
BEGIN
  v_cutoff := NOW() - (p_window_seconds || ' seconds')::INTERVAL;
  
  IF p_resource_id IS NULL THEN
    SELECT MIN(created_at) INTO v_oldest
    FROM rate_limit_entries
    WHERE user_id = p_user_id
      AND route = p_route
      AND created_at > v_cutoff;
  ELSE
    SELECT MIN(created_at) INTO v_oldest
    FROM rate_limit_entries
    WHERE user_id = p_user_id
      AND route = p_route
      AND resource_id = p_resource_id
      AND created_at > v_cutoff;
  END IF;
  
  IF v_oldest IS NULL THEN
    RETURN 0;
  END IF;
  
  v_reset_at := v_oldest + (p_window_seconds || ' seconds')::INTERVAL;
  RETURN GREATEST(0, EXTRACT(EPOCH FROM (v_reset_at - NOW()))::INTEGER);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. LLM USAGE TRACKING TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID REFERENCES tenders(id) ON DELETE SET NULL,
  extraction_run_id UUID REFERENCES extraction_runs(id) ON DELETE SET NULL,
  
  -- Request info
  route TEXT NOT NULL,
  operation TEXT NOT NULL, -- 'classify', 'extract', 'reprocess'
  
  -- Model info
  model TEXT NOT NULL,
  
  -- Token usage
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  
  -- Timing
  duration_ms INTEGER NOT NULL DEFAULT 0,
  llm_duration_ms INTEGER DEFAULT NULL, -- LLM call only, if measurable
  
  -- Parser info
  parser_type TEXT DEFAULT NULL, -- 'pdf', 'docx', 'txt', 'paste'
  
  -- Input stats
  input_text_length INTEGER DEFAULT NULL,
  input_candidates_count INTEGER DEFAULT NULL,
  
  -- Output stats
  output_stops_count INTEGER DEFAULT NULL,
  output_refs_count INTEGER DEFAULT NULL,
  warnings_count INTEGER DEFAULT NULL,
  
  -- Error info (for failed attempts)
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_code TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  
  -- Version tracking
  extraction_version TEXT DEFAULT NULL,
  
  -- Audit
  user_id UUID REFERENCES auth.users(id),
  customer_id UUID REFERENCES customer_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user ON llm_usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_customer ON llm_usage_logs(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_success ON llm_usage_logs(success, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_model ON llm_usage_logs(model, created_at DESC);

-- ============================================
-- 4. RLS POLICIES FOR NEW TABLES
-- ============================================

ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage_logs ENABLE ROW LEVEL SECURITY;

-- Rate limit entries: users can only see their own
CREATE POLICY "Users can read own rate_limit_entries" ON rate_limit_entries
  FOR SELECT USING (user_id = auth.uid());

-- Service role handles inserts (via functions)

-- LLM usage logs: authenticated users can read all (for admin dashboard)
CREATE POLICY "Auth users can read llm_usage_logs" ON llm_usage_logs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Service role handles inserts

-- ============================================
-- 5. ANALYTICS VIEWS
-- ============================================

-- View: Daily LLM usage summary
CREATE OR REPLACE VIEW llm_usage_daily AS
SELECT 
  DATE(created_at) AS date,
  model,
  COUNT(*) AS total_calls,
  SUM(total_tokens) AS total_tokens,
  SUM(prompt_tokens) AS prompt_tokens,
  SUM(completion_tokens) AS completion_tokens,
  AVG(duration_ms)::INTEGER AS avg_duration_ms,
  SUM(CASE WHEN success THEN 0 ELSE 1 END) AS error_count,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(DISTINCT customer_id) AS unique_customers
FROM llm_usage_logs
GROUP BY DATE(created_at), model
ORDER BY date DESC, model;

-- View: Customer extraction stats
CREATE OR REPLACE VIEW customer_extraction_stats AS
SELECT 
  c.id AS customer_id,
  c.name AS customer_name,
  COUNT(l.id) AS total_extractions,
  SUM(CASE WHEN l.success THEN 0 ELSE 1 END) AS failed_extractions,
  SUM(l.warnings_count) AS total_warnings,
  AVG(l.warnings_count)::NUMERIC(5,2) AS avg_warnings,
  SUM(l.total_tokens) AS total_tokens,
  MAX(l.created_at) AS last_extraction
FROM customer_profiles c
LEFT JOIN llm_usage_logs l ON l.customer_id = c.id
GROUP BY c.id, c.name
ORDER BY total_extractions DESC;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN tenders.file_hash IS 'SHA-256 hash of uploaded file for deduplication';
COMMENT ON COLUMN tenders.text_hash IS 'SHA-256 hash of normalized text for deduplication';
COMMENT ON TABLE rate_limit_entries IS 'Rate limiting entries for per-user request throttling';
COMMENT ON TABLE llm_usage_logs IS 'Tracks LLM API usage for cost monitoring and observability';
COMMENT ON FUNCTION check_rate_limit IS 'Atomic rate limit check and recording';
COMMENT ON FUNCTION find_duplicate_tender_by_file_hash IS 'Find existing tender with same file hash within window';
