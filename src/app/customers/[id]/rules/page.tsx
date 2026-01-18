"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CustomerProfile,
  ReferenceLabelRule,
  ReferenceRegexRule,
  RuleStatus,
} from "@/lib/types";

interface RuleWithStatus extends ReferenceLabelRule {
  status?: RuleStatus;
  disabled_at?: string;
  disabled_by?: string;
}

interface RegexRuleWithStatus extends ReferenceRegexRule {
  status?: RuleStatus;
  disabled_at?: string;
  disabled_by?: string;
}

type LoadingState = "loading" | "loaded" | "error";

export default function RulesGovernancePage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch customer profile
  const fetchCustomer = useCallback(async () => {
    try {
      const res = await fetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error("Failed to load customer");
      const result = await res.json();
      setCustomer(result.customer);
      setLoadingState("loaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoadingState("error");
    }
  }, [customerId]);

  useEffect(() => {
    if (customerId) fetchCustomer();
  }, [customerId, fetchCustomer]);

  // Toggle rule status
  const toggleLabelRule = async (index: number) => {
    if (!customer) return;
    setSaving(true);

    const rules = [...customer.reference_label_rules] as RuleWithStatus[];
    const currentStatus = rules[index].status || "active";
    rules[index] = {
      ...rules[index],
      status: currentStatus === "active" ? "deprecated" : "active",
      disabled_at: currentStatus === "active" ? new Date().toISOString() : undefined,
    };

    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_label_rules: rules }),
      });

      if (!res.ok) throw new Error("Failed to update rule");
      
      setCustomer({ ...customer, reference_label_rules: rules });
    } catch (err) {
      console.error("Error toggling rule:", err);
    } finally {
      setSaving(false);
    }
  };

  const toggleRegexRule = async (index: number) => {
    if (!customer) return;
    setSaving(true);

    const rules = [...customer.reference_regex_rules] as RegexRuleWithStatus[];
    const currentStatus = rules[index].status || "active";
    rules[index] = {
      ...rules[index],
      status: currentStatus === "active" ? "deprecated" : "active",
      disabled_at: currentStatus === "active" ? new Date().toISOString() : undefined,
    };

    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_regex_rules: rules }),
      });

      if (!res.ok) throw new Error("Failed to update rule");
      
      setCustomer({ ...customer, reference_regex_rules: rules });
    } catch (err) {
      console.error("Error toggling rule:", err);
    } finally {
      setSaving(false);
    }
  };

  // Delete a rule
  const deleteLabelRule = async (index: number) => {
    if (!customer || !confirm("Are you sure you want to delete this rule?")) return;
    setSaving(true);

    const rules = customer.reference_label_rules.filter((_, i) => i !== index);

    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_label_rules: rules }),
      });

      if (!res.ok) throw new Error("Failed to delete rule");
      
      setCustomer({ ...customer, reference_label_rules: rules });
    } catch (err) {
      console.error("Error deleting rule:", err);
    } finally {
      setSaving(false);
    }
  };

  const deleteRegexRule = async (index: number) => {
    if (!customer || !confirm("Are you sure you want to delete this rule?")) return;
    setSaving(true);

    const rules = customer.reference_regex_rules.filter((_, i) => i !== index);

    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_regex_rules: rules }),
      });

      if (!res.ok) throw new Error("Failed to delete rule");
      
      setCustomer({ ...customer, reference_regex_rules: rules });
    } catch (err) {
      console.error("Error deleting rule:", err);
    } finally {
      setSaving(false);
    }
  };

  if (loadingState === "loading") {
    return (
      <div className="min-h-screen bg-bg-primary">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="flex items-center justify-center py-20">
            <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-3 text-text-secondary">Loading customer rules...</span>
          </div>
        </div>
      </div>
    );
  }

  if (loadingState === "error" || !customer) {
    return (
      <div className="min-h-screen bg-bg-primary">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="rounded-lg border border-error/30 bg-error/10 p-6">
            <h2 className="font-medium text-error">Error Loading Customer</h2>
            <p className="mt-2 text-sm text-text-secondary">{error}</p>
            <button
              onClick={() => router.push("/")}
              className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const labelRules = customer.reference_label_rules as RuleWithStatus[];
  const regexRules = customer.reference_regex_rules as RegexRuleWithStatus[];
  const hasCargoHints = customer.cargo_hints?.commodity_by_temp && 
    Object.keys(customer.cargo_hints.commodity_by_temp).length > 0;

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="border-b border-border bg-bg-secondary">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary">
                Rules for {customer.name}
              </h1>
              <p className="text-sm text-text-secondary">
                Manage learned rules and cargo defaults
              </p>
            </div>
            <button
              onClick={() => router.back()}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-input"
            >
              ← Back
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6 space-y-8">
        {/* Label Rules Section */}
        <section>
          <h2 className="mb-4 text-lg font-medium text-text-primary">
            Label Rules ({labelRules.length})
          </h2>
          {labelRules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-text-muted">No label rules learned yet.</p>
              <p className="mt-1 text-sm text-text-muted">
                Rules are learned automatically when you reclassify reference numbers.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {labelRules.map((rule, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between rounded-lg border p-4 ${
                    rule.status === "deprecated"
                      ? "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 opacity-60"
                      : "border-border bg-bg-secondary"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-text-primary">"{rule.label}"</span>
                      <span className="text-text-muted">→</span>
                      <span className="rounded bg-accent/10 px-2 py-0.5 text-sm font-medium text-accent">
                        {rule.subtype.toUpperCase()}
                      </span>
                      {rule.status === "deprecated" && (
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                          DEPRECATED
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Confidence: {Math.round(rule.confidence * 100)}% • 
                      Created: {new Date(rule.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleLabelRule(index)}
                      disabled={saving}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        rule.status === "deprecated"
                          ? "bg-success/10 text-success hover:bg-success/20"
                          : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                      } disabled:opacity-50`}
                    >
                      {rule.status === "deprecated" ? "Enable" : "Deprecate"}
                    </button>
                    <button
                      onClick={() => deleteLabelRule(index)}
                      disabled={saving}
                      className="rounded-md bg-error/10 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/20 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Regex Rules Section */}
        <section>
          <h2 className="mb-4 text-lg font-medium text-text-primary">
            Regex Rules ({regexRules.length})
          </h2>
          {regexRules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-text-muted">No regex rules defined.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {regexRules.map((rule, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between rounded-lg border p-4 ${
                    rule.status === "deprecated"
                      ? "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 opacity-60"
                      : "border-border bg-bg-secondary"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <code className="rounded bg-bg-input px-2 py-0.5 font-mono text-sm text-text-primary">
                        {rule.pattern}
                      </code>
                      <span className="text-text-muted">→</span>
                      <span className="rounded bg-accent/10 px-2 py-0.5 text-sm font-medium text-accent">
                        {rule.subtype.toUpperCase()}
                      </span>
                      {rule.status === "deprecated" && (
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                          DEPRECATED
                        </span>
                      )}
                    </div>
                    {rule.description && (
                      <p className="mt-1 text-xs text-text-muted">{rule.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRegexRule(index)}
                      disabled={saving}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        rule.status === "deprecated"
                          ? "bg-success/10 text-success hover:bg-success/20"
                          : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                      } disabled:opacity-50`}
                    >
                      {rule.status === "deprecated" ? "Enable" : "Deprecate"}
                    </button>
                    <button
                      onClick={() => deleteRegexRule(index)}
                      disabled={saving}
                      className="rounded-md bg-error/10 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/20 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Cargo Hints Section */}
        <section>
          <h2 className="mb-4 text-lg font-medium text-text-primary">
            Cargo Defaults
          </h2>
          {!hasCargoHints ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-text-muted">No cargo defaults learned yet.</p>
              <p className="mt-1 text-sm text-text-muted">
                Cargo defaults are learned when you set commodity based on temperature.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <h3 className="mb-3 text-sm font-medium text-text-secondary">
                Commodity by Temperature
              </h3>
              <div className="space-y-2">
                {customer.cargo_hints?.commodity_by_temp?.frozen && (
                  <div className="flex items-center gap-3">
                    <span className="w-24 rounded bg-blue-100 px-2 py-1 text-center text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      FROZEN
                    </span>
                    <span className="text-text-primary">
                      {customer.cargo_hints.commodity_by_temp.frozen}
                    </span>
                  </div>
                )}
                {customer.cargo_hints?.commodity_by_temp?.refrigerated && (
                  <div className="flex items-center gap-3">
                    <span className="w-24 rounded bg-cyan-100 px-2 py-1 text-center text-xs font-medium text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">
                      REEFER
                    </span>
                    <span className="text-text-primary">
                      {customer.cargo_hints.commodity_by_temp.refrigerated}
                    </span>
                  </div>
                )}
                {customer.cargo_hints?.commodity_by_temp?.dry && (
                  <div className="flex items-center gap-3">
                    <span className="w-24 rounded bg-amber-100 px-2 py-1 text-center text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      DRY
                    </span>
                    <span className="text-text-primary">
                      {customer.cargo_hints.commodity_by_temp.dry}
                    </span>
                  </div>
                )}
              </div>
              {customer.cargo_hints?.default_commodity && (
                <div className="mt-4 pt-3 border-t border-border">
                  <span className="text-sm text-text-muted">Default commodity: </span>
                  <span className="text-text-primary">{customer.cargo_hints.default_commodity}</span>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
