/**
 * Export Provider System
 * 
 * This module provides a pluggable export system with provider adapters.
 * Currently supports:
 * - McLeod TMS (stub with dry-run support)
 * 
 * To add a new provider:
 * 1. Create a new class implementing IExportProvider
 * 2. Add it to the registry in getProviderRegistry()
 */

import {
  IExportProvider,
  ExportProviderConfig,
  CanonicalExportPayload,
  DryRunResult,
  ExportResult,
} from "./IExportProvider";
import { mcleodProvider } from "./McLeodProvider";

// Re-export types
export * from "./IExportProvider";
export { McLeodProvider, mcleodProvider } from "./McLeodProvider";

// Provider instances (singletons)
let providerRegistry: Record<string, IExportProvider> | null = null;

/**
 * Get the registry of all available export providers.
 */
export function getProviderRegistry(): Record<string, IExportProvider> {
  if (!providerRegistry) {
    providerRegistry = {
      mcleod: mcleodProvider,
    };
  }
  return providerRegistry;
}

/**
 * Get a specific provider by ID.
 */
export function getProvider(providerId: string): IExportProvider | null {
  const registry = getProviderRegistry();
  return registry[providerId] || null;
}

/**
 * Get list of all available provider configurations.
 */
export function getAvailableProviders(): ExportProviderConfig[] {
  const registry = getProviderRegistry();
  return Object.values(registry).map((p) => p.config);
}

/**
 * Perform a dry run export with the specified provider.
 * Validates and maps the payload without sending.
 * 
 * @param providerId The provider to use (e.g., "mcleod")
 * @param payload The canonical export payload
 * @returns Dry run result with validation errors and mapped payload
 */
export async function dryRunExport(
  providerId: string,
  payload: CanonicalExportPayload
): Promise<DryRunResult> {
  const provider = getProvider(providerId);
  
  if (!provider) {
    return {
      ok: false,
      validationErrors: [{
        field: "provider",
        message: `Export provider '${providerId}' not found`,
        severity: "error",
      }],
    };
  }

  if (!provider.config.enabled) {
    return {
      ok: false,
      validationErrors: [{
        field: "provider",
        message: `Export provider '${providerId}' is currently disabled`,
        severity: "error",
      }],
    };
  }

  try {
    return await provider.dryRun(payload);
  } catch (error) {
    console.error(`[Export] Dry run error with provider ${providerId}:`, error);
    return {
      ok: false,
      validationErrors: [{
        field: "system",
        message: error instanceof Error ? error.message : "Unknown error occurred",
        severity: "error",
      }],
    };
  }
}

/**
 * Export a shipment using the specified provider.
 * This is the main entry point for live export operations.
 * 
 * @param providerId The provider to use (e.g., "mcleod")
 * @param payload The canonical export payload
 * @returns Export result with provider reference ID
 */
export async function exportShipment(
  providerId: string,
  payload: CanonicalExportPayload
): Promise<ExportResult> {
  const provider = getProvider(providerId);
  
  if (!provider) {
    return {
      ok: false,
      errorCode: "PROVIDER_NOT_FOUND",
      errorMessage: `Export provider '${providerId}' not found`,
    };
  }

  if (!provider.config.enabled) {
    return {
      ok: false,
      errorCode: "PROVIDER_DISABLED",
      errorMessage: `Export provider '${providerId}' is currently disabled`,
    };
  }

  if (!provider.isConfigured()) {
    return {
      ok: false,
      errorCode: "PROVIDER_NOT_CONFIGURED",
      errorMessage: `Export provider '${providerId}' is not properly configured`,
    };
  }

  try {
    return await provider.export(payload);
  } catch (error) {
    console.error(`[Export] Error with provider ${providerId}:`, error);
    return {
      ok: false,
      errorCode: "PROVIDER_ERROR",
      errorMessage: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Check if a provider is configured for live export.
 */
export function isProviderConfigured(providerId: string): boolean {
  const provider = getProvider(providerId);
  return provider?.isConfigured() ?? false;
}

/**
 * Check if live export is available for any provider.
 */
export function isLiveExportAvailable(): boolean {
  const providers = getAvailableProviders();
  return providers.some((p) => p.supportsLiveExport);
}
