-- Learning Events table for global learning system
-- Records user edits to enable automatic learning and improvement

CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'reference_subtype',
    'cargo_commodity',
    'cargo_weight',
    'cargo_pieces',
    'cargo_temperature',
    'cargo_temp_mode',
    'stop_schedule',
    'stop_appointment'
  )),
  field_path TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_learning_events_customer ON learning_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_field_type ON learning_events(field_type);
CREATE INDEX IF NOT EXISTS idx_learning_events_created_at ON learning_events(created_at);

-- Add customer_profile_id to tenders table if not exists
-- This links tenders to customer profiles for rule application
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tenders' AND column_name = 'customer_profile_id'
  ) THEN
    ALTER TABLE tenders ADD COLUMN customer_profile_id UUID REFERENCES customer_profiles(id);
  END IF;
  
  -- Also add legacy customer_id if not exists (for backwards compatibility)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tenders' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE tenders ADD COLUMN customer_id UUID REFERENCES customer_profiles(id);
  END IF;
END $$;

-- Add indexes for customer lookups
CREATE INDEX IF NOT EXISTS idx_tenders_customer_profile ON tenders(customer_profile_id);
CREATE INDEX IF NOT EXISTS idx_tenders_customer ON tenders(customer_id);

COMMENT ON TABLE learning_events IS 'Records user edits for global learning system';
COMMENT ON COLUMN learning_events.field_type IS 'Type of field that was edited';
COMMENT ON COLUMN learning_events.field_path IS 'JSON path to the edited field (e.g., cargo.commodity)';
COMMENT ON COLUMN learning_events.context IS 'Additional context like label_hint, temperature_value, etc.';
