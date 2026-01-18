import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth";
import {
  getAllRules,
  approveRule,
  deprecateRule,
  reactivateRule,
  deleteRule,
} from "@/lib/customer-rules";

/**
 * GET /api/admin/customers/[id]/rules
 * Get all rules for a customer (admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: customerId } = await params;

    const rules = await getAllRules(customerId);

    // Group by status
    const grouped = {
      proposed: rules.filter(r => r.status === "proposed"),
      active: rules.filter(r => r.status === "active"),
      deprecated: rules.filter(r => r.status === "deprecated"),
    };

    return NextResponse.json({
      rules,
      grouped,
      counts: {
        proposed: grouped.proposed.length,
        active: grouped.active.length,
        deprecated: grouped.deprecated.length,
        total: rules.length,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Admin rules GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/customers/[id]/rules
 * Update a rule's status (approve, deprecate, reactivate)
 * 
 * Body:
 * - rule_id: string
 * - action: "approve" | "deprecate" | "reactivate" | "delete"
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAdmin();
    const { id: customerId } = await params;

    const body = await request.json();
    const { rule_id, action } = body as {
      rule_id: string;
      action: "approve" | "deprecate" | "reactivate" | "delete";
    };

    if (!rule_id || !action) {
      return NextResponse.json(
        { error: "rule_id and action are required" },
        { status: 400 }
      );
    }

    let success = false;

    switch (action) {
      case "approve":
        success = await approveRule(rule_id, authUser.user.id);
        break;
      case "deprecate":
        success = await deprecateRule(rule_id, authUser.user.id);
        break;
      case "reactivate":
        success = await reactivateRule(rule_id, authUser.user.id);
        break;
      case "delete":
        success = await deleteRule(rule_id);
        break;
      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }

    if (!success) {
      return NextResponse.json(
        { error: `Failed to ${action} rule` },
        { status: 500 }
      );
    }

    // Return updated rules
    const rules = await getAllRules(customerId);

    return NextResponse.json({
      success: true,
      action,
      rule_id,
      rules,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Admin rules PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
