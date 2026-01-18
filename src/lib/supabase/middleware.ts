import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Create Supabase client for use in middleware.
 * Handles cookie refresh for auth session management.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({
              request,
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // IMPORTANT: Do NOT run any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make your app
    // very slow.
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.log("[Middleware] Auth error:", error.message);
    }

    // Define public routes that don't require authentication
    const publicRoutes = ["/login", "/signup", "/auth/callback", "/auth/confirm"];
    const isPublicRoute = publicRoutes.some(
      (route) => request.nextUrl.pathname.startsWith(route)
    );

    // API routes are handled separately with their own auth checks
    const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

    // Static files and public assets
    const isStaticRoute =
      request.nextUrl.pathname.startsWith("/_next") ||
      request.nextUrl.pathname.startsWith("/favicon") ||
      request.nextUrl.pathname.includes(".");

    console.log(`[Middleware] Path: ${request.nextUrl.pathname}, User: ${user?.email || "none"}, Public: ${isPublicRoute}, API: ${isApiRoute}, Static: ${isStaticRoute}`);

    // If not authenticated and trying to access protected route, redirect to login
    if (!user && !isPublicRoute && !isApiRoute && !isStaticRoute) {
      console.log("[Middleware] Redirecting to /login");
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    // If authenticated and on login page, redirect to home
    if (user && request.nextUrl.pathname === "/login") {
      console.log("[Middleware] User authenticated, redirecting from login");
      const url = request.nextUrl.clone();
      const redirect = url.searchParams.get("redirect") || "/";
      url.pathname = redirect;
      url.searchParams.delete("redirect");
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch (err) {
    console.error("[Middleware] Error:", err);
    // On error, let the request through (fail open for now)
    return supabaseResponse;
  }
}
