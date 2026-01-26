"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

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
      className="text-xs text-text-muted hover:text-accent transition-colors flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label || "Copy"}
        </>
      )}
    </button>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 7 ? "text-success" : score >= 5 ? "text-yellow-500" : "text-error";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-4xl font-bold ${color}`}>{score}</span>
      <span className="text-text-muted text-lg">/10</span>
    </div>
  );
}

function LikelihoodBadge({ likelihood }: { likelihood: string }) {
  const colors = {
    high: "bg-red-500/20 text-red-400",
    medium: "bg-yellow-500/20 text-yellow-400",
    low: "bg-green-500/20 text-green-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[likelihood as keyof typeof colors] || colors.medium}`}>
      {likelihood}
    </span>
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
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full border-4 border-accent border-t-transparent animate-spin mx-auto mb-4" />
          <h2 className="text-xl text-text-primary mb-2">Analyzing {decodeURIComponent(domain)}...</h2>
          <p className="text-text-secondary text-sm">Crawling website, enriching data, generating insights</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-error/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl text-text-primary mb-2">Analysis Failed</h2>
          <p className="text-text-secondary text-sm mb-6">{error}</p>
          <button
            onClick={() => router.push("/pitch")}
            className="bg-accent hover:bg-accent-hover text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-bg-primary/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link 
            href="/pitch" 
            className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm">New Analysis</span>
          </Link>
          <div className="text-sm text-text-muted">
            Analyzed {new Date(analysis.analyzedAt).toLocaleString()}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Title Section */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-text-primary mb-2">
                {analysis.apollo?.name || decodeURIComponent(domain)}
              </h1>
              <p className="text-text-secondary">
                {analysis.apollo?.industry && <span>{analysis.apollo.industry}</span>}
                {analysis.apollo?.employeeCount && <span> • {analysis.apollo.employeeCount.toLocaleString()} employees</span>}
                {analysis.apollo?.foundedYear && <span> • Founded {analysis.apollo.foundedYear}</span>}
              </p>
            </div>
            <div className="text-right">
              <ScoreBadge score={analysis.fitScore.overall} />
              <p className="text-xs text-text-muted mt-1">Fit Score</p>
            </div>
          </div>

          {/* HubSpot Warning */}
          {analysis.hubspot?.exists && (
            <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-yellow-500 font-medium">Already in HubSpot</p>
                <p className="text-text-secondary text-sm">
                  Company: {analysis.hubspot.companyName}
                  {analysis.hubspot.existingDeals?.length ? ` • ${analysis.hubspot.existingDeals.length} deal(s)` : ""}
                  {analysis.hubspot.existingContacts?.length ? ` • ${analysis.hubspot.existingContacts.length} contact(s)` : ""}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Score Breakdown */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <p className="text-text-muted text-xs uppercase tracking-wide mb-1">Logistics Complexity</p>
            <p className="text-text-primary font-medium capitalize">{analysis.fitScore.logisticsComplexity}</p>
          </div>
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <p className="text-text-muted text-xs uppercase tracking-wide mb-1">Pain Signals</p>
            <p className="text-text-primary font-medium capitalize">{analysis.fitScore.painSignalStrength}</p>
          </div>
          <div className="bg-bg-secondary border border-border rounded-lg p-4">
            <p className="text-text-muted text-xs uppercase tracking-wide mb-1">Messaging Maturity</p>
            <p className="text-text-primary font-medium capitalize">{analysis.fitScore.messagingMaturity}</p>
          </div>
        </div>

        {/* Positioning Summary */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Sales Positioning</h2>
          <div className="bg-bg-secondary border border-border rounded-lg p-6">
            <p className="text-text-primary leading-relaxed mb-6">{analysis.positioning.summary}</p>
            
            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-2">Operational Priorities</h3>
                <ul className="space-y-1">
                  {analysis.positioning.operationalPriorities.map((p, i) => (
                    <li key={i} className="text-sm text-text-primary flex items-start gap-2">
                      <span className="text-accent mt-1">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-2">Likely Pain Points</h3>
                <ul className="space-y-1">
                  {analysis.positioning.likelyPainPoints.map((p, i) => (
                    <li key={i} className="text-sm text-text-primary flex items-start gap-2">
                      <span className="text-error mt-1">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-2">Logistics Risk Areas</h3>
                <ul className="space-y-1">
                  {analysis.positioning.logisticsRiskAreas.map((p, i) => (
                    <li key={i} className="text-sm text-text-primary flex items-start gap-2">
                      <span className="text-yellow-500 mt-1">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Talking Points */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Talking Points</h2>
          <div className="space-y-4">
            {analysis.talkingPoints.map((tp, i) => (
              <div key={i} className="bg-bg-secondary border border-border rounded-lg p-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h3 className="font-medium text-text-primary">{tp.angle}</h3>
                  <CopyButton text={`${tp.opener}\n\n${tp.followUp}`} />
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Opener</p>
                    <p className="text-text-primary italic">&ldquo;{tp.opener}&rdquo;</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Follow-up</p>
                    <p className="text-text-primary italic">&ldquo;{tp.followUp}&rdquo;</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Objection Handling */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Objection Handling</h2>
          <div className="space-y-4">
            {analysis.objections.map((obj, i) => (
              <div key={i} className="bg-bg-secondary border border-border rounded-lg p-6">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <LikelihoodBadge likelihood={obj.likelihood} />
                    <h3 className="font-medium text-text-primary">&ldquo;{obj.objection}&rdquo;</h3>
                  </div>
                  <CopyButton text={obj.response} />
                </div>
                <div>
                  <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Reframe</p>
                  <p className="text-text-primary">{obj.response}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Website Feedback */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Website Feedback (Internal)</h2>
          <div className="bg-bg-secondary border border-border rounded-lg p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="bg-bg-primary rounded-lg px-3 py-1">
                <span className="text-xs text-text-muted">Outreach Difficulty: </span>
                <span className="text-text-primary font-medium capitalize">{analysis.websiteFeedback.outreachDifficulty}</span>
              </div>
              <div className="bg-bg-primary rounded-lg px-3 py-1">
                <span className="text-xs text-text-muted">Logistics Maturity: </span>
                <span className="text-text-primary font-medium capitalize">{analysis.websiteFeedback.logisticsMaturity}</span>
              </div>
            </div>
            <p className="text-text-primary mb-4">{analysis.websiteFeedback.explanation}</p>
            {analysis.websiteFeedback.messagingGaps.length > 0 && (
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Messaging Gaps</p>
                <ul className="space-y-1">
                  {analysis.websiteFeedback.messagingGaps.map((gap, i) => (
                    <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                      <span className="text-text-muted mt-1">•</span>
                      {gap}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
