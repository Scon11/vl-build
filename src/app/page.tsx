"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { isAdmin } from "@/lib/auth-config";
import type { User } from "@supabase/supabase-js";

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // Get current user
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const userIsAdmin = isAdmin(user?.email);

  if (loading) {
    return (
      <div className="min-h-screen bg-hero-gradient flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-hero-gradient flex flex-col">
      {/* Top Bar */}
      {user && (
        <header className="px-6 py-4 flex items-center justify-between">
          <div />
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-500 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </div>
        </header>
      )}

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20">
        {/* Logo + Title */}
        <div className="flex flex-col items-center justify-center gap-6 mb-20">
          <div className="flex items-center justify-center gap-5">
            <Image
              src="/logo.png"
              alt="VL Suite Logo"
              width={80}
              height={80}
              priority
              className="shrink-0 animate-logo-glow"
            />
            <h1 className="font-[family-name:var(--font-inter)] text-6xl md:text-7xl font-black tracking-tight text-white animate-text-glow"
                style={{ letterSpacing: '-0.03em' }}>
              VL Suite
            </h1>
          </div>
        </div>

        {/* Tool Cards */}
        <div className={`w-full max-w-5xl px-4 grid grid-cols-1 ${userIsAdmin ? 'md:grid-cols-2' : ''} gap-8`}>
          {/* Build Card - Admin Only */}
          {userIsAdmin && (
            <Link href="/build" className="group animate-fade-in-up animation-delay-300">
              <div className="h-full glass-card rounded-2xl p-8">
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 flex items-center justify-center border border-cyan-500/20">
                    <svg className="w-7 h-7 text-cyan-400 icon-glow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Build</h2>
                    <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">Admin</span>
                  </div>
                </div>
                <p className="text-gray-400 text-base md:text-lg leading-relaxed mb-6">
                  Parse and extract load tender data. Drop PDFs, paste text, or upload documents to automatically pull shipment details.
                </p>
                <div className="cta-button">
                  Open Build
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </Link>
          )}

          {/* Pitch Card - Available to all authenticated users */}
          <Link href="/pitch" className={`group animate-fade-in-up ${userIsAdmin ? 'animation-delay-500' : 'animation-delay-300 max-w-xl mx-auto w-full'}`}>
            <div className="h-full glass-card rounded-2xl p-8">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 flex items-center justify-center border border-cyan-500/20">
                  <svg className="w-7 h-7 text-cyan-400 icon-glow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Pitch</h2>
              </div>
              <p className="text-gray-400 text-base md:text-lg leading-relaxed mb-6">
                Sales intelligence for prospects. Enter a domain to get call scripts, objection handling, and next steps.
              </p>
              <div className="cta-button">
                Open Pitch
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
            </div>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-sm text-gray-600">
          Vantage Logistics Internal Tools
        </p>
      </footer>
    </div>
  );
}
