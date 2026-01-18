import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, AuthError } from "@/lib/auth";
import { 
  dryRunExport, 
  exportShipment, 
  getAvailableProviders,
  CanonicalExportPayload,
} from "@/lib/export";
import { StructuredShipment, TenderStatus } from "@/lib/types";
import { validateTransition, InvalidStateTransitionError } from "@/lib/state-machine";
import { withLock, TenderLockError } from "@/lib/tender-lock";
import { withIdempotency } from "@/lib/idempotency";

/**
 * GET /api/tenders/[id]/export
 * Get export status and available providers
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const supabase = createServerClient();

    // Get tender with export status
    const { data: tender, error } = await supabase
      .from("tenders")
      .select("id, status, export_provider, export_external_id, export_attempts, last_export_attempt_at, exported_at, locked_at, locked_by, lock_reason")
      .eq("id", id)
      .single();

    if (error || !tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    // Get recent export attempts
    const { data: attempts } = await supabase
      .from("export_attempts")
      .select("*")
      .eq("tender_id", id)
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      tender: {
        id: tender.id,
        status: tender.status,
        export_provider: tender.export_provider,
        export_external_id: tender.export_external_id,
        export_attempts: tender.export_attempts,
        last_export_attempt_at: tender.last_export_attempt_at,
        exported_at: tender.exported_at,
        locked: !!tender.locked_at,
        lock_reason: tender.lock_reason,
      },
      providers: getAvailableProviders(),
      attempts: attempts || [],
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Export GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/tenders/[id]/export
 * Export a tender to an external system
 * 
 * Body:
 * - mode: "dry_run" | "live" (required)
 * - provider: string (optional, default "mcleod")
 * 
 * Headers:
 * - Idempotency-Key: string (optional) - Key for idempotent retry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  
  try {
    const authUser = await requireAuth();
    const { id: tenderId } = await params;

    const body = await request.json();
    const { 
      mode = "dry_run",
      provider: providerId = "mcleod",
    } = body as {
      mode?: "dry_run" | "live";
      provider?: string;
    };

    // Get idempotency key from header
    const idempotencyKey = request.headers.get("Idempotency-Key");

    const supabase = createServerClient();
    const serviceClient = createServiceClient();

    // Fetch tender
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .select(`
        id, status, export_attempts, customer_id
      `)
      .eq("id", tenderId)
      .single();

    if (tenderError || !tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    // Validate tender status - must be reviewed (or export_failed for retry)
    const allowedStatuses: TenderStatus[] = ["reviewed", "export_failed"];
    if (!allowedStatuses.includes(tender.status as TenderStatus)) {
      return NextResponse.json({
        error: "Tender must be reviewed before exporting",
        current_status: tender.status,
        allowed_statuses: allowedStatuses,
      }, { status: 400 });
    }

    // Fetch final fields (required for export)
    const { data: finalFields, error: ffError } = await supabase
      .from("final_fields")
      .select("shipment, reviewed_by, updated_at")
      .eq("tender_id", tenderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (ffError || !finalFields) {
      return NextResponse.json({
        error: "Final fields not found. Tender must be saved before exporting.",
      }, { status: 400 });
    }

    const shipment = finalFields.shipment as StructuredShipment;

    // Fetch customer profile if available
    let customerName: string | undefined;
    let customerCode: string | undefined;
    if (tender.customer_id) {
      const { data: customer } = await supabase
        .from("customer_profiles")
        .select("name, code")
        .eq("id", tender.customer_id)
        .single();
      customerName = customer?.name;
      customerCode = customer?.code;
    }

    // Build canonical export payload
    const payload: CanonicalExportPayload = {
      tender_id: tenderId,
      shipment,
      customer_id: tender.customer_id || undefined,
      customer_name: customerName,
      customer_code: customerCode,
      metadata: {
        reviewed_by: finalFields.reviewed_by,
        reviewed_at: finalFields.updated_at,
        source: "VL Build",
      },
    };

    // Handle dry run mode (no lock needed, no state change)
    if (mode === "dry_run") {
      const result = await dryRunExport(providerId, payload);

      // Log the dry run attempt
      await logExportAttempt(serviceClient, {
        tender_id: tenderId,
        mode: "dry_run",
        provider: providerId,
        status: result.ok ? "success" : "failed",
        request_payload: payload as unknown as Record<string, unknown>,
        mapped_payload: result.mappedPayload,
        response_payload: result.ok ? { ok: true } : { validationErrors: result.validationErrors },
        error_message: result.validationErrors?.map(e => e.message).join("; "),
        created_by: authUser.user.id,
        duration_ms: Date.now() - startTime,
      });

      return NextResponse.json({
        ok: result.ok,
        mode: "dry_run",
        validationErrors: result.validationErrors,
        warnings: result.warnings,
        mappedPayload: result.mappedPayload,
      });
    }

    // Handle live export mode with lock and idempotency
    const executeExport = async () => {
      return await withLock(tenderId, authUser.user.id, "exporting", async () => {
        // Validate state transition
        try {
          validateTransition(tender.status as TenderStatus, "export_pending");
        } catch (e) {
          if (e instanceof InvalidStateTransitionError) {
            throw new Error(`Cannot export: invalid state transition from ${tender.status}`);
          }
          throw e;
        }

        // Update status to export_pending
        await supabase
          .from("tenders")
          .update({
            status: "export_pending" as TenderStatus,
            export_provider: providerId,
            export_attempts: (tender.export_attempts || 0) + 1,
            last_export_attempt_at: new Date().toISOString(),
            updated_by: authUser.user.id,
          })
          .eq("id", tenderId);

        // Execute export
        const result = await exportShipment(providerId, payload);

        // Update tender status based on result
        if (result.ok) {
          await supabase
            .from("tenders")
            .update({
              status: "exported" as TenderStatus,
              export_external_id: result.providerReferenceId,
              exported_at: new Date().toISOString(),
              exported_by: authUser.user.id,
              updated_by: authUser.user.id,
            })
            .eq("id", tenderId);
        } else {
          await supabase
            .from("tenders")
            .update({
              status: "export_failed" as TenderStatus,
              updated_by: authUser.user.id,
            })
            .eq("id", tenderId);
        }

        // Log the export attempt
        await logExportAttempt(serviceClient, {
          tender_id: tenderId,
          mode: "live",
          provider: providerId,
          status: result.ok ? "success" : "failed",
          request_payload: payload as unknown as Record<string, unknown>,
          response_payload: result.rawResponse,
          external_id: result.providerReferenceId,
          error_message: result.errorMessage,
          error_code: result.errorCode,
          created_by: authUser.user.id,
          duration_ms: Date.now() - startTime,
        });

        return {
          ok: result.ok,
          mode: "live",
          providerReferenceId: result.providerReferenceId,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        };
      });
    };

    // Use idempotency wrapper
    const idempotencyResult = await withIdempotency(
      idempotencyKey,
      authUser.user.id,
      `/api/tenders/${tenderId}/export`,
      body,
      executeExport
    );

    if ("conflict" in idempotencyResult) {
      return NextResponse.json({
        error: idempotencyResult.message,
      }, { status: 409 });
    }

    const { response, fromCache } = idempotencyResult;

    return NextResponse.json({
      ...response,
      cached: fromCache,
    });

  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err instanceof TenderLockError) {
      return NextResponse.json({
        error: "Tender is currently processing",
        lock_reason: err.lockReason,
        locked_by: err.lockedBy,
      }, { status: 409 });
    }
    console.error("Export POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Helper to log export attempts
 */
async function logExportAttempt(
  supabase: ReturnType<typeof createServiceClient>,
  log: {
    tender_id: string;
    mode: "dry_run" | "live";
    provider: string;
    status: "pending" | "success" | "failed";
    request_payload?: Record<string, unknown>;
    mapped_payload?: Record<string, unknown>;
    response_payload?: Record<string, unknown>;
    external_id?: string;
    error_message?: string;
    error_code?: string;
    created_by?: string;
    duration_ms?: number;
  }
) {
  try {
    await supabase.from("export_attempts").insert({
      tender_id: log.tender_id,
      mode: log.mode,
      provider: log.provider,
      status: log.status,
      request_payload: log.request_payload || null,
      mapped_payload: log.mapped_payload || null,
      response_payload: log.response_payload || null,
      external_id: log.external_id || null,
      error_message: log.error_message || null,
      error_code: log.error_code || null,
      created_by: log.created_by || null,
      duration_ms: log.duration_ms || null,
    });
  } catch (err) {
    console.error("Failed to log export attempt:", err);
  }
}
