/**
 * @deprecated Use the new modular imports:
 * - Server auth: import { createClient } from "@/lib/supabase/server"
 * - Service role: import { createServiceClient } from "@/lib/supabase/service"
 * - Browser: import { createClient } from "@/lib/supabase/browser"
 */

import { createServiceClient } from "./supabase/service";

/**
 * @deprecated Use createServiceClient from "@/lib/supabase/service" instead.
 * Kept for backwards compatibility with existing API routes.
 */
export function createServerClient() {
  return createServiceClient();
}
