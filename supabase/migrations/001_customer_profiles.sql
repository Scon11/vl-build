-- Customer Profiles table for storing learned rules
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS customer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT, -- Short code like "ACME" or "FFI"
  
  -- Learned rules stored as JSONB
  reference_label_rules JSONB NOT NULL DEFAULT '[]',
  -- Array of: { label, subtype, confidence, learned_from, created_at }
  
  reference_regex_rules JSONB NOT NULL DEFAULT '[]',
  -- Array of: { pattern, subtype, description, confidence, learned_from, created_at }
  
  stop_parsing_hints JSONB NOT NULL DEFAULT '{}',
  -- Object: { pickup_keywords, delivery_keywords, stop_delimiter, assume_single_pickup, assume_single_delivery }
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by name
CREATE INDEX IF NOT EXISTS idx_customer_profiles_name ON customer_profiles(name);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_code ON customer_profiles(code);

-- Add customer_id to tenders table
ALTER TABLE tenders 
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customer_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenders_customer_id ON tenders(customer_id);

-- Example: Insert a test customer
-- INSERT INTO customer_profiles (name, code, reference_label_rules) 
-- VALUES (
--   'FFI Logistics', 
--   'FFI',
--   '[{"label": "Release #", "subtype": "po", "confidence": 0.8, "created_at": "2026-01-17T00:00:00Z"}]'
-- );
