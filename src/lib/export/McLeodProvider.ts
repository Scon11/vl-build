/**
 * McLeod TMS Export Provider
 * 
 * Stub implementation for McLeod integration.
 * - dryRun: Validates and maps payload to McLeod format
 * - export: Requires MCLEOD_API_BASE_URL to be configured
 */

import {
  IExportProvider,
  ExportProviderConfig,
  CanonicalExportPayload,
  DryRunResult,
  ExportResult,
  ValidationError,
} from "./IExportProvider";
import { Stop } from "@/lib/types";

/**
 * Expected McLeod API shipment format (simplified, documented structure)
 * This is a best-guess based on typical TMS APIs - adjust based on actual McLeod API docs.
 */
interface McLeodShipmentPayload {
  // Required fields
  customer_code: string;
  load_type: "FTL" | "LTL";
  
  // Stops
  stops: McLeodStop[];
  
  // References
  references: McLeodReference[];
  
  // Cargo
  cargo: McLeodCargo[];
  
  // Equipment
  equipment_type?: string;
  trailer_length?: number;
  
  // Special requirements
  special_instructions?: string;
  
  // Metadata
  external_reference?: string;
}

interface McLeodStop {
  sequence: number;
  type: "PU" | "SO" | "DL"; // Pickup, Stopoff, Delivery
  company_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  appointment_start?: string;
  appointment_end?: string;
  reference?: string;
}

interface McLeodReference {
  type: string; // PO, BOL, PRO, etc.
  value: string;
}

interface McLeodCargo {
  description: string;
  quantity: number;
  quantity_type: string; // Pallets, Cases, etc.
  weight?: number;
  weight_unit?: string;
  temperature_min?: number;
  temperature_max?: number;
  temperature_unit?: string;
}

export class McLeodProvider implements IExportProvider {
  readonly config: ExportProviderConfig = {
    id: "mcleod",
    name: "McLeod TMS",
    enabled: true,
    supportsLiveExport: this.isConfigured(),
  };

  /**
   * Check if McLeod API is configured.
   */
  isConfigured(): boolean {
    return !!process.env.MCLEOD_API_BASE_URL;
  }

  /**
   * Perform a dry run - validate and map the payload.
   */
  async dryRun(payload: CanonicalExportPayload): Promise<DryRunResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Validate required fields
    const shipment = payload.shipment;

    // Customer validation
    if (!payload.customer_code && !payload.customer_id) {
      errors.push({
        field: "customer",
        message: "Customer code or ID is required",
        severity: "error",
      });
    }

    // Stops validation
    if (!shipment.stops || shipment.stops.length === 0) {
      errors.push({
        field: "stops",
        message: "At least one stop is required",
        severity: "error",
      });
    } else {
      const pickups = shipment.stops.filter((s) => s.type === "pickup");
      const deliveries = shipment.stops.filter((s) => s.type === "delivery");

      if (pickups.length === 0) {
        errors.push({
          field: "stops",
          message: "At least one pickup stop is required",
          severity: "error",
        });
      }

      if (deliveries.length === 0) {
        errors.push({
          field: "stops",
          message: "At least one delivery stop is required",
          severity: "error",
        });
      }

      // Validate each stop
      shipment.stops.forEach((stop, index) => {
        if (!stop.location?.city) {
          errors.push({
            field: `stops[${index}].location.city`,
            message: `Stop ${index + 1}: City is required`,
            severity: "error",
          });
        }
        if (!stop.location?.state) {
          errors.push({
            field: `stops[${index}].location.state`,
            message: `Stop ${index + 1}: State is required`,
            severity: "error",
          });
        }
        if (!stop.schedule?.date && !stop.schedule?.time) {
          warnings.push(`Stop ${index + 1}: No date or time specified`);
        }
      });
    }

    // Reference numbers validation
    if (!shipment.reference_numbers || shipment.reference_numbers.length === 0) {
      warnings.push("No reference numbers provided");
    }

    // Cargo validation
    if (!shipment.cargo) {
      warnings.push("No cargo information provided");
    }

    // If validation passed, map the payload
    let mappedPayload: McLeodShipmentPayload | undefined;
    
    if (errors.length === 0) {
      mappedPayload = this.mapToMcLeodFormat(payload);
    }

