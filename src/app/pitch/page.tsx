"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

export default function PitchPage() {
  const [domain, setDomain] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;

    // Clean the domain (remove protocol, www, trailing slashes)
    let cleanDomain = domain.trim().toLowerCase();
    cleanDomain = cleanDomain.replace(/^https?:\/\//, "");
    cleanDomain = cleanDomain.replace(/^www\./, "");
    cleanDomain = cleanDomain.replace(/\/.*$/, "");

    setIsLoading(true);
    router.push(`/pitch/${encodeURIComponent(cleanDomain)}`);
  };

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {/* Header with back nav */}
      <header className="w-full px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link 
            href="/" 
            className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm">VL Suite</span>
          </Link>
        </div>
      </header>

      {/* Centered content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {/* Header */}
        <div className="w-full max-w-2xl px-4 mb-8">
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h1 className="font-[family-name:var(--font-inter)] text-3xl font-normal tracking-tight text-text-primary">
              VL Pitch
            </h1>
          </div>
          <p className="text-center text-text-secondary">
            Enter a prospect&apos;s domain to generate sales intelligence
          </p>
        </div>

        {/* Domain Input */}
        <form onSubmit={handleSubmit} className="w-full max-w-xl px-4">
          <div className="relative">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="sysco.com"
              disabled={isLoading}
              className="w-full bg-bg-secondary border border-border rounded-xl px-5 py-4 text-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all disabled:opacity-50"
              autoFocus
            />
            <button
              type="submit"
              disabled={!domain.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                <>
                  Analyze
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Recent Analyses - placeholder for future */}
        <div className="w-full max-w-xl px-4 mt-12">
          <p className="text-center text-text-muted text-sm">
            Enter a company domain like <span className="text-text-secondary">sysco.com</span> or <span className="text-text-secondary">kochfoods.com</span>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center">
        <p className="text-xs text-text-muted">
          Sales intelligence powered by AI
        </p>
      </footer>
    </div>
  );
}
