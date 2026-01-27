"use client";

import Link from "next/link";

export default function ConfirmPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary">
      <div className="max-w-md w-full mx-4 text-center">
        <div className="mb-6">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto border border-green-500/30">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-white mb-2">Email Verified!</h1>
        <p className="text-gray-400 mb-8">
          Your account has been confirmed. You can now sign in.
        </p>
        
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-600"
        >
          Go to Sign In
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