    return {
      ok: errors.length === 0,
      validationErrors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      mappedPayload: mappedPayload as unknown as Record<string, unknown>,
    };
  }

  /**
   * Perform a live export.
   */
  async export(payload: CanonicalExportPayload): Promise<ExportResult> {
    // Check configuration
    if (!this.isConfigured()) {
      return {
        ok: false,
        errorCode: "NOT_CONFIGURED",
        errorMessage: "McLeod API endpoints not configured. Set MCLEOD_API_BASE_URL environment variable.",
      };
    }

    // First run validation
    const dryRunResult = await this.dryRun(payload);
    if (!dryRunResult.ok) {
      return {
        ok: false,
        errorCode: "VALIDATION_FAILED",
        errorMessage: "Payload validation failed",
        rawResponse: { validationErrors: dryRunResult.validationErrors },
      };
    }

    // In the future, this would call the actual McLeod API
    // For now, return a stub response
    const baseUrl = process.env.MCLEOD_API_BASE_URL;
    const apiKey = process.env.MCLEOD_API_KEY;

    if (!apiKey) {
      return {
        ok: false,
        errorCode: "MISSING_API_KEY",
        errorMessage: "McLeod API key not configured. Set MCLEOD_API_KEY environment variable.",
      };
    }

    // TODO: Implement actual API call
    // For now, this is a stub that shows the structure
    console.log(`[McLeod] Would POST to ${baseUrl}/api/shipments`);
    console.log(`[McLeod] Payload:`, JSON.stringify(dryRunResult.mappedPayload, null, 2));

    // Return stub response
    return {
      ok: false,
      errorCode: "NOT_IMPLEMENTED",
      errorMessage: "Live export to McLeod is not yet implemented. API integration pending.",
      rawResponse: {
        note: "This is a stub. Actual implementation requires McLeod API documentation.",
        mappedPayload: dryRunResult.mappedPayload,
      },
    };
  }

  /**
   * Map canonical payload to McLeod format.
   */
  private mapToMcLeodFormat(payload: CanonicalExportPayload): McLeodShipmentPayload {
    const shipment = payload.shipment;

    // Map stops
    const stops: McLeodStop[] = (shipment.stops || []).map((stop, index) => ({
      sequence: index + 1,
      type: this.mapStopType(stop.type),
      company_name: stop.location?.name || "",
      address_line1: stop.location?.address || "",
      city: stop.location?.city || "",
      state: stop.location?.state || "",
      postal_code: stop.location?.zip || "",
      country: stop.location?.country || "US",
      appointment_start: stop.schedule?.time || undefined,
    }));

    // Map references
    const references: McLeodReference[] = (shipment.reference_numbers || []).map((ref) => ({
      type: this.mapReferenceType(ref.type),
      value: ref.value,
    }));

    // Map cargo - single cargo object, not array
    const cargo: McLeodCargo[] = shipment.cargo ? [{
      description: shipment.cargo.commodity || "Freight",
      quantity: shipment.cargo.weight?.value || 0,
      quantity_type: shipment.cargo.weight?.unit || "lbs",
      weight: shipment.cargo.weight?.value || undefined,
      weight_unit: shipment.cargo.weight?.unit || undefined,
      temperature_min: shipment.cargo.temperature?.value || undefined,
      temperature_max: shipment.cargo.temperature?.value || undefined,
      temperature_unit: shipment.cargo.temperature?.unit || "F",
    }] : [];

    return {
      customer_code: payload.customer_code || payload.customer_id || "",
      load_type: "FTL", // Default to FTL
      stops,
      references,
      cargo,
      special_instructions: shipment.unclassified_notes?.join("\n"),
      external_reference: payload.tender_id,
    };
  }

  private mapStopType(stopType: string | undefined): "PU" | "SO" | "DL" {
    switch (stopType?.toLowerCase()) {
      case "pickup":
        return "PU";
      case "delivery":
        return "DL";
      default:
        return "SO"; // Stopoff
    }
  }

  private mapReferenceType(subtype: string | undefined): string {
    const mapping: Record<string, string> = {
      po: "PO",
      bol: "BOL",
      pro: "PRO",
      order: "ORDER",
      pickup: "PU",
      delivery: "DL",
      shipment: "SHP",
      load: "LOAD",
      quote: "QUOTE",
    };
    return mapping[subtype || ""] || "REF";
  }
}

// Export singleton instance
export const mcleodProvider = new McLeodProvider();
