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
    context += `\nAPOLLO DATA:\n- Company: ${apollo.name}\n- Industry: ${apollo.industry}\n- Employees: ${apollo.employeeCount}\n`;
  }

  if (hubspot?.exists) {
    context += `\nHUBSPOT: Company exists as "${hubspot.companyName}"\n`;
  }

  const prompt = `You are a sales intelligence analyst for Vantage Logistics, a freight brokerage specializing in temperature-controlled (reefer), flatbed, and specialized freight.

VANTAGE'S SELLING STYLE:
- Consultative, problem-led approach (Mike Weinberg methodology)
- Lead with customer pain, not product features
- Power Statement: "We work with [TYPE] who are frustrated by [PROBLEM]. We help by [SOLUTION], which leads to [RESULT]."

VANTAGE'S STRENGTHS:
- Temperature-controlled freight expertise (food, produce, pharma)
- Flatbed and specialized freight (steel, lumber, machinery, oversized)
- Dedicated capacity and carrier networks
- Real-time visibility and proactive communication
- Midwest hub with East Coast, Southern, and Western lanes

EQUIPMENT MATCHING (CRITICAL - match to actual products):
- Food/Produce/Pharma/Chemicals → Reefer (temperature-controlled)
- Steel/Metal/Barriers/Machinery/Lumber/Building Materials → Flatbed, Step Deck
- Oversized/Heavy Equipment → RGN, Lowboy, Specialized
- General Packaged Goods/Palletized → Dry Van
- Mixed or Weather-Sensitive non-temp → Conestoga, Curtainside
- DO NOT suggest temperature-controlled equipment unless the company actually ships perishables

${context}

WEBSITE CONTENT:
${websiteData.rawText.substring(0, 20000)}

---

FIRST: Identify what this company manufactures/sells/ships. Match equipment to their actual products.

Analyze and respond in JSON:
{
  "commodityAnalysis": {
    "products": ["what they make/sell"],
    "likelyCommodities": ["what they actually ship"],
    "equipmentNeeded": ["Flatbed", "Step Deck", etc - match to products],
    "equipmentNOTNeeded": ["Reefer", etc - exclude irrelevant types],
    "reasoning": "Why these equipment types"
  },
  "positioning": {
    "summary": "2-3 sentence explanation",
    "operationalPriorities": ["priority 1", "priority 2", "priority 3"],
    "likelyPainPoints": ["pain 1", "pain 2", "pain 3"],
    "logisticsRiskAreas": ["risk 1", "risk 2"]
  },
  "talkingPoints": [
    {"angle": "Brief angle", "opener": "We work with...", "followUp": "Curious how..."}
  ],
  "objections": [
    {"objection": "The objection", "likelihood": "high|medium|low", "response": "Reframe"}
  ],
  "websiteFeedback": {
    "messagingGaps": ["gap 1"],
    "logisticsMaturity": "sophisticated|basic|absent",
    "outreachDifficulty": "easy|medium|hard",
    "explanation": "Why"
  },
  "fitScore": {
    "overall": 7,
    "logisticsComplexity": "high|medium|low",
    "painSignalStrength": "high|medium|low",
    "messagingMaturity": "sophisticated|generic|thin"
  }
}

CRITICAL RULES:
1. Identify actual products/commodities FIRST
2. Only recommend equipment that matches what they ship
3. Steel/metal products = flatbed, NOT reefer
4. Food/produce = reefer
5. Talking points must reference appropriate equipment for THEIR products
6. Never suggest temp-controlled for non-perishable goods

Provide 3-4 talking points and 2-3 objections. Be specific to this company.`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "Respond with valid JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 4000,
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
