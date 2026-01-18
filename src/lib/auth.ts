import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { User } from "@supabase/supabase-js";

export type UserRole = "user" | "admin";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  user: User;
  profile: UserProfile;
}

/**
 * Get the current authenticated user and their profile.
 * Use in Server Components and Route Handlers.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    return null;
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Profile should exist from trigger, but create a default if missing
    return {
      user,
      profile: {
        id: user.id,
        email: user.email || "",
        full_name: null,
        role: "user",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
  }

  return { user, profile };
}

/**
 * Check if the current user is an admin.
 */
export async function isAdmin(): Promise<boolean> {
  const authUser = await getAuthUser();
  return authUser?.profile.role === "admin";
}

/**
 * Require authentication. Throws if not authenticated.
 * Use at the start of protected API routes.
 */
export async function requireAuth(): Promise<AuthUser> {
  const authUser = await getAuthUser();
  
  if (!authUser) {
    throw new AuthError("Authentication required", 401);
  }
  
  return authUser;
}

/**
 * Require admin role. Throws if not admin.
 */
export async function requireAdmin(): Promise<AuthUser> {
  const authUser = await requireAuth();
  
  if (authUser.profile.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }
  
  return authUser;
}

/**
 * Custom error class for auth errors
 */
export class AuthError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Get user profile by ID using service client (bypasses RLS).
 * Use for system operations that need to look up other users.
 */
export async function getUserProfileById(userId: string): Promise<UserProfile | null> {
  const supabase = createServiceClient();
  
  const { data } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .single();
  
  return data;
}
