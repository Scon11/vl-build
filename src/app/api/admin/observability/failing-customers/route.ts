import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { getFailingCustomers } from "@/lib/llm-usage";

/**
 * GET /api/admin/observability/failing-customers
 * 
 * Returns customers ranked by failure/warning rates.
 * Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "7", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const customers = await getFailingCustomers(startDate, endDate, limit);

    return NextResponse.json({
      customers,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        days,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("[Admin/FailingCustomers] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
