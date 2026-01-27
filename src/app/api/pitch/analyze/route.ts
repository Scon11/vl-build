import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

// Load API keys from environment or config files
function loadApiKeys() {
  const vantageDir = path.join(process.env.HOME || "", ".config", "vantage");

  if (!process.env.OPENAI_API_KEY) {
    try {
      const keyPath = path.join(vantageDir, "openai.env");
      if (fs.existsSync(keyPath)) {
        const content = fs.readFileSync(keyPath, "utf-8");
        const match = content.match(/OPENAI_API_KEY=(.+)/);
        if (match) process.env.OPENAI_API_KEY = match[1].trim();
      }
    } catch (e) {}
  }

  if (!process.env.APOLLO_API_KEY) {
    try {
      const keyPath = path.join(vantageDir, "apollo.env");
      if (fs.existsSync(keyPath)) {
        const content = fs.readFileSync(keyPath, "utf-8");
        const match = content.match(/APOLLO_API_KEY=(.+)/);
        if (match) process.env.APOLLO_API_KEY = match[1].trim();
      }
    } catch (e) {}
  }

  if (!process.env.HUBSPOT_API_TOKEN) {
    try {
      const keyPath = path.join(vantageDir, "hubspot.env");
      if (fs.existsSync(keyPath)) {
        const content = fs.readFileSync(keyPath, "utf-8");
        const match = content.match(/HUBSPOT_API_TOKEN=(.+)/);
        if (match) process.env.HUBSPOT_API_TOKEN = match[1].trim();
      }
    } catch (e) {}
  }
}

loadApiKeys();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const PAGE_PATTERNS = {
  about: ["/about", "/about-us", "/company", "/who-we-are"],
  services: ["/services", "/solutions", "/what-we-do", "/products"],
  careers: ["/careers", "/jobs", "/join-us"],
  logistics: ["/logistics", "/shipping", "/transportation", "/supply-chain"],
};

async function fetchPage(url: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, aside, iframe, noscript").remove();

    const title = $("title").text().trim();
    let content = $("main, article, [role='main'], .content").first().text();
    if (!content) content = $("body").text();

    content = content.replace(/\s+/g, " ").trim().substring(0, 15000);

    return { url, title, content };
  } catch (e) {
    return null;
  }
}

async function crawlWebsite(domain: string) {
  const baseUrl = `https://www.${domain.replace(/^www\./, "")}`;

  const pages: Record<string, { url: string; title: string; content: string }> = {};

  // Fetch homepage
  const homepage = await fetchPage(baseUrl);
  if (homepage) pages.homepage = homepage;

  // Fetch other pages in parallel
  const fetches = Object.entries(PAGE_PATTERNS).map(async ([key, patterns]) => {
    for (const pattern of patterns) {
      const result = await fetchPage(`${baseUrl}${pattern}`);
      if (result && result.content.length > 200) {
        pages[key] = result;
        break;
      }
    }
  });

  await Promise.all(fetches);

  // Combine content
  const rawText = Object.entries(pages)
    .map(([section, page]) => `=== ${section.toUpperCase()} ===\n${page.content}`)
    .join("\n\n");

  return { domain, pages, rawText };
}

async function enrichFromApollo(domain: string) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      "https://api.apollo.io/api/v1/organizations/enrich",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify({ domain }),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const org = data.organization;

    if (!org) return null;

    return {
      name: org.name,
      industry: org.industry,
      employeeCount: org.estimated_num_employees,
      foundedYear: org.founded_year,
      description: org.short_description,
    };
  } catch (e) {
    return null;
  }
}

async function checkHubSpot(domain: string) {
  const token = process.env.HUBSPOT_API_TOKEN;
  if (!token) return { exists: false };

  try {
    const searchResponse = await fetch(
      "https://api.hubapi.com/crm/v3/objects/companies/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "domain",
                  operator: "CONTAINS_TOKEN",
                  value: domain.replace(/^www\./, ""),
                },
              ],
            },
          ],
          properties: ["name", "domain"],
          limit: 1,
        }),
      }
    );

    if (!searchResponse.ok) return { exists: false };

    const searchData = await searchResponse.json();

    if (!searchData.results?.length) return { exists: false };

    const company = searchData.results[0];
    const companyId = company.id;

    // Get deals
    const dealsResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/companies/${companyId}/associations/deals`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    let existingDeals: { id: string; name: string }[] = [];
    if (dealsResponse.ok) {
      const dealsData = await dealsResponse.json();
      existingDeals = (dealsData.results || []).slice(0, 5).map((d: { id: string }) => ({
        id: d.id,
        name: "Deal",
      }));
    }

    // Get contacts
    const contactsResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/companies/${companyId}/associations/contacts`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    let existingContacts: { id: string; name: string; email: string }[] = [];
    if (contactsResponse.ok) {
      const contactsData = await contactsResponse.json();
      existingContacts = (contactsData.results || []).slice(0, 5).map((c: { id: string }) => ({
        id: c.id,
        name: "Contact",
        email: "",
      }));
    }

    return {
      exists: true,
      companyId,
      companyName: company.properties.name,
      existingDeals,
      existingContacts,
    };
  } catch (e) {
    return { exists: false };
  }
}

