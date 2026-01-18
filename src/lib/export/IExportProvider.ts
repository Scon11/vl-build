/**
 * Export Provider Interface
 * 
 * All TMS export providers must implement this interface.
 */

import { StructuredShipment } from "@/lib/types";

/**
 * Canonical export payload derived from final_fields.shipment
 */
export interface CanonicalExportPayload {
  // Identifiers
  tender_id: string;
  customer_id?: string;
  customer_code?: string;
  customer_name?: string;

  // Shipment data
  shipment: StructuredShipment;

  // Metadata
  metadata: {
    reviewed_by?: string;
    reviewed_at?: string;
    extraction_run_id?: string;
    original_file_name?: string;
    source: "VL Build";
  };
}

/**
 * Validation error from dry run
 */
export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Result of a dry run operation
 */
export interface DryRunResult {
  ok: boolean;
  validationErrors?: ValidationError[];
  warnings?: string[];
  mappedPayload?: Record<string, unknown>;
}

/**
 * Result of a live export operation
 */
export interface ExportResult {
  ok: boolean;
  providerReferenceId?: string;
  rawResponse?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Export provider configuration
 */
export interface ExportProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  supportsLiveExport: boolean;
}

/**
 * Interface for export providers (McLeod, etc.)
 */
export interface IExportProvider {
  readonly config: ExportProviderConfig;

  /**
   * Perform a dry run - validate and map the payload without sending.
   * @param payload The canonical export payload
   * @returns Validation result with mapped payload
   */
  dryRun(payload: CanonicalExportPayload): Promise<DryRunResult>;

  /**
   * Perform a live export to the external system.
   * @param payload The canonical export payload
   * @returns Export result with provider reference ID
   */
  export(payload: CanonicalExportPayload): Promise<ExportResult>;

  /**
   * Check if the provider is properly configured.
   */
  isConfigured(): boolean;
}
