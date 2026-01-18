"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface FailingCustomer {
  customerId: string;
  customerName?: string;
  totalExtractions: number;
  failedExtractions: number;
  totalWarnings: number;
  avgWarnings: number;
  reprocessCount: number;
  failureRate: number;
}

export default function FailingCustomersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<"7d" | "30d">("7d");
  const [customers, setCustomers] = useState<FailingCustomer[]>([]);

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const days = dateRange === "7d" ? 7 : 30;
      const res = await fetch(`/api/admin/observability/failing-customers?days=${days}`);
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch data");
      }

      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (failureRate: number, avgWarnings: number) => {
    if (failureRate > 20 || avgWarnings > 5) return "bg-red-100 text-red-800";
    if (failureRate > 10 || avgWarnings > 3) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Failing Customers</h1>
            <p className="text-gray-600">Customers with high warning/failure rates</p>
          </div>
          <div className="flex gap-4">
            <Link
              href="/admin/observability"
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Back to Usage
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

        {!loading && customers.length === 0 && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">No customer extraction data found for this period.</p>
          </div>
        )}

        {!loading && customers.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr className="text-left text-sm text-gray-500">
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Extractions</th>
                  <th className="px-6 py-3">Failed</th>
                  <th className="px-6 py-3">Failure Rate</th>
                  <th className="px-6 py-3">Total Warnings</th>
                  <th className="px-6 py-3">Avg Warnings</th>
                  <th className="px-6 py-3">Reprocesses</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {customers.map((customer) => (
                  <tr key={customer.customerId} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/customers/${customer.customerId}/rules`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {customer.customerName || customer.customerId.slice(0, 8) + "..."}
                      </Link>
                    </td>
                    <td className="px-6 py-4">{customer.totalExtractions}</td>
                    <td className="px-6 py-4">
                      {customer.failedExtractions > 0 ? (
                        <span className="text-red-600 font-medium">
                          {customer.failedExtractions}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        customer.failureRate > 20 ? "bg-red-100 text-red-800" :
                        customer.failureRate > 10 ? "bg-yellow-100 text-yellow-800" :
                        "bg-green-100 text-green-800"
                      }`}>
                        {customer.failureRate}%
                      </span>
                    </td>
                    <td className="px-6 py-4">{customer.totalWarnings}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        customer.avgWarnings > 5 ? "bg-red-100 text-red-800" :
                        customer.avgWarnings > 2 ? "bg-yellow-100 text-yellow-800" :
                        "bg-green-100 text-green-800"
                      }`}>
                        {customer.avgWarnings}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {customer.reprocessCount > 0 ? (
                        <span className="text-orange-600">{customer.reprocessCount}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        getStatusColor(customer.failureRate, customer.avgWarnings)
                      }`}>
                        {customer.failureRate > 20 || customer.avgWarnings > 5 ? "Needs Attention" :
                         customer.failureRate > 10 || customer.avgWarnings > 3 ? "Monitor" : "Healthy"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="mt-6 bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Status Legend</h3>
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-green-100 border border-green-300"></span>
              Healthy: &lt;10% failures, &lt;3 avg warnings
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300"></span>
              Monitor: 10-20% failures or 3-5 avg warnings
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-red-100 border border-red-300"></span>
              Needs Attention: &gt;20% failures or &gt;5 avg warnings
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
