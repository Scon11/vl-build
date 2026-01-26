"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

interface TalkingPoint {
  angle: string;
  opener: string;
  followUp: string;
}

interface Objection {
  objection: string;
  likelihood: "high" | "medium" | "low";
  response: string;
}

interface PitchAnalysis {
  domain: string;
  analyzedAt: string;
  apollo?: {
    name?: string;
    industry?: string;
    employeeCount?: number;
    foundedYear?: number;
    description?: string;
  };
  hubspot?: {
    exists: boolean;
    companyName?: string;
    existingDeals?: { id: string; name: string }[];
    existingContacts?: { id: string; name: string; email: string; title?: string }[];
  };
  positioning: {
    summary: string;
    operationalPriorities: string[];
    likelyPainPoints: string[];
    logisticsRiskAreas: string[];
  };
  talkingPoints: TalkingPoint[];
  objections: Objection[];
  websiteFeedback: {
    messagingGaps: string[];
    logisticsMaturity: string;
    outreachDifficulty: string;
    explanation: string;
  };
  fitScore: {
    overall: number;
    logisticsComplexity: string;
    painSignalStrength: string;
    messagingMaturity: string;
  };
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-xs text-gray-500 hover:text-cyan-400 transition-colors flex items-center gap-1 group"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-400">Copied!</span>
        </>
      ) : (
        <>
          <svg className="w-3 h-3 group-hover:drop-shadow-[0_0_6px_rgba(0,240,255,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label || "Copy"}
        </>
      )}
    </button>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 7 ? "text-green-400" : score >= 5 ? "text-yellow-400" : "text-red-400";
  const glowColor = score >= 7 ? "drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]" : score >= 5 ? "drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]" : "drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-5xl font-black ${color} ${glowColor}`}>{score}</span>
      <span className="text-gray-500 text-xl">/10</span>
    </div>
  );
}

function LikelihoodBadge({ likelihood }: { likelihood: string }) {
  const colors = {
    high: "bg-red-500/20 text-red-400 border border-red-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    low: "bg-green-500/20 text-green-400 border border-green-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[likelihood as keyof typeof colors] || colors.medium}`}>
      {likelihood}
    </span>
  );
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  const valueColors: Record<string, string> = {
    high: "text-cyan-400",
    medium: "text-yellow-400",
    low: "text-gray-400",
    sophisticated: "text-cyan-400",
    generic: "text-yellow-400",
    thin: "text-red-400",
  };
  return (
    <div className="glass-card rounded-xl p-4 text-center">
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-semibold capitalize ${valueColors[value.toLowerCase()] || "text-white"}`}>{value}</p>
    </div>
  );
}

