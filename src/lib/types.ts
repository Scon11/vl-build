// Core types for VL Build

export type SourceType = "paste" | "file";

/**
 * Tender status state machine:
 * draft -> extracted -> needs_review -> reviewed -> export_pending -> exported
 *                                                                 \-> export_failed
 */
export type TenderStatus = 
  | "draft"           // Initial state after upload/paste
  | "extracted"       // LLM extraction completed
  | "needs_review"    // Flagged for human review (e.g., hallucination warnings)
  | "reviewed"        // Human approved the extraction
  | "export_pending"  // Export in progress
  | "exported"        // Successfully exported
  | "export_failed";  // Export failed (can retry)

/**
 * Valid state transitions for tender status
 */
export const TENDER_STATUS_TRANSITIONS: Record<TenderStatus, TenderStatus[]> = {
  draft: ["extracted"],
  extracted: ["needs_review", "reviewed"], // Can skip review if no warnings
  needs_review: ["reviewed", "extracted"], // Can reprocess
  reviewed: ["export_pending", "needs_review"], // Can go back for edits
  export_pending: ["exported", "export_failed"],
  exported: [], // Terminal state (success)
  export_failed: ["export_pending", "reviewed"], // Can retry or go back
};

export interface Tender {
  id: string;
  source_type: SourceType;
  original_text: string;
  original_file_url: string | null;
  original_file_path: string | null; // Private storage path
  status: TenderStatus;
  created_at: string;
  reviewed_at: string | null;
  
  // Deduplication hashes
  file_hash: string | null;
  text_hash: string | null;
  
  // Audit fields
  created_by: string | null;
  updated_by: string | null;
  reviewed_by: string | null;
  exported_by: string | null;
  
  // Export fields
  export_provider: string | null;
  export_external_id: string | null;
  export_attempts: number;
  last_export_attempt_at: string | null;
  exported_at: string | null;
  
  // Processing lock fields
  locked_at: string | null;
  locked_by: string | null;
  lock_reason: string | null;
}

export interface FinalFields {
  id: string;
  tender_id: string;
  shipment: StructuredShipment;
  reviewed_by: string | null; // UUID of auth user
  updated_by: string | null;
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
    rules_applied_count?: number;
    rules_skipped_count?: number;
    rules_applied_details?: Array<{ rule: string; candidate: string; reason: string }>;
    rules_skipped_reasons?: Array<{ rule: string; candidate: string; reason: string }>;
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
// Provenance Types (Tracking where values come from)
// ============================================

/**
 * Source type indicates where a value originated from.
 * Used to determine whether a value can be flagged as "hallucinated".
 */
export type ProvenanceSourceType =
  | "document_text"  // Value found directly in the source document
  | "email_text"     // Value found in email text
  | "rule"           // Value applied from customer rule (learned default)
  | "user_edit"      // Value manually set by user
  | "llm_inference"; // Value produced by LLM (only source that can be "hallucinated")

/**
 * Evidence record for a provenance entry.
 */
export interface ProvenanceEvidence {
  match_text?: string;        // Exact substring found in source
  char_start?: number;        // Start position in extracted text
  char_end?: number;          // End position in extracted text
  label?: string;             // Label found near match (e.g., "Total Lbs")
  candidate_index?: number;   // Index in candidates array if matched
}

/**
 * Provenance record for a single field value.
 * Tracks where the value came from and how confident we are.
 */
export interface FieldProvenance {
  source_type: ProvenanceSourceType;
  confidence: number;         // 0-1, higher = more confident
  evidence: ProvenanceEvidence[];
  reason?: string;            // Short explanation (e.g., "customer cargo rule: temp -10 => Frozen Food")
  applied_at?: string;        // ISO timestamp when this was set
}

/**
 * Map of field paths to their provenance records.
 * Field paths use dot notation: "cargo.commodity", "stops[0].location.city"
 */
export type FieldProvenanceMap = Record<string, FieldProvenance>;

// ============================================
// Verification Types (Post-LLM validation)
// ============================================

/**
 * Warning category determines UI treatment:
 * - "hallucinated": LLM produced value with no source support (yellow banner)
 * - "unverified": Value extracted but evidence is weak (inline indicator only)
 */
export type WarningCategory = "hallucinated" | "unverified";

export interface VerificationWarning {
  path: string;                    // JSON path to the field
  value: string;                   // The value in question
  reason: "unsupported_by_source" | "weak_evidence" | "ambiguous_match";
  category: WarningCategory;       // Determines UI severity
  source_type?: ProvenanceSourceType; // Where the value came from
}

export interface VerifiedShipmentResult {
  shipment: StructuredShipment;
  warnings: VerificationWarning[];
  provenance: FieldProvenanceMap;  // Provenance for all verified fields
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
  field_provenance?: FieldProvenanceMap;
  normalization?: NormalizationMetadata;
  customer_id?: string;
  applied_customer_rules?: number;
  rules_applied_count?: number;
  rules_skipped_count?: number;
  rules_applied_details?: Array<{ rule: string; candidate: string; reason: string }>;
  rules_skipped_reasons?: Array<{ rule: string; candidate: string; reason: string }>;
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
 * Rule scope - where the rule should be applied
 */
export type RuleScope = "global" | "pickup" | "delivery" | "header";

/**
 * Rule lifecycle status
 */
export type ValueRuleStatus = "active" | "deprecated";

/**
 * Maps value patterns to reference number subtypes.
 * These are the highest-priority rules - if a value matches,
 * it's classified regardless of label.
 * 
 * Example: "^TRFR\\d+$" -> "po" (global)
 * This means any TRFR* value is a PO, anywhere it appears.
 */
export interface ReferenceValueRule {
  pattern: string; // Regex pattern for the VALUE (e.g., "^TRFR\\d+$")
  subtype: ReferenceNumberSubtype;
  scope: RuleScope; // Where this applies
  priority?: number; // Higher = applies first (default 0)
  description?: string;
  confidence: number;
  learned_from?: string;
  created_at: string;
  
