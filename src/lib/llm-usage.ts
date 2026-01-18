/**
 * LLM Usage Tracking
 * 
 * Logs OpenAI API usage for cost monitoring and observability.
 */

import { createServiceClient } from "./supabase/service";

export interface LLMUsageRecord {
  tenderId?: string;
  extractionRunId?: string;
  route: string;
  operation: "classify" | "extract" | "reprocess";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  llmDurationMs?: number;
  parserType?: "pdf" | "docx" | "txt" | "paste";
  inputTextLength?: number;
  inputCandidatesCount?: number;
  outputStopsCount?: number;
  outputRefsCount?: number;
  warningsCount?: number;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  extractionVersion?: string;
  userId?: string;
  customerId?: string;
}

/**
 * Log LLM usage to the database.
 * This is fire-and-forget; errors are logged but not thrown.
 */
export async function logLLMUsage(record: LLMUsageRecord): Promise<void> {
  try {
    const supabase = createServiceClient();

    const { error } = await supabase.from("llm_usage_logs").insert({
      tender_id: record.tenderId || null,
      extraction_run_id: record.extractionRunId || null,
      route: record.route,
      operation: record.operation,
      model: record.model,
      prompt_tokens: record.promptTokens,
      completion_tokens: record.completionTokens,
      total_tokens: record.totalTokens,
      duration_ms: record.durationMs,
      llm_duration_ms: record.llmDurationMs || null,
      parser_type: record.parserType || null,
      input_text_length: record.inputTextLength || null,
      input_candidates_count: record.inputCandidatesCount || null,
      output_stops_count: record.outputStopsCount || null,
      output_refs_count: record.outputRefsCount || null,
      warnings_count: record.warningsCount || null,
      success: record.success,
      error_code: record.errorCode || null,
      error_message: record.errorMessage || null,
      extraction_version: record.extractionVersion || null,
      user_id: record.userId || null,
      customer_id: record.customerId || null,
    });

    if (error) {
      console.error("[LLMUsage] Failed to log usage:", error);
    }
  } catch (err) {
    console.error("[LLMUsage] Error logging usage:", err);
  }
}

/**
 * Get LLM usage summary for a date range.
 */
export async function getLLMUsageSummary(
  startDate: Date,
  endDate: Date
): Promise<{
  totalCalls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgDurationMs: number;
  errorCount: number;
  successRate: number;
  byModel: Record<string, { calls: number; tokens: number }>;
  byDay: Array<{ date: string; calls: number; tokens: number }>;
}> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("llm_usage_logs")
    .select("*")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString())
    .order("created_at", { ascending: true });

  if (error || !data) {
    console.error("[LLMUsage] Error fetching summary:", error);
    return {
      totalCalls: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      avgDurationMs: 0,
      errorCount: 0,
      successRate: 100,
      byModel: {},
      byDay: [],
    };
  }

  const totalCalls = data.length;
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalDuration = 0;
  let errorCount = 0;
  const byModel: Record<string, { calls: number; tokens: number }> = {};
  const byDayMap: Record<string, { calls: number; tokens: number }> = {};

  for (const record of data) {
    totalTokens += record.total_tokens || 0;
    promptTokens += record.prompt_tokens || 0;
    completionTokens += record.completion_tokens || 0;
    totalDuration += record.duration_ms || 0;
    
    if (!record.success) {
      errorCount++;
    }

    // By model
    if (!byModel[record.model]) {
      byModel[record.model] = { calls: 0, tokens: 0 };
    }
    byModel[record.model].calls++;
    byModel[record.model].tokens += record.total_tokens || 0;

    // By day
    const day = record.created_at.split("T")[0];
    if (!byDayMap[day]) {
      byDayMap[day] = { calls: 0, tokens: 0 };
    }
    byDayMap[day].calls++;
    byDayMap[day].tokens += record.total_tokens || 0;
  }

  const byDay = Object.entries(byDayMap)
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalCalls,
    totalTokens,
    promptTokens,
    completionTokens,
    avgDurationMs: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
    errorCount,
    successRate: totalCalls > 0 ? Math.round(((totalCalls - errorCount) / totalCalls) * 100) : 100,
    byModel,
    byDay,
  };
}

