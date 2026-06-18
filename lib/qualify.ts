// Rule-based roofing qualification. Pure, no I/O. Scores how confident we are that a
// scraped business is a roofing/exterior contractor (0-100), from Google's category +
// the business name. Any clear roofing signal qualifies; only clearly-unrelated business
// types are rejected. A future LLM pass can replace the body without changing callers.

export type QualifyInput = {
  category?: string | null;
  name?: string | null;
  industry?: string | null;
};

// Adjacent exterior trades we also accept.
const RELATED = ["siding", "gutter", "exterior"];

// Clearly-unrelated business types (only rejected when there is NO roofing signal).
const EXCLUDE = [
  "hardware", "home improvement", "building material", "lumber",
  "auto", "car repair", "car dealer", "tire", "mechanic",
  "non-profit", "nonprofit", "charity",
  "church", "temple", "mosque", "synagogue", "place of worship",
  "restaurant", "cafe", "coffee", "bakery",
  "supermarket", "grocery", "department store", "clothing", "furniture store",
  "government", "city of", "county", "department of", "police", "fire department",
  "insurance", "real estate", "realty", "bank", "pharmacy", "salon", "spa", "school",
];

export function roofingConfidence(input: QualifyInput): number {
  const industry = (input.industry || "roofing").toLowerCase();
  const root = industry.replace(/ing$/, ""); // "roofing" -> "roof" (matches roof, roofer, roofing)
  const cat = (input.category || "").toLowerCase();
  const name = (input.name || "").toLowerCase();
  const hay = `${cat} ${name}`;

  // Strong roofing signal in category or name -> accept.
  const strong = [root, "re-roof", "shingle"];
  if (strong.some((t) => hay.includes(t))) return cat.includes(root) ? 97 : 90;

  // Adjacent exterior trades -> accept.
  if (RELATED.some((t) => hay.includes(t))) return 80;

  // Clearly-unrelated business type with no roofing signal -> reject.
  if (EXCLUDE.some((t) => hay.includes(t))) return 12;

  // Generic contractor/construction with no roofing keyword -> borderline (below threshold).
  if (cat.includes("contractor") || cat.includes("construction")) return 55;

  return 35;
}

export function confidenceLabel(c: number): string {
  if (c >= 85) return "Very likely roofing";
  if (c >= 70) return "Likely roofing";
  if (c >= 50) return "Uncertain";
  return "Unlikely roofing";
}
