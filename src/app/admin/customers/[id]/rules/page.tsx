"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { CustomerRule, CustomerProfile } from "@/lib/types";

type RuleAction = "approve" | "deprecate" | "reactivate" | "delete";

interface GroupedRules {
  proposed: CustomerRule[];
  active: CustomerRule[];
  deprecated: CustomerRule[];
}

export default function AdminRulesPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [rules, setRules] = useState<CustomerRule[]>([]);
  const [grouped, setGrouped] = useState<GroupedRules>({
    proposed: [],
    active: [],
    deprecated: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch customer and rules
  const fetchData = useCallback(async () => {
    try {
      // Fetch customer
      const customerRes = await fetch(`/api/customers/${customerId}`);
      if (!customerRes.ok) {
        throw new Error("Customer not found");
      }
      const customerData = await customerRes.json();
      setCustomer(customerData.customer);

      // Fetch rules
      const rulesRes = await fetch(`/api/admin/customers/${customerId}/rules`);
      if (!rulesRes.ok) {
        const errData = await rulesRes.json();
        if (rulesRes.status === 403) {
          throw new Error("Access denied. Admin privileges required.");
        }
        throw new Error(errData.error || "Failed to fetch rules");
      }
      const rulesData = await rulesRes.json();
      setRules(rulesData.rules);
      setGrouped(rulesData.grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle rule action
  const handleAction = async (ruleId: string, action: RuleAction) => {
    setActionLoading(ruleId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId, action }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${action} rule`);
      }

      // Refresh rules
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} rule`);
    } finally {
      setActionLoading(null);
    }
  };

  // Rule type badge
  const RuleTypeBadge = ({ type }: { type: string }) => {
    const colors = {
      label_map: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      regex_map: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
      cargo_hint: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[type as keyof typeof colors] || "bg-gray-100"}`}>
        {type.replace("_", " ").toUpperCase()}
      </span>
    );
  };

  // Rule card component
  const RuleCard = ({ rule, status }: { rule: CustomerRule; status: "proposed" | "active" | "deprecated" }) => {
    const isLoading = actionLoading === rule.id;

    return (
      <div className="border border-border rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <RuleTypeBadge type={rule.rule_type} />
              <span className="text-xs text-text-muted">
                Confidence: {Math.round(rule.confidence * 100)}%
              </span>
            </div>
            <div className="mb-1">
              <span className="font-mono text-sm bg-bg-input px-2 py-0.5 rounded">
                {rule.pattern}
              </span>
              <span className="mx-2 text-text-muted">→</span>
              <span className="font-medium text-accent">{rule.target_value}</span>
            </div>
            {rule.description && (
              <p className="text-sm text-text-muted mt-1">{rule.description}</p>
            )}
            {rule.learned_from_tender && (
              <a
                href={`/tenders/${rule.learned_from_tender}/review`}
                className="text-xs text-accent hover:underline mt-1 inline-block"
              >
                View source tender
              </a>
            )}
          </div>
          <div className="flex flex-col gap-1 ml-4">
            {status === "proposed" && (
              <>
                <button
                  onClick={() => handleAction(rule.id, "approve")}
                  disabled={isLoading}
                  className="px-3 py-1 text-xs font-medium rounded bg-success text-white hover:bg-success/90 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleAction(rule.id, "delete")}
                  disabled={isLoading}
                  className="px-3 py-1 text-xs font-medium rounded bg-error text-white hover:bg-error/90 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}
            {status === "active" && (
              <button
                onClick={() => handleAction(rule.id, "deprecate")}
                disabled={isLoading}
                className="px-3 py-1 text-xs font-medium rounded border border-border text-text-primary hover:bg-bg-input disabled:opacity-50"
              >
                Deprecate
              </button>
            )}
            {status === "deprecated" && (
              <button
                onClick={() => handleAction(rule.id, "reactivate")}
                disabled={isLoading}
                className="px-3 py-1 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Reactivate
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 text-xs text-text-muted">
          Created: {new Date(rule.created_at).toLocaleDateString()}
          {rule.approved_at && ` • Approved: ${new Date(rule.approved_at).toLocaleDateString()}`}
          {rule.deprecated_at && ` • Deprecated: ${new Date(rule.deprecated_at).toLocaleDateString()}`}
        </div>
      </div>
    );
  };

  // Section component
  const RulesSection = ({ 
    title, 
    rules, 
    status, 
    emptyMessage,
    badge,
  }: { 
    title: string; 
    rules: CustomerRule[]; 
    status: "proposed" | "active" | "deprecated";
    emptyMessage: string;
    badge?: React.ReactNode;
  }) => (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-bg-input text-text-muted">
          {rules.length}
        </span>
        {badge}
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-text-muted py-4">{emptyMessage}</p>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <RuleCard key={rule.id} rule={rule} status={status} />
          ))}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="flex items-center justify-center py-20">
            <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-3 text-text-secondary">Loading rules...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg-primary">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="rounded-lg border border-error/30 bg-error/10 p-6">
            <h2 className="font-medium text-error">Error</h2>
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

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="border-b border-border bg-bg-secondary">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary">
                Rules Governance
              </h1>
              <p className="text-sm text-text-muted">
                Customer: {customer?.name || customerId}
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

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Proposed Rules */}
        <RulesSection
          title="Proposed Rules"
          rules={grouped.proposed}
          status="proposed"
          emptyMessage="No proposed rules awaiting review."
          badge={
            grouped.proposed.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                Needs Review
              </span>
            )
          }
        />

        {/* Active Rules */}
        <RulesSection
          title="Active Rules"
          rules={grouped.active}
          status="active"
          emptyMessage="No active rules. Approve proposed rules to activate them."
        />

        {/* Deprecated Rules */}
        <RulesSection
          title="Deprecated Rules"
          rules={grouped.deprecated}
          status="deprecated"
          emptyMessage="No deprecated rules."
        />

        {/* Summary */}
        <div className="mt-8 pt-8 border-t border-border">
          <h3 className="text-sm font-medium text-text-muted mb-2">Summary</h3>
          <p className="text-sm text-text-secondary">
            Total rules: {rules.length} • 
            Active: {grouped.active.length} • 
            Pending: {grouped.proposed.length} • 
            Deprecated: {grouped.deprecated.length}
          </p>
        </div>
      </div>
    </div>
  );
}
