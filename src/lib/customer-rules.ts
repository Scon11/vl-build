/**
 * Customer Rules Utilities
 * 
 * Functions for managing customer-specific rules with lifecycle.
 * Uses the customer_rules table with proposed/active/deprecated status.
 */

import { createServiceClient } from "./supabase/service";
import { CustomerRule, CustomerRuleType, RuleStatus, SuggestedRule, LearningEvent } from "./types";

/**
 * Get all active rules for a customer.
 */
export async function getActiveRules(customerId: string): Promise<CustomerRule[]> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("customer_rules")
    .select("*")
    .eq("customer_id", customerId)
    .eq("status", "active")
    .order("confidence", { ascending: false });

  if (error) {
    console.error("[CustomerRules] Error fetching active rules:", error);
    return [];
  }

  return data || [];
}

/**
 * Get all rules for a customer (any status).
 */
export async function getAllRules(customerId: string): Promise<CustomerRule[]> {
  const supabase = createServiceClient();
  
  const { data, error } = await supabase
    .from("customer_rules")
    .select("*")
    .eq("customer_id", customerId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[CustomerRules] Error fetching rules:", error);
    return [];
  }

  return data || [];
}

/**
 * Get rules grouped by status.
 */
export async function getRulesGrouped(customerId: string): Promise<{
  proposed: CustomerRule[];
  active: CustomerRule[];
  deprecated: CustomerRule[];
}> {
  const rules = await getAllRules(customerId);
  
  return {
    proposed: rules.filter(r => r.status === "proposed"),
    active: rules.filter(r => r.status === "active"),
    deprecated: rules.filter(r => r.status === "deprecated"),
  };
}

/**
 * Create a proposed rule from a suggested rule.
 */
export async function createProposedRule(
  customerId: string,
  suggestedRule: SuggestedRule,
  tenderId: string,
  createdBy: string
): Promise<CustomerRule | null> {
  const supabase = createServiceClient();

  const rule: Partial<CustomerRule> = {
    customer_id: customerId,
    rule_type: suggestedRule.type === "label" ? "label_map" : "regex_map",
    pattern: suggestedRule.type === "label" ? suggestedRule.label! : suggestedRule.pattern!,
    target_value: suggestedRule.subtype,
    description: `Learned from tender: ${suggestedRule.example_value}`,
    status: "proposed",
    confidence: 0.5,
    created_by: createdBy,
    learned_from_tender: tenderId,
  };

  const { data, error } = await supabase
    .from("customer_rules")
    .insert(rule)
    .select()
    .single();

  if (error) {
    console.error("[CustomerRules] Error creating proposed rule:", error);
    return null;
  }

  return data;
}

/**
 * Create proposed rules from learning events.
 * This is called from detectAllEdits when a user makes corrections.
 */
export async function createProposedRulesFromEvents(
  learningEvents: LearningEvent[],
  createdBy: string
): Promise<number> {
  const supabase = createServiceClient();
  let created = 0;

  for (const event of learningEvents) {
    if (!event.customer_id || !event.tender_id) continue;

    let ruleType: CustomerRuleType | null = null;
    let pattern = "";
    let targetValue = "";
    let description = "";

    switch (event.field_type) {
      case "reference_subtype":
        // Create label_map rule if we have a label hint
        if (event.context.label_hint) {
          ruleType = "label_map";
          pattern = event.context.label_hint;
          targetValue = String(event.after_value);
          description = `Label "${pattern}" maps to ${targetValue}`;
        }
        break;

      case "cargo_commodity":
        // Create cargo_hint rule for temperature-based commodity
        if (event.context.temperature_mode || event.context.temperature_value !== undefined) {
          ruleType = "cargo_hint";
          // Use temperature mode or derive from value
          if (event.context.temperature_mode) {
            pattern = event.context.temperature_mode;
          } else if (event.context.temperature_value !== undefined) {
            const temp = event.context.temperature_value;
            if (temp < 32) pattern = "frozen";
            else if (temp <= 45) pattern = "refrigerated";
            else pattern = "dry";
          }
          targetValue = String(event.after_value);
          description = `${pattern} commodity default: ${targetValue}`;
        }
        break;
    }

    if (ruleType && pattern && targetValue) {
      // Check if similar rule already exists
      const { data: existing } = await supabase
        .from("customer_rules")
        .select("id")
        .eq("customer_id", event.customer_id)
        .eq("rule_type", ruleType)
        .eq("pattern", pattern.toLowerCase())
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase
          .from("customer_rules")
          .insert({
            customer_id: event.customer_id,
            rule_type: ruleType,
            pattern: pattern.toLowerCase(),
            target_value: targetValue,
            description,
            status: "proposed",
            confidence: 0.5,
            created_by: createdBy,
            learned_from_tender: event.tender_id,
          });

        if (!error) {
          created++;
          console.log(`[CustomerRules] Created proposed rule: ${description}`);
        }
      }
    }
  }

  return created;
}

