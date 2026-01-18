import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client with auth support.
 * Use this in client components for authenticated operations.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
