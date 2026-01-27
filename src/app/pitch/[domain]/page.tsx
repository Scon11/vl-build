"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

// New execution-focused types
interface WhoToCall {
  title: string;
  why: string;
}

interface Scripts {
  coldCall: string;
  voicemail: string;
  emailSubject: string;
  emailBody: string;
}

interface Objection {
  objection: string;
  sayThis: string;
  toneNote: string;
}

interface NextAction {
  channel: string;
  why: string;
  doToday: string;
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
    companyId?: string;
    existingDeals?: { id: string; name: string }[];
    existingContacts?: { id: string; name: string; email: string }[];
  };
  summary: {
    oneLiner: string;
    painSignal: string;
    fitScore: number;
    fitRationale: string;
  };
  whoToCall: {
    primary: WhoToCall;
    secondary: WhoToCall;
    avoid: WhoToCall;
    coachingNote: string;
  };
  scripts: Scripts;
  objections: Objection[];
  nextActions: {
    primary: NextAction;
    secondary: NextAction;
    cadence: string[];
    ifNoResponse: string;
  };
  fitScoreBreakdown: {
    overall: number;
    logisticsComplexity: string;
    painSignalStrength: string;
    equipmentMatch: string;
    decisionMakerAccess: string;
    actionGuidance: string;
  };
  researchNotes: {
    companyOverview: string;
    products: string[];
    commodities: string[];
    equipmentNeeded: string[];
    equipmentNotNeeded: string[];
    logisticsSignals: string[];
    websiteMaturity: string;
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
      className="text-xs bg-gray-800 hover:bg-cyan-900/50 text-gray-400 hover:text-cyan-400 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 border border-gray-700 hover:border-cyan-500/50"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-400">Copied!</span>
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label || "Copy"}
        </>
      )}
    </button>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 8 ? "text-green-400" : score >= 6 ? "text-yellow-400" : "text-red-400";
  const bg = score >= 8 ? "bg-green-500/10 border-green-500/30" : score >= 6 ? "bg-yellow-500/10 border-yellow-500/30" : "bg-red-500/10 border-red-500/30";
  const action = score >= 8 ? "Call today" : score >= 6 ? "Standard cadence" : "Nurture/Park";
  
  return (
    <div className={`rounded-2xl border p-4 text-center ${bg}`}>
      <div className="flex items-baseline justify-center gap-1">
        <span className={`text-4xl font-black ${color}`}>{score}</span>
        <span className="text-gray-500 text-lg">/10</span>
      </div>
      <p className={`text-sm font-medium mt-1 ${color}`}>{action}</p>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="text-2xl">{icon}</span>
      <div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function ScriptCard({ title, script, placeholder }: { title: string; script: string; placeholder?: string }) {
  const displayScript = script.replace(/\[REP\]/g, placeholder || "[Your Name]").replace(/\[NUMBER\]/g, "[Your Number]");
  
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white">{title}</h3>
        <CopyButton text={displayScript} />
      </div>
      <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">{displayScript}</p>
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
  const [showResearch, setShowResearch] = useState(false);

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
          <p className="text-gray-400">Crawling website, enriching data, generating call scripts</p>
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
          <button onClick={() => router.push("/pitch")} className="cta-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  const companyName = analysis.apollo?.name || decodeURIComponent(domain);

  return (
    <div className="min-h-screen bg-hero-gradient">
      {/* Header */}
      <header className="sticky top-0 z-10 glass-card !rounded-none border-x-0 border-t-0">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/pitch" className="flex items-center gap-2 text-gray-400 hover:text-cyan-400 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-medium">New Analysis</span>
          </Link>
          <div className="flex items-center gap-4">
            <Image src="/logo.png" alt="VL Suite" width={32} height={32} className="opacity-60" />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        
        {/* === SECTION 1: 30-SECOND SUMMARY === */}
        <section className="mb-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-[300px]">
              <h1 className="text-3xl font-black text-white mb-2">{companyName}</h1>
              <p className="text-gray-300 text-lg mb-4">{analysis.summary?.oneLiner}</p>
              
              <div className="flex items-center gap-2 mb-3">
                <span className="text-red-400 font-semibold">⚡ Pain Signal:</span>
                <span className="text-gray-300">{analysis.summary?.painSignal}</span>
              </div>
              
              <p className="text-gray-500 text-sm">{analysis.summary?.fitRationale}</p>
              
              {/* HubSpot Warning */}
              {analysis.hubspot?.exists && (
                <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
                  <p className="text-yellow-400 font-semibold text-sm">⚠️ Already in HubSpot: {analysis.hubspot.companyName}</p>
                  <p className="text-gray-400 text-xs">
                    {analysis.hubspot.existingDeals?.length || 0} deals • {analysis.hubspot.existingContacts?.length || 0} contacts
                  </p>
                </div>
              )}
            </div>
            
            <ScoreBadge score={analysis.summary?.fitScore || analysis.fitScoreBreakdown?.overall || 0} />
          </div>
        </section>

        {/* === SECTION 2: WHO TO CALL FIRST === */}
        <section className="mb-8">
          <SectionHeader icon="📞" title="Who to Call First" subtitle="Calling too low kills deals" />
          
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="glass-card rounded-xl p-5 border-l-4 border-l-green-500">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-green-400 font-bold">🥇 Primary</span>
              </div>
              <p className="text-white font-semibold mb-1">{analysis.whoToCall?.primary?.title}</p>
              <p className="text-gray-400 text-sm">{analysis.whoToCall?.primary?.why}</p>
            </div>
            
            <div className="glass-card rounded-xl p-5 border-l-4 border-l-yellow-500">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-yellow-400 font-bold">🥈 Secondary</span>
              </div>
              <p className="text-white font-semibold mb-1">{analysis.whoToCall?.secondary?.title}</p>
              <p className="text-gray-400 text-sm">{analysis.whoToCall?.secondary?.why}</p>
            </div>
            
            <div className="glass-card rounded-xl p-5 border-l-4 border-l-red-500">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-red-400 font-bold">⚠️ Avoid First</span>
              </div>
              <p className="text-white font-semibold mb-1">{analysis.whoToCall?.avoid?.title}</p>
              <p className="text-gray-400 text-sm">{analysis.whoToCall?.avoid?.why}</p>
            </div>
          </div>
          
          {analysis.whoToCall?.coachingNote && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-4 py-3">
              <p className="text-cyan-400 text-sm">💡 <span className="font-semibold">Coaching:</span> {analysis.whoToCall.coachingNote}</p>
            </div>
          )}
        </section>

        {/* === SECTION 3: CALL-READY SCRIPTS === */}
        <section className="mb-8">
          <SectionHeader icon="🗣️" title="Call-Ready Scripts" subtitle="Read these verbatim" />
          
          <div className="space-y-4">
            <ScriptCard 
              title="Cold Call (15-20 sec)" 
              script={analysis.scripts?.coldCall || "Script not available"} 
            />
            
            <ScriptCard 
              title="Voicemail (10-12 sec)" 
              script={analysis.scripts?.voicemail || "Script not available"} 
            />
            
            <div className="glass-card rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-white">Cold Email</h3>
                <CopyButton text={`Subject: ${analysis.scripts?.emailSubject}\n\n${analysis.scripts?.emailBody}`} />
              </div>
              <div className="mb-3">
                <p className="text-xs text-cyan-400 uppercase tracking-wider mb-1">Subject Line</p>
                <p className="text-white font-medium">{analysis.scripts?.emailSubject}</p>
              </div>
              <div>
                <p className="text-xs text-cyan-400 uppercase tracking-wider mb-1">Body (≤75 words)</p>
                <p className="text-gray-300 whitespace-pre-wrap">{analysis.scripts?.emailBody}</p>
              </div>
            </div>
          </div>
        </section>

        {/* === SECTION 4: LIVE OBJECTION REFRAMES === */}
        <section className="mb-8">
          <SectionHeader icon="🛡️" title="Live Objection Reframes" subtitle="Say this, not that" />
          
          <div className="space-y-4">
            {analysis.objections?.map((obj, i) => (
              <div key={i} className="glass-card rounded-xl p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h3 className="text-white font-semibold">&ldquo;{obj.objection}&rdquo;</h3>
                  <CopyButton text={obj.sayThis} />
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 mb-3">
                  <p className="text-xs text-green-400 uppercase tracking-wider mb-2">Say This:</p>
                  <p className="text-gray-200 italic">&ldquo;{obj.sayThis}&rdquo;</p>
                </div>
                <p className="text-gray-500 text-sm">💡 <span className="text-gray-400">{obj.toneNote}</span></p>
              </div>
            ))}
          </div>
        </section>

        {/* === SECTION 5: NEXT BEST ACTIONS === */}
        <section className="mb-8">
          <SectionHeader icon="✅" title="Next Best Actions" subtitle="What to do right now" />
          
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="glass-card rounded-xl p-5 border-2 border-cyan-500/30">
              <p className="text-cyan-400 font-bold text-sm mb-2">PRIMARY ACTION</p>
              <p className="text-white font-semibold text-lg mb-1">{analysis.nextActions?.primary?.channel}</p>
              <p className="text-gray-400 text-sm mb-3">{analysis.nextActions?.primary?.why}</p>
              <div className="bg-cyan-500/10 rounded-lg px-3 py-2">
                <p className="text-cyan-300 text-sm">📌 <strong>Do today:</strong> {analysis.nextActions?.primary?.doToday}</p>
              </div>
            </div>
            
            <div className="glass-card rounded-xl p-5">
              <p className="text-gray-400 font-bold text-sm mb-2">BACKUP ACTION</p>
              <p className="text-white font-semibold text-lg mb-1">{analysis.nextActions?.secondary?.channel}</p>
              <p className="text-gray-400 text-sm mb-3">{analysis.nextActions?.secondary?.why}</p>
              <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                <p className="text-gray-300 text-sm">📌 <strong>Do today:</strong> {analysis.nextActions?.secondary?.doToday}</p>
              </div>
            </div>
          </div>
          
          <div className="glass-card rounded-xl p-5">
            <p className="text-white font-semibold mb-3">Recommended Cadence</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
              {analysis.nextActions?.cadence?.map((step, i) => (
                <div key={i} className="bg-gray-800/50 rounded-lg px-3 py-2 text-center">
                  <p className="text-gray-300 text-xs">{step}</p>
                </div>
              ))}
            </div>
            <p className="text-gray-500 text-sm">🚫 <strong>If no response:</strong> {analysis.nextActions?.ifNoResponse}</p>
          </div>
        </section>

        {/* === SECTION 6: FIT SCORE BREAKDOWN === */}
        <section className="mb-8">
          <SectionHeader icon="📊" title="Fit Score Breakdown" />
          
          <div className="glass-card rounded-xl p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <p className="text-gray-500 text-xs uppercase mb-1">Logistics Complexity</p>
                <p className="text-white font-semibold capitalize">{analysis.fitScoreBreakdown?.logisticsComplexity}</p>
              </div>
              <div className="text-center">
                <p className="text-gray-500 text-xs uppercase mb-1">Pain Signal</p>
                <p className="text-white font-semibold capitalize">{analysis.fitScoreBreakdown?.painSignalStrength}</p>
              </div>
              <div className="text-center">
                <p className="text-gray-500 text-xs uppercase mb-1">Equipment Match</p>
                <p className="text-white font-semibold capitalize">{analysis.fitScoreBreakdown?.equipmentMatch}</p>
              </div>
              <div className="text-center">
                <p className="text-gray-500 text-xs uppercase mb-1">DM Access</p>
                <p className="text-white font-semibold capitalize">{analysis.fitScoreBreakdown?.decisionMakerAccess}</p>
              </div>
            </div>
            
            <div className="border-t border-gray-700 pt-4">
              <p className="text-gray-400 text-sm">{analysis.fitScoreBreakdown?.actionGuidance}</p>
            </div>
          </div>
        </section>

        {/* === SECTION 7: RESEARCH NOTES (COLLAPSED) === */}
        <section className="mb-8">
          <button 
            onClick={() => setShowResearch(!showResearch)}
            className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors w-full"
          >
            <span className="text-xl">🔍</span>
            <span className="font-semibold">Research Notes</span>
            <svg 
              className={`w-4 h-4 transition-transform ${showResearch ? 'rotate-180' : ''}`} 
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="text-xs text-gray-600">(click to expand)</span>
          </button>
          
          {showResearch && (
            <div className="mt-4 glass-card rounded-xl p-5 space-y-4">
              <div>
                <p className="text-gray-500 text-xs uppercase mb-1">Company Overview</p>
                <p className="text-gray-300">{analysis.researchNotes?.companyOverview}</p>
              </div>
              
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-500 text-xs uppercase mb-1">Products</p>
                  <p className="text-gray-300">{analysis.researchNotes?.products?.join(", ")}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs uppercase mb-1">Commodities Shipped</p>
                  <p className="text-gray-300">{analysis.researchNotes?.commodities?.join(", ")}</p>
                </div>
              </div>
              
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-green-400 text-xs uppercase mb-1">Equipment Needed</p>
                  <p className="text-gray-300">{analysis.researchNotes?.equipmentNeeded?.join(", ")}</p>
                </div>
                <div>
                  <p className="text-red-400 text-xs uppercase mb-1">Equipment NOT Needed</p>
                  <p className="text-gray-300">{analysis.researchNotes?.equipmentNotNeeded?.join(", ")}</p>
                </div>
              </div>
              
              <div>
                <p className="text-gray-500 text-xs uppercase mb-1">Logistics Signals</p>
                <ul className="text-gray-300 space-y-1">
                  {analysis.researchNotes?.logisticsSignals?.map((signal, i) => (
                    <li key={i}>• {signal}</li>
                  ))}
                </ul>
              </div>
              
              <div>
                <p className="text-gray-500 text-xs uppercase mb-1">Website Maturity</p>
                <p className="text-gray-300 capitalize">{analysis.researchNotes?.websiteMaturity}</p>
              </div>
              
              {analysis.apollo && (
                <div className="border-t border-gray-700 pt-4">
                  <p className="text-gray-500 text-xs uppercase mb-2">Apollo Data</p>
                  <p className="text-gray-400 text-sm">
                    {analysis.apollo.industry} • {analysis.apollo.employeeCount?.toLocaleString()} employees
                    {analysis.apollo.foundedYear && ` • Founded ${analysis.apollo.foundedYear}`}
                  </p>
                  {analysis.apollo.description && (
                    <p className="text-gray-400 text-sm mt-1">{analysis.apollo.description}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

      </main>

      <footer className="py-6 text-center border-t border-gray-800">
        <p className="text-xs text-gray-600">
          Analyzed {new Date(analysis.analyzedAt).toLocaleString()} • VL Pitch
        </p>
      </footer>
    </div>
  );
}
