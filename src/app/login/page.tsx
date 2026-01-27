"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { isAllowedDomain, ALLOWED_DOMAIN } from "@/lib/auth-config";

type AuthMode = "login" | "signup";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    try {
      if (mode === "signup") {
        // Validate domain for signup
        if (!isAllowedDomain(email)) {
          throw new Error(`Only @${ALLOWED_DOMAIN} email addresses are allowed.`);
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });

        if (error) throw error;

        setMessage("Check your email for the confirmation link.");
        setMode("login");
      } else {
        // Validate domain for login too
        if (!isAllowedDomain(email)) {
          throw new Error(`Only @${ALLOWED_DOMAIN} email addresses are allowed.`);
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        router.push(redirect);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary">
      <div className="max-w-md w-full mx-4">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-text-primary">VL Suite</h1>
          <p className="mt-2 text-text-secondary">
            Vantage Logistics internal tools
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-bg-secondary rounded-lg border border-border p-8">
          {/* Mode Toggle */}
          <div className="flex rounded-lg border border-border bg-bg-input p-0.5 mb-6">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === "login"
                  ? "bg-bg-secondary text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === "signup"
                  ? "bg-bg-secondary text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-md bg-error/10 border border-error/30 p-3">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {message && (
            <div className="mb-4 rounded-md bg-success/10 border border-success/30 p-3">
              <p className="text-sm text-success">{message}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label
                  htmlFor="fullName"
                  className="block text-sm font-medium text-text-secondary mb-1"
                >
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="John Doe"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="you@vantagelgs.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {mode === "signup" ? "Creating account..." : "Signing in..."}
                </span>
              ) : mode === "signup" ? (
                "Create Account"
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-text-muted">
          By continuing, you agree to the internal usage policies.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