/**
 * Approve a proposed rule (proposed -> active).
 */
export async function approveRule(
  ruleId: string,
  approvedBy: string
): Promise<boolean> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("customer_rules")
    .update({
      status: "active" as RuleStatus,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .eq("status", "proposed");

  if (error) {
    console.error("[CustomerRules] Error approving rule:", error);
    return false;
  }

  return true;
}

/**
 * Deprecate a rule (any -> deprecated).
 */
export async function deprecateRule(
  ruleId: string,
  deprecatedBy: string
): Promise<boolean> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("customer_rules")
    .update({
      status: "deprecated" as RuleStatus,
      deprecated_by: deprecatedBy,
      deprecated_at: new Date().toISOString(),
    })
    .eq("id", ruleId);

  if (error) {
    console.error("[CustomerRules] Error deprecating rule:", error);
    return false;
  }

  return true;
}

/**
 * Reactivate a deprecated rule (deprecated -> active).
 */
export async function reactivateRule(
  ruleId: string,
  approvedBy: string
): Promise<boolean> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("customer_rules")
    .update({
      status: "active" as RuleStatus,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      deprecated_by: null,
      deprecated_at: null,
    })
    .eq("id", ruleId)
    .eq("status", "deprecated");

  if (error) {
    console.error("[CustomerRules] Error reactivating rule:", error);
    return false;
  }

  return true;
}

/**
 * Delete a rule (only proposed rules can be deleted).
 */
export async function deleteRule(ruleId: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("customer_rules")
    .delete()
    .eq("id", ruleId)
    .eq("status", "proposed"); // Only allow deleting proposed rules

  if (error) {
    console.error("[CustomerRules] Error deleting rule:", error);
    return false;
  }

  return true;
}

/**
 * Get active label map rules for extraction.
 * Returns a map of pattern -> target_value for reference label mapping.
 */
export async function getActiveLabelMapRules(
  customerId: string
): Promise<Map<string, string>> {
  const rules = await getActiveRules(customerId);
  const labelRules = rules.filter(r => r.rule_type === "label_map");
  
  return new Map(
    labelRules.map(r => [r.pattern.toLowerCase(), r.target_value])
  );
}

/**
 * Get active regex map rules for extraction.
 */
export async function getActiveRegexMapRules(
  customerId: string
): Promise<Array<{ pattern: string; target_value: string }>> {
  const rules = await getActiveRules(customerId);
  return rules
    .filter(r => r.rule_type === "regex_map")
    .map(r => ({ pattern: r.pattern, target_value: r.target_value }));
}

/**
 * Get active cargo hint rules.
 * Returns a map of temperature_mode -> commodity.
 */
export async function getActiveCargoHintRules(
  customerId: string
): Promise<Map<string, string>> {
  const rules = await getActiveRules(customerId);
  const cargoRules = rules.filter(r => r.rule_type === "cargo_hint");
  
  return new Map(
    cargoRules.map(r => [r.pattern.toLowerCase(), r.target_value])
  );
}