/**
 * Get top users by LLM usage.
 */
export async function getTopUsersByUsage(
  startDate: Date,
  endDate: Date,
  limit: number = 10
): Promise<Array<{ userId: string; calls: number; tokens: number }>> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("llm_usage_logs")
    .select("user_id, total_tokens")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString())
    .not("user_id", "is", null);

  if (error || !data) {
    console.error("[LLMUsage] Error fetching top users:", error);
    return [];
  }

  const userStats: Record<string, { calls: number; tokens: number }> = {};

  for (const record of data) {
    if (!record.user_id) continue;
    if (!userStats[record.user_id]) {
      userStats[record.user_id] = { calls: 0, tokens: 0 };
    }
    userStats[record.user_id].calls++;
    userStats[record.user_id].tokens += record.total_tokens || 0;
  }

  return Object.entries(userStats)
    .map(([userId, stats]) => ({ userId, ...stats }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit);
}

/**
 * Get failing customers (by warning rate and error rate).
 */
export async function getFailingCustomers(
  startDate: Date,
  endDate: Date,
  limit: number = 20
): Promise<Array<{
  customerId: string;
  customerName?: string;
  totalExtractions: number;
  failedExtractions: number;
  totalWarnings: number;
  avgWarnings: number;
  reprocessCount: number;
  failureRate: number;
}>> {
  const supabase = createServiceClient();

  // Get usage logs with customer info
  const { data: usageLogs, error: usageError } = await supabase
    .from("llm_usage_logs")
    .select("customer_id, success, warnings_count, operation")
    .gte("created_at", startDate.toISOString())
    .lte("created_at", endDate.toISOString())
    .not("customer_id", "is", null);

  if (usageError || !usageLogs) {
    console.error("[LLMUsage] Error fetching failing customers:", usageError);
    return [];
  }

  // Get customer names
  const { data: customers } = await supabase
    .from("customer_profiles")
    .select("id, name");

  const customerNames: Record<string, string> = {};
  for (const c of customers || []) {
    customerNames[c.id] = c.name;
  }

  // Aggregate by customer
  const customerStats: Record<string, {
    totalExtractions: number;
    failedExtractions: number;
    totalWarnings: number;
    reprocessCount: number;
  }> = {};

  for (const log of usageLogs) {
    if (!log.customer_id) continue;

    if (!customerStats[log.customer_id]) {
      customerStats[log.customer_id] = {
        totalExtractions: 0,
        failedExtractions: 0,
        totalWarnings: 0,
        reprocessCount: 0,
      };
    }

    customerStats[log.customer_id].totalExtractions++;
    
    if (!log.success) {
      customerStats[log.customer_id].failedExtractions++;
    }
    
    customerStats[log.customer_id].totalWarnings += log.warnings_count || 0;
    
    if (log.operation === "reprocess") {
      customerStats[log.customer_id].reprocessCount++;
    }
  }

  return Object.entries(customerStats)
    .map(([customerId, stats]) => ({
      customerId,
      customerName: customerNames[customerId],
      ...stats,
      avgWarnings: stats.totalExtractions > 0
        ? Math.round((stats.totalWarnings / stats.totalExtractions) * 100) / 100
        : 0,
      failureRate: stats.totalExtractions > 0
        ? Math.round((stats.failedExtractions / stats.totalExtractions) * 100)
        : 0,
    }))
    .sort((a, b) => {
      // Sort by failure rate first, then by avg warnings
      if (b.failureRate !== a.failureRate) {
        return b.failureRate - a.failureRate;
      }
      return b.avgWarnings - a.avgWarnings;
    })
    .slice(0, limit);
}