async function analyzeWithGPT(
  websiteData: { domain: string; rawText: string },
  apollo: Awaited<ReturnType<typeof enrichFromApollo>>,
  hubspot: Awaited<ReturnType<typeof checkHubSpot>>
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key not configured");

  const client = new OpenAI({ apiKey });

  let context = "";

  if (apollo) {
    context += `\nAPOLLO DATA:\n- Company: ${apollo.name}\n- Industry: ${apollo.industry}\n- Employees: ${apollo.employeeCount}\n- Founded: ${apollo.foundedYear}\n- Description: ${apollo.description}\n`;
  }

  if (hubspot?.exists) {
    context += `\nHUBSPOT: Company exists as "${hubspot.companyName}" (ID: ${hubspot.companyId})\n- Existing deals: ${hubspot.existingDeals?.length || 0}\n- Existing contacts: ${hubspot.existingContacts?.length || 0}\n`;
  } else {
    context += `\nHUBSPOT: Net new prospect (not in CRM)\n`;
  }

  const prompt = `You are a sales execution coach embedded in a tool for Vantage Logistics reps. Your job is to generate ACTIONABLE outputs that a rep can use to make a call within 5 minutes.

=== VANTAGE SALES TRAINING (SOURCE OF TRUTH) ===

POWER STATEMENT STRUCTURE (MANDATORY):
"I work with [TYPE OF CUSTOMER] who are frustrated by [SPECIFIC PROBLEM]. We help by [SPECIFIC FIX], which leads to [BUSINESS OUTCOME]."

OBJECTION HANDLING STYLE:
- "We already have a provider" → "Totally understand — most of our customers did too. We usually come in when performance issues or specialized lanes pop up. Would it be worth seeing if there's a gap?"
- "Not interested" → "I get it. Just curious — what's working well for you right now?"
- "Send me an email" → "Happy to. Just so I'm not spamming you — what would actually make it worth opening?"
- "We're not onboarding" → "That's fair. We play the long game — this would just be a 15-minute intro. Would [DAY] work?"

KEY PRINCIPLES:
- Calling too low in the organization kills deals
- Lead with pain, not product features
- No "full-service logistics provider" language
- Sound like a human, not a brochure
- Ask for the meeting up to three times

VANTAGE STRENGTHS:
- Temperature-controlled freight (food, produce, pharma)
- Flatbed and specialized (steel, lumber, machinery, oversized)
- Dedicated capacity and carrier networks
- Real-time visibility and proactive communication
- Midwest hub with national coverage

EQUIPMENT MATCHING (CRITICAL):
- Food/Produce/Pharma → Reefer
- Steel/Metal/Machinery/Lumber/Building Materials → Flatbed, Step Deck
- Oversized/Heavy → RGN, Lowboy, Specialized
- General Packaged/Palletized → Dry Van
- DO NOT suggest reefer unless they ship perishables

${context}

WEBSITE CONTENT:
${websiteData.rawText.substring(0, 18000)}

---

ANALYZE THIS PROSPECT AND OUTPUT EXECUTION-READY JSON:

{
  "summary": {
    "oneLiner": "[COMPANY] is a [SIZE] [INDUSTRY] company shipping [COMMODITIES] via [EQUIPMENT].",
    "painSignal": "Primary pain indicator from research",
    "fitScore": 8,
    "fitRationale": "One sentence on why this score"
  },
  
  "whoToCall": {
    "primary": {
      "title": "VP of Operations or Supply Chain Director",
      "why": "Owns logistics decisions, feels delivery pain directly"
    },
    "secondary": {
      "title": "Plant Manager or Logistics Coordinator", 
      "why": "Operational insight, can validate pain and champion internally"
    },
    "avoid": {
      "title": "Purchasing / Procurement",
      "why": "Often gatekeeps without authority, focuses on price not value"
    },
    "coachingNote": "Brief note on how to approach based on org structure"
  },
  
  "scripts": {
    "coldCall": "Hi [NAME], this is [REP] with Vantage Logistics. I work with [TYPE] who are frustrated by [SPECIFIC PROBLEM]. We help by [SPECIFIC FIX], which leads to [OUTCOME]. Would 15 minutes make sense to see if there's a fit?",
    "voicemail": "Hi [NAME], [REP] with Vantage. I work with [TYPE] dealing with [PAIN]. We've helped similar companies [RESULT]. Worth a quick call — I'll try you again [DAY], or reach me at [NUMBER].",
    "emailSubject": "Pain-focused subject line, no fluff",
    "emailBody": "Keep under 75 words. One sentence on observed pain. Power statement. Ask for 15 minutes."
  },
  
  "objections": [
    {
      "objection": "We already have a provider",
      "sayThis": "Totally understand — most of our [INDUSTRY] customers did too. We usually come in when [SPECIFIC SITUATION]. Would it be worth a quick look to see if there's a gap?",
      "toneNote": "Casual confidence. Position as backup, not replacement."
    },
    {
      "objection": "[PROSPECT-SPECIFIC OBJECTION based on their situation]",
      "sayThis": "[CUSTOM REFRAME]",
      "toneNote": "[WHY this objection is likely and how to handle tone]"
    }
  ],
  
  "nextActions": {
    "primary": {
      "channel": "Phone",
      "why": "Brief reason this channel fits this prospect",
      "doToday": "Specific task: find contact on LinkedIn, call main line, etc."
    },
    "secondary": {
      "channel": "LinkedIn or Email",
      "why": "Backup approach reason",
      "doToday": "Specific task"
    },
    "cadence": [
      "Day 1: Call + voicemail",
      "Day 2: LinkedIn connect with personalized note",
      "Day 3: Email using script above",
      "Day 7: Call again",
      "Day 10: Final email (closing the loop)"
    ],
    "ifNoResponse": "Park for 30 days, then restart sequence"
  },
  
  "fitScoreBreakdown": {
    "overall": 8,
    "logisticsComplexity": "high",
    "painSignalStrength": "high", 
    "equipmentMatch": "strong",
    "decisionMakerAccess": "medium",
    "actionGuidance": "8-10 = Prioritize immediately, call today. 6-7 = Standard cadence. ≤5 = Nurture or park."
  },
  
  "researchNotes": {
    "companyOverview": "2-3 sentences about the company",
    "products": ["what they make/sell"],
    "commodities": ["what they ship"],
    "equipmentNeeded": ["Flatbed", "Step Deck"],
    "equipmentNotNeeded": ["Reefer"],
    "logisticsSignals": ["any mentions of shipping, supply chain, growth, pain"],
    "websiteMaturity": "sophisticated|basic|absent"
  }
}

CRITICAL RULES:
1. Scripts must be VERBATIM — reps read them word for word
2. Power statement structure is mandatory for all scripts
3. Objection responses must be conversational, not corporate
4. Match equipment to actual products (steel = flatbed, NOT reefer)
5. Every section must drive ACTION, not just insight
6. If a rep reads this and wonders "what should I do?" — you failed`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a sales execution coach. Respond with valid JSON only. Every output must drive immediate action — if a rep reads it and wonders 'what should I do?', you failed." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 5000,
  });

  const text = response.choices[0]?.message?.content || "";

  // Parse JSON
  let jsonStr = text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) jsonStr = match[1];

  return JSON.parse(jsonStr.trim());
}

export async function POST(request: NextRequest) {
  try {
    const { domain } = await request.json();

    if (!domain) {
      return NextResponse.json({ error: "Domain is required" }, { status: 400 });
    }

    // Crawl website
    const websiteData = await crawlWebsite(domain);

    if (!websiteData.rawText || websiteData.rawText.length < 100) {
      return NextResponse.json(
        { error: "Could not extract content from website" },
        { status: 400 }
      );
    }

    // Enrich data
    const [apollo, hubspot] = await Promise.all([
      enrichFromApollo(domain),
      checkHubSpot(domain),
    ]);

    // Analyze
    const analysis = await analyzeWithGPT(websiteData, apollo, hubspot);

    return NextResponse.json({
      domain,
      analyzedAt: new Date().toISOString(),
      apollo,
      hubspot,
      ...analysis,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