  // Lifecycle metadata
  status?: ValueRuleStatus; // Default: "active", deprecated rules are not applied
  created_by?: string; // User ID who created this rule
  hits?: number; // How many times this rule has matched (incremented on apply)
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
  reference_value_rules?: ReferenceValueRule[]; // Value-pattern based rules (highest priority)
  stop_parsing_hints: StopParsingHints;
  cargo_hints?: CargoHints;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Suggested rule based on user reclassification.
 * Shown to user for review before adding to profile.
 * 
 * Rule precedence (highest to lowest):
 * 1. value_pattern - applies when VALUE matches pattern (e.g., TRFR* -> PO)
 * 2. label - applies when LABEL matches (e.g., "Release #" -> PO)
 * 3. regex - legacy, pattern on label or value (being deprecated)
 */
export interface SuggestedRule {
  type: "label" | "regex" | "value_pattern";
  label?: string;
  pattern?: string; // For regex and value_pattern types
  subtype: ReferenceNumberSubtype;
  scope?: RuleScope; // Where this rule applies (default: global)
  example_value: string;
  context: string;
  
  // Match metadata for UI transparency (value_pattern only)
  match_count?: number; // How many distinct values matched in this tender
  example_matches?: string[]; // Up to 3 example values that match
  score?: number; // Internal score used to decide if rule should be proposed
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
    temperature_mode?: "frozen" | "refrigerated" | "dry";
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

// ============================================
// Export System Types
// ============================================

/**
 * Export action types
 */
export type ExportAction = "dry_run" | "export" | "retry" | "cancel" | "rollback";

/**
 * Export log status
 */
export type ExportLogStatus = "pending" | "success" | "failed" | "cancelled";

/**
 * Export log entry for audit trail
 */
export interface ExportLog {
  id: string;
  tender_id: string;
  provider: string;
  action: ExportAction;
  status: ExportLogStatus;
  idempotency_key: string | null;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  error_message: string | null;
  error_code: string | null;
  external_id: string | null;
  created_by: string | null;
  created_at: string;
  duration_ms: number | null;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  success: boolean;
  external_id?: string;
  message?: string;
  error_code?: string;
  error_message?: string;
  dry_run?: boolean;
  payload?: Record<string, unknown>;
}

/**
 * Export request for provider
 */
export interface ExportRequest {
  tender_id: string;
  shipment: StructuredShipment;
  customer_id?: string;
  idempotency_key?: string;
  dry_run?: boolean;
}

// ============================================
// Rule Lifecycle Types
// ============================================

/**
 * Rule status for lifecycle management
 */
export type RuleStatus = "proposed" | "active" | "deprecated";

/**
 * Rule type for customer_rules table
 */
export type CustomerRuleType = "label_map" | "regex_map" | "cargo_hint";

/**
 * Customer rule from the customer_rules table
 */
export interface CustomerRule {
  id: string;
  customer_id: string;
  rule_type: CustomerRuleType;
  pattern: string;
  target_value: string;
  description?: string;
  status: RuleStatus;
  confidence: number;
  
  // Audit
  created_by?: string;
  approved_by?: string;
  approved_at?: string;
  deprecated_by?: string;
  deprecated_at?: string;
  learned_from_tender?: string;
  
  created_at: string;
  updated_at: string;
}

/**
 * Extended reference label rule with lifecycle
 */
export interface ReferenceLabelRuleWithStatus extends ReferenceLabelRule {
  status?: RuleStatus;
  disabled_at?: string;
  disabled_by?: string;
}

/**
 * Extended reference regex rule with lifecycle
 */
export interface ReferenceRegexRuleWithStatus extends ReferenceRegexRule {
  status?: RuleStatus;
  disabled_at?: string;
  disabled_by?: string;
}

// ============================================
// Batch Upload Types (V1.6)
// ============================================

/**
 * Batch status
 */
export type BatchStatus = "active" | "completed" | "abandoned";

/**
 * Batch item state
 */
export type BatchItemState = "ready" | "needs_review" | "reviewed" | "skipped" | "failed";

/**
 * Tender batch for multi-file uploads
 */
export interface TenderBatch {
  id: string;
  created_by: string;
  customer_id: string | null;
  status: BatchStatus;
  current_index: number;
  total_items: number;
  created_at: string;
  updated_at: string;
}

/**
 * Individual item in a batch
 */
export interface TenderBatchItem {
  id: string;
  batch_id: string;
  tender_id: string;
  file_name: string;
  source_type: "file" | "paste";
  position: number;
  state: BatchItemState;
  deduped: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Batch with items for API responses
 */
export interface TenderBatchWithItems extends TenderBatch {
  items: TenderBatchItem[];
}

/**
 * Batch summary counts
 */
export interface BatchSummary {
  total: number;
  ready: number;
  needs_review: number;
  reviewed: number;
  skipped: number;
  failed: number;
  deduped: number;
}

/**
 * Response from batch upload endpoint
 */
export interface BatchUploadResponse {
  batch_id: string;
  items: Array<{
    position: number;
    tender_id: string;
    file_name: string;
    state: BatchItemState;
    deduped: boolean;
    error_message?: string;
  }>;
  first_tender_id: string | null;
}

/**
 * Response from batch advance endpoint
 */
export interface BatchAdvanceResponse {
  completed: boolean;
  next_tender_id: string | null;
  current_index: number;
  summary?: BatchSummary;
}