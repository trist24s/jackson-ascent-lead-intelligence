// Rule-based roofing qualification. Pure, no I/O. Scores how confident we are that a
// scraped business is a real roofing/exterior contractor (0-100), using Google's own
// category plus the business name. Google categories (e.g. "Roofing contractor") are
// highly reliable, so this is accurate without an LLM. A future LLM pass can replace
// the body of roofingConfidence() without changing any callers.

export type QualifyInput = {
  category?: string | null;
  name?: string | null;
  industry?: string | null;
};

const RELATED = ["siding", "gutter", "exterior"];

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
  const root = industry.replace(/ing$/, ""); // "roofing" -> "roof"
  const cat = (input.category || "").toLowerCase();
  const name = (input.name || "").toLowerCase();
  const hay = `${cat} ${name}`;

  const mentionsRoot = hay.includes(root);
  const excluded = EXCLUDE.some((t) => hay.includes(t));

  // Strongest signal: Google category names the trade.
  if (cat.includes("roofing") || cat.includes(root + "ing")) return 97;
  if (cat.includes(root)) return 94;
  // Business name names the trade.
  if (name.includes(root)) return 86;
  // Adjacent exterior trades in the category.
  if (RELATED.some((t) => cat.includes(t))) return 80;
  if (RELATED.some((t) => hay.includes(t)) && !excluded) return 74;
  // Clearly unrelated business types.
  if (excluded && !mentionsRoot) return 12;
  // Generic contractor/construction without a clear trade signal.
  if (cat.includes("contractor") || cat.includes("construction")) return 55;
  return 35;
}

export function confidenceLabel(c: number): string {
  if (c >= 85) return "Very likely roofing";
  if (c >= 70) return "Likely roofing";
  if (c >= 50) return "Uncertain";
  return "Unlikely roofing";
}
