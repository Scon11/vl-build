// Core types for VL Build

export type SourceType = "paste" | "file";
export type TenderStatus = "draft" | "reviewed" | "exported";

export interface Tender {
  id: string;
  source_type: SourceType;
  original_text: string;
  original_file_url: string | null;
  status: TenderStatus;
  created_at: string;
  reviewed_at: string | null;
}

export interface FinalFields {
  id: string;
  tender_id: string;
  shipment: StructuredShipment;
  reviewed_by: string | null; // for future auth
  created_at: string;
  updated_at: string;
}

// Extraction types

export type CandidateType =
  | "reference_number"
  | "date"
  | "time"
  | "datetime"
  | "address"
  | "city_state_zip"
  | "weight"
  | "pieces"
  | "dimensions"
  | "temperature"
  | "commodity"
  | "stop_block";

export type ReferenceNumberSubtype =
  | "po"
  | "bol"
  | "order"
  | "pickup"
  | "delivery"
  | "appointment"
  | "reference"
  | "confirmation"
  | "pro"
  | "unknown";

export interface ExtractedCandidate {
  type: CandidateType;
  value: string;
  raw_match: string;
  label_hint: string | null; // nearby text that might indicate what this is
  subtype: ReferenceNumberSubtype | null;
  confidence: "high" | "medium" | "low";
  position: {
    start: number;
    end: number;
  };
  context: string; // surrounding text for review
}

export interface ExtractionResult {
  candidates: ExtractedCandidate[];
  metadata: {
    extracted_at: string;
    text_length: number;
    version: string;
    customer_id?: string;
    applied_customer_rules?: number;
  };
}

export interface ExtractionRun {
  id: string;
  tender_id: string;
  candidates: ExtractedCandidate[];
  metadata: ExtractionResult["metadata"];
  llm_output: StructuredShipment | null;
  created_at: string;
}

// ============================================
// Structured Shipment Schema (LLM output)
// ============================================

export interface ReferenceNumber {
  type: ReferenceNumberSubtype;
  value: string;
  applies_to?: "shipment" | "pickup" | "delivery" | "stop"; // what this ref applies to
}

export interface StopLocation {
  name: string | null; // facility/company name
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

export interface StopSchedule {
  date: string | null; // ISO date or relative like "today", "tomorrow"
  time: string | null; // time string
  appointment_required: boolean | null;
}

export interface Stop {
  type: "pickup" | "delivery";
  sequence: number; // 1-based order
  location: StopLocation;
  schedule: StopSchedule;
  reference_numbers: ReferenceNumber[];
  notes: string | null;
}

export interface CargoDetails {
  weight: {
    value: number | null;
    unit: "lbs" | "kg" | null;
  };
  pieces: {
    count: number | null;
    type: string | null; // "pallets", "skids", "cases", etc.
  };
  dimensions: {
    length: number | null;
    width: number | null;
    height: number | null;
    unit: "in" | "cm" | "ft" | null;
  } | null;
  commodity: string | null;
  temperature: {
    value: number | null;
    unit: "F" | "C" | null;
    mode: "frozen" | "refrigerated" | "dry" | null;
  } | null;
}

export interface StructuredShipment {
  // Reference numbers at shipment level
  reference_numbers: ReferenceNumber[];

  // Stops (pickups and deliveries)
  stops: Stop[];

  // Cargo information
  cargo: CargoDetails;

  // Anything the LLM couldn't classify
  unclassified_notes: string[];

