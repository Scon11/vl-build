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
    <div className="min-h-screen bg-hero-gradient flex flex-col">
      {/* Header with back nav */}
      <header className="w-full px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link 
            href="/" 
            className="flex items-center gap-2 text-gray-500 hover:text-cyan-400 transition-colors group"
          >
            <svg className="w-4 h-4 group-hover:drop-shadow-[0_0_8px_rgba(0,240,255,0.5)] transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-medium">VL Suite</span>
          </Link>
        </div>
      </header>

      {/* Centered content with breathing room */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Logo + Title with glow animation */}
        <div className="w-full max-w-2xl px-4 mb-10">
          <div className="flex items-center justify-center gap-5 mb-4">
            <Image
              src="/logo.png"
              alt="VL Pitch Logo"
              width={72}
              height={72}
              priority
              className="shrink-0 animate-logo-glow"
            />
            <h1 
              className="font-[family-name:var(--font-inter)] text-5xl md:text-6xl font-black tracking-tight text-white animate-text-glow"
              style={{ letterSpacing: '-0.03em' }}
            >
              VL Pitch
            </h1>
          </div>
          <p className="text-center text-gray-400 text-lg">
            Enter a prospect&apos;s domain to generate sales intelligence
          </p>
        </div>

        {/* Domain Input - Glassmorphic */}
        <form onSubmit={handleSubmit} className="w-full max-w-xl px-4 animate-fade-in-up animation-delay-300">
          <div className="relative">
            <div className={`
              glass-card rounded-2xl p-2 transition-all duration-300
              ${isLoading ? 'opacity-70' : ''}
            `}>
              <div className="flex items-center gap-3">
                {/* Search icon with glow */}
                <div className="pl-4">
                  <svg 
                    className="w-6 h-6 text-cyan-400 icon-glow" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="sysco.com"
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-xl text-white placeholder:text-gray-500 focus:outline-none py-4 font-medium"
                  autoFocus
                />
                
                <button
                  type="submit"
                  disabled={!domain.trim() || isLoading}
                  className="cta-button disabled:opacity-40 disabled:cursor-not-allowed mr-2"
                >
                  {isLoading ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Analyzing...
                    </>
                  ) : (
                    <>
                      Analyze
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Helper text */}
        <div className="w-full max-w-xl px-4 mt-8 animate-fade-in-up animation-delay-500">
          <p className="text-center text-gray-500 text-sm">
            Enter a company domain like <span className="text-gray-400">sysco.com</span> or <span className="text-gray-400">kochfoods.com</span>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-sm text-gray-600">
          Sales intelligence powered by AI
        </p>
      </footer>
    </div>
  );
}
