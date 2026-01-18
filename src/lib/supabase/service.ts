import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with SERVICE ROLE key.
 * Use this ONLY for admin operations that bypass RLS:
 * - System-level operations
 * - Operations that need to access all data
 * - Creating/managing export logs
 * 
 * NEVER expose this client to the frontend.
 * NEVER use for user-facing read operations.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
