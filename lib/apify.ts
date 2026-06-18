// Apify Google Maps Places scraper helpers.
// Ported from the original Base44 Deno backend functions.

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "compass~crawler-google-places";

export function apifyToken(): string {
  const t = process.env.APIFY_API_TOKEN;
  if (!t) throw new Error("Missing APIFY_API_TOKEN");
  return t;
}

export async function startApifyRun(opts: {
  niche: string;
  city: string;
  cap: number;
}): Promise<Response> {
  const token = apifyToken();
  return fetch(`${APIFY_BASE}/acts/${ACTOR}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchStringsArray: [opts.niche],
      locationQuery: opts.city,
      maxCrawledPlaces: opts.cap,
      maxCrawledPlacesPerSearch: opts.cap,
      language: "en",
      includeHistogram: false,
      includeOpeningHours: false,
      includePeopleAlsoSearch: false,
      maxReviews: 0,
      maxImages: 0,
      maxQuestions: 0,
    }),
  });
}

export async function getApifyRun(runId: string): Promise<Response> {
  const token = apifyToken();
  return fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`);
}

export async function getApifyDataset(datasetId: string): Promise<Response> {
  const token = apifyToken();
  return fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&format=json`
  );
}

type RunContext = {
  industry?: string | null;
  niche?: string | null;
  city?: string | null;
};

// Maps one Apify place item to scrape-owned Prospect columns.
// IMPORTANT: returns ONLY scrape-sourced fields — never pipeline_stage, qualified,
// or scores — so re-scraping refreshes contact data without wiping CRM work.
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
    review_count:
      typeof item.reviewsCount === "number" ? item.reviewsCount : null,
    has_website: !!item.website,
    scraped_at: new Date().toISOString(),
  };
}