export default function PitchResultsPage() {
  const params = useParams();
  const router = useRouter();
  const domain = params.domain as string;
  
  const [analysis, setAnalysis] = useState<PitchAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch("/api/pitch/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: decodeURIComponent(domain) }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Analysis failed");
        }

        const data = await response.json();
        setAnalysis(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (domain) {
      fetchAnalysis();
    }
  }, [domain]);

  if (loading) {
    return (
      <div className="min-h-screen bg-hero-gradient flex flex-col items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full border-4 border-cyan-400 border-t-transparent animate-spin mx-auto mb-6 shadow-[0_0_20px_rgba(0,240,255,0.3)]" />
          <h2 className="text-2xl font-bold text-white mb-2">Analyzing {decodeURIComponent(domain)}...</h2>
          <p className="text-gray-400">Crawling website, enriching data, generating insights</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-hero-gradient flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6 border border-red-500/30">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Analysis Failed</h2>
          <p className="text-gray-400 mb-8">{error}</p>
          <button
            onClick={() => router.push("/pitch")}
            className="cta-button"
          >
            Try Again
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="min-h-screen bg-hero-gradient">
      {/* Header */}
      <header className="sticky top-0 z-10 glass-card !rounded-none border-x-0 border-t-0">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link 
            href="/pitch" 
            className="flex items-center gap-2 text-gray-400 hover:text-cyan-400 transition-colors group"
          >
            <svg className="w-4 h-4 group-hover:drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-medium">New Analysis</span>
          </Link>
          <div className="flex items-center gap-4">
            <Image
              src="/logo.png"
              alt="VL Suite"
              width={32}
              height={32}
              className="opacity-60"
            />
            <div className="text-sm text-gray-500">
              Analyzed {new Date(analysis.analyzedAt).toLocaleString()}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Title Section */}
        <div className="mb-10 animate-fade-in-up">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-4xl font-black text-white mb-3 tracking-tight">
                {analysis.apollo?.name || decodeURIComponent(domain)}
              </h1>
              <p className="text-gray-400 text-lg">
                {analysis.apollo?.industry && <span>{analysis.apollo.industry}</span>}
                {analysis.apollo?.employeeCount && <span> • {analysis.apollo.employeeCount.toLocaleString()} employees</span>}
                {analysis.apollo?.foundedYear && <span> • Founded {analysis.apollo.foundedYear}</span>}
              </p>
            </div>
            <div className="text-right">
              <ScoreBadge score={analysis.fitScore.overall} />
              <p className="text-xs text-gray-500 mt-2">Fit Score</p>
            </div>
          </div>

          {/* HubSpot Warning */}
          {analysis.hubspot?.exists && (
            <div className="mt-6 glass-card !border-yellow-500/30 rounded-xl px-5 py-4 flex items-start gap-4">
              <svg className="w-6 h-6 text-yellow-400 shrink-0 mt-0.5 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-yellow-400 font-semibold">Already in HubSpot</p>
                <p className="text-gray-400 text-sm">
                  Company: {analysis.hubspot.companyName}
                  {analysis.hubspot.existingDeals?.length ? ` • ${analysis.hubspot.existingDeals.length} deal(s)` : ""}
                  {analysis.hubspot.existingContacts?.length ? ` • ${analysis.hubspot.existingContacts.length} contact(s)` : ""}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Score Breakdown */}
        <div className="grid grid-cols-3 gap-4 mb-10 animate-fade-in-up animation-delay-300">
          <MetricBadge label="Logistics Complexity" value={analysis.fitScore.logisticsComplexity} />
          <MetricBadge label="Pain Signals" value={analysis.fitScore.painSignalStrength} />
          <MetricBadge label="Messaging Maturity" value={analysis.fitScore.messagingMaturity} />
        </div>

        {/* Positioning Summary */}
        <section className="mb-10 animate-fade-in-up animation-delay-300">
          <h2 className="text-2xl font-bold text-white mb-5">Sales Positioning</h2>
          <div className="glass-card rounded-2xl p-8">
            <p className="text-gray-300 text-lg leading-relaxed mb-8">{analysis.positioning.summary}</p>
            
            <div className="grid md:grid-cols-3 gap-8">
              <div>
                <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Operational Priorities</h3>
                <ul className="space-y-2">
                  {analysis.positioning.operationalPriorities.map((p, i) => (
                    <li key={i} className="text-gray-300 flex items-start gap-3">
                      <span className="text-cyan-400 mt-1.5">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-red-400 mb-3 uppercase tracking-wider">Likely Pain Points</h3>
                <ul className="space-y-2">
                  {analysis.positioning.likelyPainPoints.map((p, i) => (
                    <li key={i} className="text-gray-300 flex items-start gap-3">
                      <span className="text-red-400 mt-1.5">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-yellow-400 mb-3 uppercase tracking-wider">Logistics Risk Areas</h3>
                <ul className="space-y-2">
                  {analysis.positioning.logisticsRiskAreas.map((p, i) => (
                    <li key={i} className="text-gray-300 flex items-start gap-3">
                      <span className="text-yellow-400 mt-1.5">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Talking Points */}
        <section className="mb-10 animate-fade-in-up animation-delay-500">
          <h2 className="text-2xl font-bold text-white mb-5">Talking Points</h2>
          <div className="space-y-4">
            {analysis.talkingPoints.map((tp, i) => (
              <div key={i} className="glass-card rounded-2xl p-6 hover:!border-cyan-500/30 transition-all">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h3 className="font-semibold text-white text-lg">{tp.angle}</h3>
                  <CopyButton text={`${tp.opener}\n\n${tp.followUp}`} />
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-cyan-400 uppercase tracking-wider mb-2">Opener</p>
                    <p className="text-gray-300 italic border-l-2 border-cyan-500/30 pl-4">&ldquo;{tp.opener}&rdquo;</p>
                  </div>
                  <div>
                    <p className="text-xs text-cyan-400 uppercase tracking-wider mb-2">Follow-up</p>
                    <p className="text-gray-300 italic border-l-2 border-cyan-500/30 pl-4">&ldquo;{tp.followUp}&rdquo;</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Objection Handling */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold text-white mb-5">Objection Handling</h2>
          <div className="space-y-4">
            {analysis.objections.map((obj, i) => (
              <div key={i} className="glass-card rounded-2xl p-6 hover:!border-cyan-500/30 transition-all">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <LikelihoodBadge likelihood={obj.likelihood} />
                    <h3 className="font-semibold text-white">&ldquo;{obj.objection}&rdquo;</h3>
                  </div>
                  <CopyButton text={obj.response} />
                </div>
                <div>
                  <p className="text-xs text-cyan-400 uppercase tracking-wider mb-2">Reframe</p>
                  <p className="text-gray-300">{obj.response}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Website Feedback */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold text-white mb-5">Website Feedback <span className="text-gray-500 text-base font-normal">(Internal)</span></h2>
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center gap-4 mb-5">
              <div className="glass-card rounded-lg px-4 py-2">
                <span className="text-xs text-gray-500">Outreach Difficulty: </span>
                <span className="text-white font-medium capitalize">{analysis.websiteFeedback.outreachDifficulty}</span>
              </div>
              <div className="glass-card rounded-lg px-4 py-2">
                <span className="text-xs text-gray-500">Logistics Maturity: </span>
                <span className="text-white font-medium capitalize">{analysis.websiteFeedback.logisticsMaturity}</span>
              </div>
            </div>
            <p className="text-gray-300 mb-5">{analysis.websiteFeedback.explanation}</p>
            {analysis.websiteFeedback.messagingGaps.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Messaging Gaps</p>
                <ul className="space-y-2">
                  {analysis.websiteFeedback.messagingGaps.map((gap, i) => (
                    <li key={i} className="text-gray-400 flex items-start gap-3">
                      <span className="text-gray-600 mt-1.5">•</span>
                      {gap}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 text-center">
        <p className="text-sm text-gray-600">
          Sales intelligence powered by AI
        </p>
      </footer>
    </div>
  );
}
