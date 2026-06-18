// Apify Google Maps Places scraper helpers. Hardened for production.

const APIFY_BASE = "https://api.apify.com/v2";
// Verified live: GET /v2/acts/compass~crawler-google-places -> id nwua9Gu5YrADL7ZDj, public.
export const ACTOR_ID = "compass~crawler-google-places";

export function apifyToken(): string {
  const t = process.env.APIFY_API_TOKEN;
  if (!t || !t.trim()) throw new Error("Missing APIFY_API_TOKEN environment variable");
  return t.trim();
}

function authHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${apifyToken()}` };
}

export function buildRunInput(niche: string, city: string, cap: number) {
  return {
    searchStringsArray: [niche],
    locationQuery: city,
    maxCrawledPlaces: cap,
    maxCrawledPlacesPerSearch: cap,
    language: "en",
    includeHistogram: false,
    includeOpeningHours: true, // V2: needed for call intelligence
    includePeopleAlsoSearch: false,
    maxReviews: 0,
    maxImages: 0,
    maxQuestions: 0,
  };
}

export async function startApifyRun(opts: { niche: string; city: string; cap: number }): Promise<Response> {
  const url = `${APIFY_BASE}/acts/${ACTOR_ID}/runs`;
  const input = buildRunInput(opts.niche, opts.city, opts.cap);
  console.log("[apify] startApifyRun ->", JSON.stringify({ actorId: ACTOR_ID, url, input }));
  const res = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(input) });
  console.log("[apify] startApifyRun response status:", res.status);
  return res;
}

export async function getApifyRun(runId: string): Promise<Response> {
  if (!runId || !runId.trim() || runId === "pending") {
    throw new Error(`getApifyRun called with invalid runId: "${runId}"`);
  }
  const url = `${APIFY_BASE}/actor-runs/${runId}`;
  console.log("[apify] getApifyRun ->", url);
  const res = await fetch(url, { headers: authHeaders() });
  console.log("[apify] getApifyRun response status:", res.status);
  return res;
}

export async function getApifyDataset(datasetId: string): Promise<Response> {
  if (!datasetId || !datasetId.trim()) {
    throw new Error(`getApifyDataset called with invalid datasetId: "${datasetId}"`);
  }
  const url = `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&format=json`;
  console.log("[apify] getApifyDataset ->", url);
  const res = await fetch(url, { headers: authHeaders() });
  console.log("[apify] getApifyDataset response status:", res.status);
  return res;
}

// V2 FEATURE 7: keep only relevant contractors; drop clearly-unrelated business types.
const EXCLUDED_PATTERNS: RegExp[] = [
  /hardware store/i,
  /home improvement/i,
  /building materials/i,
  /lumber/i,
  /auto repair/i,
  /car (repair|dealer)/i,
  /auto parts/i,
  /tire shop/i,
  /non-?profit/i,
  /charity/i,
  /supermarket/i,
  /grocery/i,
  /department store/i,
  /clothing store/i,
  /furniture store/i,
  /restaurant/i,
  /pharmacy/i,
];

export function isRelevant(item: any, industry: string): boolean {
  const cat = item?.categoryName || (Array.isArray(item?.categories) ? item.categories.join(" ") : "") || "";
  const title = item?.title || "";
  const hay = `${cat} ${title}`;
  // Always keep anything that explicitly mentions the target industry (e.g. "roofing").
  if (industry && new RegExp(industry, "i").test(hay)) return true;
  // Otherwise drop clearly-unrelated business types.
  return !EXCLUDED_PATTERNS.some((re) => re.test(hay));
}

type RunContext = { industry?: string | null; niche?: string | null; city?: string | null };

// Maps one Apify place item to scrape-owned Prospect columns.
// IMPORTANT: returns ONLY scrape-sourced fields — never pipeline_stage, qualified,
// scores, or notes — so re-scraping refreshes data without wiping CRM work.
export function mapItem(item: any, run: RunContext) {
  return {
    place_id: item.placeId,
    name: item.title,
    industry: run.industry || run.niche || "roofing",
    niche: run.niche ?? null,
    phone: item.phone ?? null,
    email: item.emails?.[0] ?? null,
    website: item.website ?? null,
    address: item.address ?? null,
    city: item.city ?? run.city ?? null,
    state: item.state ?? null,
    zip: item.postalCode ?? null,
    rating: typeof item.totalScore === "number" ? item.totalScore : null,
    review_count: typeof item.reviewsCount === "number" ? item.reviewsCount : null,
    has_website: !!item.website,
    business_hours: Array.isArray(item.openingHours) ? item.openingHours : null,
    description: item.description ?? null,
    category: item.categoryName ?? (Array.isArray(item.categories) ? item.categories[0] : null) ?? null,
    scraped_at: new Date().toISOString(),
  };
}
