-- Migration: Add reference_value_rules column to customer_profiles
-- This adds support for value-pattern based rules (highest priority)
-- Example: ^TRFR\d{7,}$ pattern -> PO (global scope)
--
-- HARDENED for production use across 500+ customers:
-- - Includes lifecycle metadata (status, hits, created_by)
-- - Deprecated rules are not applied during extraction
-- - Hits are incremented when rules match

-- Add reference_value_rules column
ALTER TABLE customer_profiles 
ADD COLUMN IF NOT EXISTS reference_value_rules JSONB NOT NULL DEFAULT '[]';

-- Array of: { 
--   pattern: string (regex pattern for value, e.g., "^TRFR\\d{7,}$"),
--   subtype: string (po, bol, order, etc.),
--   scope: string (global, pickup, delivery, header),
--   priority: number (higher = applies first, default 0),
--   description: string (optional human-readable description),
--   confidence: number (0-1),
--   learned_from: string (tender_id where this was learned),
--   created_at: string (ISO timestamp),
--   
--   -- Lifecycle metadata (added for hardening)
--   status: string (active | deprecated, default active),
--   created_by: string (user ID who created this rule),
--   hits: number (how many times this rule has matched, default 0)
-- }

-- Add comment for documentation
COMMENT ON COLUMN customer_profiles.reference_value_rules IS 
  'Value-pattern rules (highest priority). Array of {pattern, subtype, scope, priority?, description?, confidence, learned_from?, created_at, status?, created_by?, hits?}. Status defaults to active. Deprecated rules are not applied.';

-- Add scope to existing label rules (for UI display)
-- This is a non-breaking change - existing rules without scope default to "global"
COMMENT ON COLUMN customer_profiles.reference_label_rules IS 
  'Label-based rules. Array of {label, subtype, scope?, confidence, learned_from?, created_at}. Scope defaults to global if not specified.';
