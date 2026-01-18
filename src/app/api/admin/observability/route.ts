import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import { getLLMUsageSummary, getTopUsersByUsage } from "@/lib/llm-usage";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/observability
 * 
 * Returns LLM usage summary for the specified period.
 * Admin only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "7", 10);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get usage summary
    const summary = await getLLMUsageSummary(startDate, endDate);

    // Get top users
    const topUsersRaw = await getTopUsersByUsage(startDate, endDate, 10);

    // Enrich with user emails
    const supabase = createServiceClient();
    const userIds = topUsersRaw.map((u) => u.userId);
    
    let userEmails: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("id, email")
        .in("id", userIds);
      
      if (profiles) {
        for (const p of profiles) {
          userEmails[p.id] = p.email;
        }
      }
    }

    const topUsers = topUsersRaw.map((u) => ({
      ...u,
      email: userEmails[u.userId],
    }));

    return NextResponse.json({
      summary,
      topUsers,
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
    console.error("[Admin/Observability] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
