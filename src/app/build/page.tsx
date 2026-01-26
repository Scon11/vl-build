"use client";

import { TenderComposer } from "@/components/TenderComposer";
import Image from "next/image";
import Link from "next/link";

export default function BuildPage() {
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
        {/* Inline logo + title header */}
        <div className="w-full max-w-2xl px-4 mb-5">
          <div className="flex items-center justify-center gap-4">
            <Image
              src="/logo.png"
              alt="VL Build Logo"
              width={54}
              height={54}
              priority
              className="shrink-0"
            />
            <h1 className="font-[family-name:var(--font-inter)] text-3xl font-normal tracking-tight text-text-primary">
              VL Build
            </h1>
          </div>
        </div>

        {/* Composer input bar */}
        <TenderComposer />
      </main>

      {/* Subtle footer */}
      <footer className="py-4 text-center">
        <p className="text-xs text-text-muted">
          Paste tender text or drop a file to get started
        </p>
      </footer>
    </div>
  );
}
