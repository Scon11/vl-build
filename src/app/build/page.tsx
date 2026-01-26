"use client";

import { TenderComposer } from "@/components/TenderComposer";
import Image from "next/image";
import Link from "next/link";

export default function BuildPage() {
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

      {/* Centered content with more vertical breathing room */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Logo + Title with glow animation */}
        <div className="w-full max-w-2xl px-4 mb-10">
          <div className="flex items-center justify-center gap-5">
            <Image
              src="/logo.png"
              alt="VL Build Logo"
              width={72}
              height={72}
              priority
              className="shrink-0 animate-logo-glow"
            />
            <h1 
              className="font-[family-name:var(--font-inter)] text-5xl md:text-6xl font-black tracking-tight text-white animate-text-glow"
              style={{ letterSpacing: '-0.03em' }}
            >
              VL Build
            </h1>
          </div>
        </div>

        {/* Composer input bar */}
        <TenderComposer />
      </main>

      {/* Subtle footer */}
      <footer className="py-6 text-center">
        <p className="text-sm text-gray-600">
          Paste tender text or drop a file to get started
        </p>
      </footer>
    </div>
  );
}
