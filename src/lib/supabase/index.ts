/**
 * Supabase client exports
 * 
 * Usage:
 * - Browser components: import { createClient } from "@/lib/supabase/browser"
 * - Server components/actions: import { createClient } from "@/lib/supabase/server"
 * - API routes (with user auth): import { createClient } from "@/lib/supabase/server"
 * - API routes (admin/service): import { createServiceClient } from "@/lib/supabase/service"
 * - Middleware: import { updateSession } from "@/lib/supabase/middleware"
 */

export { createClient as createBrowserClient } from "./browser";
export { createClient as createServerAuthClient } from "./server";
export { createServiceClient } from "./service";
export { updateSession } from "./middleware";
