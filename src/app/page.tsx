"use client";

import { TenderComposer } from "@/components/TenderComposer";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {/* Centered content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
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
