import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * GET /api/customers - List all customer profiles
 */
export async function GET() {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("customer_profiles")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching customers:", error);
      return NextResponse.json(
        { error: "Failed to fetch customers" },
        { status: 500 }
      );
    }

    return NextResponse.json({ customers: data || [] });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customers - Create a new customer profile
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, code, notes } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Customer name is required" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("customer_profiles")
      .insert({
        name: name.trim(),
        code: code?.trim() || null,
        reference_label_rules: [],
        reference_regex_rules: [],
        stop_parsing_hints: {},
        notes: notes?.trim() || null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error creating customer:", error);
      return NextResponse.json(
        { error: "Failed to create customer" },
        { status: 500 }
      );
    }

    return NextResponse.json({ customer: data }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
