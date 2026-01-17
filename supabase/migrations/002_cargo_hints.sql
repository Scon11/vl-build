-- Add cargo_hints column to customer_profiles
-- Run this in Supabase SQL editor

ALTER TABLE customer_profiles 
ADD COLUMN IF NOT EXISTS cargo_hints JSONB NOT NULL DEFAULT '{}';
-- Object: { commodity_by_temp: { frozen, refrigerated, dry }, default_commodity, default_temp_mode }

-- Verify the column was added
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'customer_profiles';