  // Metadata about the classification
  classification_metadata: {
    model: string;
    classified_at: string;
    confidence_notes: string | null;
  };
}

// ============================================
// Verification Types (Post-LLM validation)
// ============================================

export interface VerificationWarning {
  path: string; // JSON path to the field, e.g., "reference_numbers[0].value"
  value: string; // The unsupported value
  reason: "unsupported_by_source";
}

export interface VerifiedShipmentResult {
  shipment: StructuredShipment;
  warnings: VerificationWarning[];
  normalization?: NormalizationMetadata;
}

export interface NormalizationMetadata {
  refs_moved_to_stops: number;
  refs_deduplicated: number;
  cargo_source: "header" | "stop" | "unknown";
}

export interface ExtractionMetadata {
  extracted_at: string;
  text_length: number;
  version: string;
  file_name?: string;
  file_type?: string;
  page_count?: number;
  word_count?: number;
  verification_warnings?: VerificationWarning[];
  normalization?: NormalizationMetadata;
  customer_id?: string;
  applied_customer_rules?: number;
}

// ============================================
// Customer Profile Types (Learning System)
// ============================================

/**
 * Maps label synonyms to reference number subtypes.
 * e.g., "Release #" -> "po" for a specific customer
 */
export interface ReferenceLabelRule {
  label: string; // The label text that was observed (e.g., "Release #", "FFI Order")
  subtype: ReferenceNumberSubtype; // What it maps to
  confidence: number; // 0-1, based on how many times this was learned
  learned_from?: string; // tender_id where this was learned
  created_at: string;
}

/**
 * Maps regex patterns to reference number subtypes.
 * For customer-specific number formats.
 */
export interface ReferenceRegexRule {
  pattern: string; // Regex pattern string (e.g., "^FFI\\d{5}$")
  subtype: ReferenceNumberSubtype;
  description?: string; // Human-readable description
  confidence: number;
  learned_from?: string;
  created_at: string;
}

/**
 * Hints for stop parsing specific to a customer.
 */
export interface StopParsingHints {
  pickup_keywords?: string[]; // e.g., ["Ship From", "Origin"]
  delivery_keywords?: string[]; // e.g., ["Consignee", "Ship To"]
  stop_delimiter?: string; // e.g., "---" or "STOP #"
  assume_single_pickup?: boolean;
  assume_single_delivery?: boolean;
}

/**
 * Cargo hints for customer-specific commodity/temperature rules.
 */
export interface CargoHints {
  // Default commodity based on temperature ranges
  commodity_by_temp?: {
    frozen?: string; // e.g., "Frozen Food" when temp < 32°F
    refrigerated?: string; // e.g., "Refrigerated Goods" when 32-40°F
    dry?: string; // e.g., "Dry Goods" when no temp
  };
  // Default commodity for this customer
  default_commodity?: string;
  // Default temperature mode
  default_temp_mode?: "frozen" | "refrigerated" | "dry";
}

/**
 * Customer profile containing learned rules and preferences.
 */
export interface CustomerProfile {
  id: string;
  name: string;
  code?: string; // Short code like "ACME" or "FFI"
  reference_label_rules: ReferenceLabelRule[];
  reference_regex_rules: ReferenceRegexRule[];
  stop_parsing_hints: StopParsingHints;
  cargo_hints?: CargoHints;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Suggested rule based on user reclassification.
 * Shown to user for review before adding to profile.
 */
export interface SuggestedRule {
  type: "label" | "regex";
  label?: string;
  pattern?: string;
  subtype: ReferenceNumberSubtype;
  example_value: string;
  context: string;
}

/**
 * Extended tender with customer association
 */
export interface TenderWithCustomer extends Tender {
  customer_id: string | null;
}

// ============================================
// Global Learning System Types
// ============================================

/**
 * Types of fields that can be learned from user edits.
 */
export type LearnableFieldType =
  | "reference_subtype"
  | "cargo_commodity"
  | "cargo_weight"
  | "cargo_pieces"
  | "cargo_temperature"
  | "cargo_temp_mode"
  | "stop_schedule"
  | "stop_appointment";

/**
 * A learning event recorded when user makes an edit.
 */
export interface LearningEvent {
  id: string;
  customer_id: string;
  tender_id: string;
  field_type: LearnableFieldType;
  field_path: string; // e.g., "reference_numbers[0].type", "cargo.commodity"
  before_value: string | number | boolean | null;
  after_value: string | number | boolean | null;
  context: {
    label_hint?: string;
    nearby_text?: string;
    temperature_value?: number;
    original_subtype?: string;
  };
  created_at: string;
}

/**
 * Aggregated learning signal for a customer.
 * Used to apply learned defaults automatically.
 */
export interface LearnedDefault {
  field_type: LearnableFieldType;
  condition: {
    label_pattern?: string;
    temp_range?: { min?: number; max?: number };
    temp_mode?: "frozen" | "refrigerated" | "dry";
  };
  default_value: string | number | boolean;
  confidence: number; // 0-1 based on how many times this was learned
  occurrences: number;
}

/**
 * Suggested edit for global learning - includes cargo, refs, etc.
 */
export interface SuggestedEdit {
  type: "label_rule" | "regex_rule" | "cargo_default" | "temp_commodity";
  label?: string;
  pattern?: string;
  subtype?: ReferenceNumberSubtype;
  commodity?: string;
  temp_mode?: "frozen" | "refrigerated" | "dry";
  example_value: string;
  context: string;
}