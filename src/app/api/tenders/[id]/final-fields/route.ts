import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { StructuredShipment, SuggestedRule, LearningEvent, CargoHints, CustomerProfile } from "@/lib/types";
import { detectReclassifications, detectAllEdits, isRuleAlreadyLearned } from "@/lib/learning-detector";

// GET final fields for a tender
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("final_fields")
      .select("*")
      .eq("tender_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found, which is fine
      console.error("Error fetching final fields:", error);
      return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
    }

    return NextResponse.json({ final_fields: data || null });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST/PUT final fields (save reviewed data)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenderId } = await params;
    const body = await request.json();
    const { shipment, customer_id, apply_suggested_rules } = body as {
      shipment: StructuredShipment;
      customer_id?: string;
      apply_suggested_rules?: SuggestedRule[];
    };

    if (!shipment) {
      return NextResponse.json(
        { error: "shipment data is required" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Check if tender exists and get extraction run
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .select("id, status, customer_id, original_text")
      .eq("id", tenderId)
      .single();

    if (tenderError || !tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    // Get the extraction run to compare with original LLM output
    const { data: extractionRun } = await supabase
      .from("extraction_runs")
      .select("llm_output, candidates")
      .eq("tender_id", tenderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Detect reclassifications for learning (reference number rules)
    let suggestedRules: SuggestedRule[] = [];
    let learningEvents: LearningEvent[] = [];
    const effectiveCustomerId = customer_id ?? tender.customer_id;

    // Fetch customer profile to check for existing rules
    let customerProfile: CustomerProfile | null = null;
    if (effectiveCustomerId) {
      const { data } = await supabase
        .from("customer_profiles")
        .select("*")
        .eq("id", effectiveCustomerId)
        .single();
      customerProfile = data as CustomerProfile | null;
    }

    if (extractionRun?.llm_output && extractionRun?.candidates && tender.original_text) {
      // Detect reference number reclassifications (for suggested rules UI)
      const allSuggestedRules = detectReclassifications({
        originalShipment: extractionRun.llm_output as StructuredShipment,
        finalShipment: shipment,
        candidates: extractionRun.candidates,
        originalText: tender.original_text,
      });
      
      // Filter out rules that have already been learned for this customer
      if (customerProfile) {
        suggestedRules = allSuggestedRules.filter((rule) => {
          const alreadyLearned = isRuleAlreadyLearned(
            rule,
            customerProfile!.reference_label_rules || [],
            customerProfile!.reference_regex_rules || []
          );
          if (alreadyLearned) {
            console.log(`[Learning] Skipping already-learned rule: ${rule.label || rule.pattern} -> ${rule.subtype}`);
          }
          return !alreadyLearned;
        });
      } else {
        suggestedRules = allSuggestedRules;
      }
      
      // Detect ALL edits for global learning (cargo, refs, etc.)
      learningEvents = detectAllEdits({
        originalShipment: extractionRun.llm_output as StructuredShipment,
        finalShipment: shipment,
        candidates: extractionRun.candidates,
        originalText: tender.original_text,
        customerId: effectiveCustomerId || undefined,
        tenderId,
      });
      
      console.log("[Learning] Suggested rules (after filtering):", suggestedRules.length);
      console.log("[Learning] Learning events:", learningEvents.length);
    }

    // Store learning events in database for future use
    if (learningEvents.length > 0 && effectiveCustomerId) {
      await storeLearningEvents(supabase, learningEvents);
      
      // Auto-apply cargo commodity rules based on temperature
      await applyLearnedCargoDefaults(supabase, effectiveCustomerId, learningEvents);
    }

    // Check if final_fields already exist
    const { data: existing } = await supabase
      .from("final_fields")
      .select("id")
      .eq("tender_id", tenderId)
      .single();

    let finalFieldsResult;

    if (existing) {
      // Update existing
      finalFieldsResult = await supabase
        .from("final_fields")
        .update({
          shipment,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id")
        .single();
    } else {
      // Insert new
      finalFieldsResult = await supabase
        .from("final_fields")
        .insert({
          tender_id: tenderId,
          shipment,
        })
        .select("id")
        .single();
    }

    if (finalFieldsResult.error) {
      console.error("Error saving final fields:", finalFieldsResult.error);
      return NextResponse.json(
        { error: "Failed to save final fields" },
        { status: 500 }
      );
    }

    // Update tender status and customer assignment
    const tenderUpdates: Record<string, unknown> = {
      status: "reviewed",
      reviewed_at: new Date().toISOString(),
    };

    // Update customer_id if provided
    if (customer_id !== undefined) {
      tenderUpdates.customer_id = customer_id || null;
    }

    await supabase.from("tenders").update(tenderUpdates).eq("id", tenderId);

    // Apply suggested rules to customer profile if requested
    if (apply_suggested_rules?.length && effectiveCustomerId) {
      for (const rule of apply_suggested_rules) {
        await applyRuleToCustomer(supabase, effectiveCustomerId, rule, tenderId);
      }
    }

    return NextResponse.json(
      {
        id: finalFieldsResult.data.id,
        message: "Final fields saved successfully",
        suggested_rules: suggestedRules,
      },
      { status: existing ? 200 : 201 }
    );
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Store learning events in the database.
 */
async function storeLearningEvents(
  supabase: ReturnType<typeof createServerClient>,
  events: LearningEvent[]
) {
  if (events.length === 0) return;

  try {
    const { error } = await supabase
      .from("learning_events")
      .insert(
        events.map((e) => ({
          id: e.id,
          customer_id: e.customer_id,
          tender_id: e.tender_id,
          field_type: e.field_type,
          field_path: e.field_path,
          before_value: e.before_value !== null ? String(e.before_value) : null,
          after_value: e.after_value !== null ? String(e.after_value) : null,
          context: e.context,
          created_at: e.created_at,
        }))
      );

    if (error) {
      // Table might not exist yet - that's OK, we'll create it in migration
      console.warn("[Learning] Could not store learning events:", error.message);
    } else {
      console.log(`[Learning] Stored ${events.length} learning events`);
    }
  } catch (err) {
    console.warn("[Learning] Error storing events:", err);
  }
}

/**
 * Apply learned cargo defaults based on learning events.
 * If user sets commodity when temp is X, learn that association.
 */
async function applyLearnedCargoDefaults(
  supabase: ReturnType<typeof createServerClient>,
  customerId: string,
  events: LearningEvent[]
) {
  // Find commodity changes with temperature context (either value or mode)
  const commodityEvents = events.filter(
    (e) => e.field_type === "cargo_commodity" && e.after_value && 
           (e.context.temperature_value !== undefined || e.context.temperature_mode !== undefined)
  );

  if (commodityEvents.length === 0) {
    console.log("[Learning] No commodity events with temperature context to learn from");
    return;
  }

  try {
    // Fetch current cargo hints
    const { data: customer } = await supabase
      .from("customer_profiles")
      .select("cargo_hints")
      .eq("id", customerId)
      .single();

    if (!customer) return;

    const hints: CargoHints = customer.cargo_hints || {};
    if (!hints.commodity_by_temp) {
      hints.commodity_by_temp = {};
    }

    let updated = false;

    for (const event of commodityEvents) {
      const temp = event.context.temperature_value as number | undefined;
      const tempMode = event.context.temperature_mode as string | undefined;
      const commodity = String(event.after_value);

      console.log(`[Learning] Processing commodity event: commodity="${commodity}", temp=${temp}, mode=${tempMode}`);

      // Determine temp category from value or mode
      let category: "frozen" | "refrigerated" | "dry" | null = null;
      
      if (temp !== undefined && temp !== null) {
        // Use temperature value if available
        if (temp < 32) {
          category = "frozen";
        } else if (temp >= 32 && temp <= 45) {
          category = "refrigerated";
        } else {
          category = "dry";
        }
      } else if (tempMode) {
        // Fallback to temperature mode
        if (tempMode.toLowerCase() === "frozen") {
          category = "frozen";
        } else if (tempMode.toLowerCase() === "refrigerated" || tempMode.toLowerCase() === "reefer") {
          category = "refrigerated";
        } else if (tempMode.toLowerCase() === "dry" || tempMode.toLowerCase() === "ambient") {
          category = "dry";
        }
      }

      if (category && !hints.commodity_by_temp[category]) {
        hints.commodity_by_temp[category] = commodity;
        updated = true;
        console.log(`[Learning] Learned ${category} commodity: "${commodity}"`);
      }
    }

    if (updated) {
      console.log("[Learning] Saving updated cargo hints:", JSON.stringify(hints));
      const { error: updateError } = await supabase
        .from("customer_profiles")
        .update({ cargo_hints: hints, updated_at: new Date().toISOString() })
        .eq("id", customerId);
      
      if (updateError) {
        console.error("[Learning] Failed to save cargo hints:", updateError);
      } else {
        console.log("[Learning] Cargo hints saved successfully!");
      }
    } else {
      console.log("[Learning] No new cargo hints to save (already learned or no category determined)");
    }
  } catch (err) {
    console.warn("[Learning] Error applying cargo defaults:", err);
  }
}

/**
 * Apply a learned rule to the customer profile.
 */
async function applyRuleToCustomer(
  supabase: ReturnType<typeof createServerClient>,
  customerId: string,
  rule: SuggestedRule,
  tenderId: string
) {
  // Fetch current customer profile
  const { data: customer, error } = await supabase
    .from("customer_profiles")
    .select("reference_label_rules, reference_regex_rules")
    .eq("id", customerId)
    .single();

  if (error || !customer) {
    console.error("Failed to fetch customer for rule learning:", error);
    return;
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (rule.type === "label" && rule.label) {
    const existingRules = customer.reference_label_rules || [];
    const existingIndex = existingRules.findIndex(
      (r: { label: string }) => r.label.toLowerCase() === rule.label!.toLowerCase()
    );

    if (existingIndex >= 0) {
      // Update confidence
      existingRules[existingIndex].confidence = Math.min(
        1,
        existingRules[existingIndex].confidence + 0.1
      );
      existingRules[existingIndex].subtype = rule.subtype;
    } else {
      // Add new rule
      existingRules.push({
        label: rule.label,
        subtype: rule.subtype,
        confidence: 0.5,
        learned_from: tenderId,
        created_at: new Date().toISOString(),
      });
    }

    updates.reference_label_rules = existingRules;
  } else if (rule.type === "regex" && rule.pattern) {
    const existingRules = customer.reference_regex_rules || [];
    const existingIndex = existingRules.findIndex(
      (r: { pattern: string }) => r.pattern === rule.pattern
    );

    if (existingIndex >= 0) {
      existingRules[existingIndex].confidence = Math.min(
        1,
        existingRules[existingIndex].confidence + 0.1
      );
      existingRules[existingIndex].subtype = rule.subtype;
    } else {
      existingRules.push({
        pattern: rule.pattern,
        subtype: rule.subtype,
        confidence: 0.5,
        learned_from: tenderId,
        created_at: new Date().toISOString(),
      });
    }

    updates.reference_regex_rules = existingRules;
  }

  await supabase.from("customer_profiles").update(updates).eq("id", customerId);
}
