"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface UsageSummary {
  totalCalls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgDurationMs: number;
  errorCount: number;
  successRate: number;
  byModel: Record<string, { calls: number; tokens: number }>;
  byDay: Array<{ date: string; calls: number; tokens: number }>;
}

interface TopUser {
  userId: string;
  email?: string;
  calls: number;
  tokens: number;
}

export default function ObservabilityPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<"7d" | "30d">("7d");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const days = dateRange === "7d" ? 7 : 30;
      const res = await fetch(`/api/admin/observability?days=${days}`);
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch data");
      }

      const data = await res.json();
      setSummary(data.summary);
      setTopUsers(data.topUsers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Estimate cost (GPT-4o-mini pricing: $0.15/1M input, $0.60/1M output)
  const estimateCost = (promptTokens: number, completionTokens: number) => {
    const inputCost = (promptTokens / 1_000_000) * 0.15;
    const outputCost = (completionTokens / 1_000_000) * 0.60;
    return (inputCost + outputCost).toFixed(4);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">LLM Usage Dashboard</h1>
            <p className="text-gray-600">Monitor OpenAI API usage and costs</p>
          </div>
          <div className="flex gap-4">
            <Link
              href="/admin/observability/failing-customers"
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Failing Customers
            </Link>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as "7d" | "30d")}
              className="px-4 py-2 border border-gray-300 rounded-lg bg-white"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
        </div>

        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-2 text-gray-600">Loading...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {!loading && summary && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-sm text-gray-500">Total API Calls</p>
                <p className="text-3xl font-bold text-gray-900">{summary.totalCalls.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-sm text-gray-500">Total Tokens</p>
                <p className="text-3xl font-bold text-gray-900">{summary.totalTokens.toLocaleString()}</p>
                <p className="text-xs text-gray-400">
                  {summary.promptTokens.toLocaleString()} in / {summary.completionTokens.toLocaleString()} out
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-sm text-gray-500">Estimated Cost</p>
                <p className="text-3xl font-bold text-green-600">
                  ${estimateCost(summary.promptTokens, summary.completionTokens)}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-sm text-gray-500">Success Rate</p>
                <p className={`text-3xl font-bold ${summary.successRate >= 95 ? "text-green-600" : summary.successRate >= 80 ? "text-yellow-600" : "text-red-600"}`}>
                  {summary.successRate}%
                </p>
                <p className="text-xs text-gray-400">{summary.errorCount} errors</p>
              </div>
            </div>

            {/* Avg Duration */}
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <h2 className="text-lg font-semibold mb-4">Performance</h2>
              <div className="flex gap-8">
                <div>
                  <p className="text-sm text-gray-500">Avg Duration</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.avgDurationMs.toLocaleString()}ms</p>
                </div>
              </div>
            </div>

            {/* By Model */}
            {Object.keys(summary.byModel).length > 0 && (
              <div className="bg-white rounded-lg shadow p-6 mb-8">
                <h2 className="text-lg font-semibold mb-4">Usage by Model</h2>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-500 border-b">
                      <th className="pb-2">Model</th>
                      <th className="pb-2">Calls</th>
                      <th className="pb-2">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(summary.byModel).map(([model, stats]) => (
                      <tr key={model} className="border-b last:border-0">
                        <td className="py-2 font-mono text-sm">{model}</td>
                        <td className="py-2">{stats.calls.toLocaleString()}</td>
                        <td className="py-2">{stats.tokens.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Daily Usage Chart (Simple Table) */}
            {summary.byDay.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6 mb-8">
                <h2 className="text-lg font-semibold mb-4">Daily Usage</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-gray-500 border-b">
                        <th className="pb-2">Date</th>
                        <th className="pb-2">Calls</th>
                        <th className="pb-2">Tokens</th>
                        <th className="pb-2">Visual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byDay.map((day) => {
                        const maxTokens = Math.max(...summary.byDay.map(d => d.tokens));
                        const width = maxTokens > 0 ? (day.tokens / maxTokens) * 100 : 0;
                        return (
                          <tr key={day.date} className="border-b last:border-0">
                            <td className="py-2">{day.date}</td>
                            <td className="py-2">{day.calls.toLocaleString()}</td>
                            <td className="py-2">{day.tokens.toLocaleString()}</td>
                            <td className="py-2">
                              <div className="w-full bg-gray-100 rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full"
                                  style={{ width: `${width}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Top Users */}
            {topUsers.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4">Top Users by Token Usage</h2>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-500 border-b">
                      <th className="pb-2">#</th>
                      <th className="pb-2">User</th>
                      <th className="pb-2">Calls</th>
                      <th className="pb-2">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topUsers.map((user, idx) => (
                      <tr key={user.userId} className="border-b last:border-0">
                        <td className="py-2 text-gray-400">{idx + 1}</td>
                        <td className="py-2 font-mono text-sm">
                          {user.email || user.userId.slice(0, 8) + "..."}
                        </td>
                        <td className="py-2">{user.calls.toLocaleString()}</td>
                        <td className="py-2">{user.tokens.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
