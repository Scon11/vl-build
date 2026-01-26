"use client";

import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {/* Centered content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Header */}
        <div className="w-full max-w-2xl px-4 mb-12">
          <div className="flex items-center justify-center gap-4">
            <Image
              src="/logo.png"
              alt="VL Suite Logo"
              width={54}
              height={54}
              priority
              className="shrink-0"
            />
            <h1 className="font-[family-name:var(--font-inter)] text-3xl font-normal tracking-tight text-text-primary">
              VL Suite
            </h1>
          </div>
        </div>

        {/* Tool Cards */}
        <div className="w-full max-w-3xl px-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Build Card */}
          <Link href="/build" className="group">
            <div className="h-full bg-bg-secondary border border-border rounded-xl p-6 transition-all duration-200 hover:border-accent hover:shadow-lg hover:shadow-accent/10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 className="text-xl font-medium text-text-primary">Build</h2>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed">
                Parse and extract load tender data. Drop PDFs, paste text, or upload documents to automatically pull shipment details.
              </p>
              <div className="mt-4 text-accent text-sm font-medium group-hover:underline">
                Open Build →
              </div>
            </div>
          </Link>

          {/* Pitch Card */}
          <Link href="/pitch" className="group">
            <div className="h-full bg-bg-secondary border border-border rounded-xl p-6 transition-all duration-200 hover:border-accent hover:shadow-lg hover:shadow-accent/10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h2 className="text-xl font-medium text-text-primary">Pitch</h2>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed">
                Sales intelligence for prospects. Enter a domain to get positioning insights, talking points, and objection handling.
              </p>
              <div className="mt-4 text-accent text-sm font-medium group-hover:underline">
                Open Pitch →
              </div>
            </div>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center">
        <p className="text-xs text-text-muted">
          Vantage Logistics Internal Tools
        </p>
      </footer>
    </div>
  );
}
