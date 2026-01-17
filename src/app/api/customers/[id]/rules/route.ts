import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import {
  ReferenceLabelRule,
  ReferenceRegexRule,
  ReferenceNumberSubtype,
} from "@/lib/types";

/**
 * POST /api/customers/[id]/rules - Add a new rule to the customer profile
 *
 * Body:
 * - type: "label" | "regex"
 * - label?: string (for label rules)
 * - pattern?: string (for regex rules)
 * - subtype: ReferenceNumberSubtype
 * - description?: string
 * - learned_from?: string (tender_id)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const body = await request.json();
    const { type, label, pattern, subtype, description, learned_from } = body;

    if (!type || !subtype) {
      return NextResponse.json(
        { error: "type and subtype are required" },
        { status: 400 }
      );
    }

    if (type === "label" && !label) {
      return NextResponse.json(
        { error: "label is required for label rules" },
        { status: 400 }
      );
    }

    if (type === "regex" && !pattern) {
      return NextResponse.json(
        { error: "pattern is required for regex rules" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch current customer profile
    const { data: customer, error: fetchError } = await supabase
      .from("customer_profiles")
      .select("*")
      .eq("id", customerId)
      .single();

    if (fetchError || !customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    let updates: Record<string, unknown> = {};

    if (type === "label") {
      const existingRules: ReferenceLabelRule[] =
        customer.reference_label_rules || [];

      // Check if rule already exists (update confidence if so)
      const existingIndex = existingRules.findIndex(
        (r) => r.label.toLowerCase() === label.toLowerCase()
      );

      if (existingIndex >= 0) {
        // Update existing rule - increase confidence
        existingRules[existingIndex] = {
          ...existingRules[existingIndex],
          subtype: subtype as ReferenceNumberSubtype,
          confidence: Math.min(
            1,
            existingRules[existingIndex].confidence + 0.1
          ),
        };
      } else {
        // Add new rule
        const newRule: ReferenceLabelRule = {
          label: label.trim(),
          subtype: subtype as ReferenceNumberSubtype,
          confidence: 0.5, // Initial confidence
          learned_from,
          created_at: new Date().toISOString(),
        };
        existingRules.push(newRule);
      }

      updates = { reference_label_rules: existingRules };
    } else if (type === "regex") {
      const existingRules: ReferenceRegexRule[] =
        customer.reference_regex_rules || [];

      // Check if pattern already exists
      const existingIndex = existingRules.findIndex(
        (r) => r.pattern === pattern
      );

      if (existingIndex >= 0) {
        // Update existing rule
        existingRules[existingIndex] = {
          ...existingRules[existingIndex],
          subtype: subtype as ReferenceNumberSubtype,
          confidence: Math.min(
            1,
            existingRules[existingIndex].confidence + 0.1
          ),
        };
      } else {
        // Add new rule
        const newRule: ReferenceRegexRule = {
          pattern,
          subtype: subtype as ReferenceNumberSubtype,
          description: description || null,
          confidence: 0.5,
          learned_from,
          created_at: new Date().toISOString(),
        };
        existingRules.push(newRule);
      }

      updates = { reference_regex_rules: existingRules };
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("customer_profiles")
      .update(updates)
      .eq("id", customerId)
      .select("*")
      .single();

    if (updateError) {
      console.error("Error updating customer rules:", updateError);
      return NextResponse.json(
        { error: "Failed to add rule" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      customer: updated,
      message: "Rule added successfully",
    });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customers/[id]/rules - Remove a rule from the customer profile
 *
 * Body:
 * - type: "label" | "regex"
 * - label?: string (for label rules)
 * - pattern?: string (for regex rules)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params;
    const body = await request.json();
    const { type, label, pattern } = body;

    if (!type) {
      return NextResponse.json(
        { error: "type is required" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data: customer, error: fetchError } = await supabase
      .from("customer_profiles")
      .select("*")
      .eq("id", customerId)
      .single();

    if (fetchError || !customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    let updates: Record<string, unknown> = {};

    if (type === "label" && label) {
      const existingRules: ReferenceLabelRule[] =
        customer.reference_label_rules || [];
      const filteredRules = existingRules.filter(
        (r) => r.label.toLowerCase() !== label.toLowerCase()
      );
      updates = { reference_label_rules: filteredRules };
    } else if (type === "regex" && pattern) {
      const existingRules: ReferenceRegexRule[] =
        customer.reference_regex_rules || [];
      const filteredRules = existingRules.filter((r) => r.pattern !== pattern);
      updates = { reference_regex_rules: filteredRules };
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("customer_profiles")
      .update(updates)
      .eq("id", customerId)
      .select("*")
      .single();

    if (updateError) {
      console.error("Error removing rule:", updateError);
      return NextResponse.json(
        { error: "Failed to remove rule" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      customer: updated,
      message: "Rule removed successfully",
    });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
