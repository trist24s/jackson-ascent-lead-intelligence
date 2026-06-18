// Pure, framework-agnostic lead scoring. No I/O, no imports — safe in client or server,
// and portable to any future backend. All scores are derived from stored prospect fields.

export type ScoreInput = {
  has_website?: boolean | null;
  website?: string | null;
  rating?: number | null;
  review_count?: number | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  industry?: string | null;
};

export function leadScore(p: ScoreInput): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const hasWeb = !!(p.has_website || p.website);

  // Website presence + basic quality (0-20)
  if (hasWeb) {
    score += 20;
    reasons.push("Has a website");
  } else {
    reasons.push("No website found");
  }

  // Review volume (0-25)
  const rc = p.review_count ?? 0;
  if (rc >= 100) { score += 25; reasons.push(`Strong review volume (${rc})`); }
  else if (rc >= 50) { score += 20; reasons.push(`Good review volume (${rc})`); }
  else if (rc >= 20) { score += 14; reasons.push(`Moderate reviews (${rc})`); }
  else if (rc >= 5)  { score += 8;  reasons.push(`Few reviews (${rc})`); }
  else { reasons.push("Very few or no reviews"); }

  // Google rating (0-20)
  const r = p.rating ?? 0;
  if (r >= 4.5) { score += 20; reasons.push(`Excellent rating (${r})`); }
  else if (r >= 4.0) { score += 15; reasons.push(`Good rating (${r})`); }
  else if (r >= 3.0) { score += 8;  reasons.push(`Average rating (${r})`); }
  else if (r > 0)    { score += 3;  reasons.push(`Low rating (${r})`); }

  // Contact info availability (0-15)
  if (p.phone) { score += 8; reasons.push("Phone available"); }
  if (p.email) { score += 7; reasons.push("Email available"); }

  // Business description (0-10)
  if (p.description && p.description.trim().length > 0) {
    score += 10;
    reasons.push("Has a business description");
  }

  // Local SEO indicator: category matches the target industry (0-5)
  if (p.category && p.industry && p.category.toLowerCase().includes(p.industry.toLowerCase())) {
    score += 5;
    reasons.push("Category matches target industry");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

export function scoreColor(score: number): "green" | "yellow" | "red" {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

export function recommendService(p: ScoreInput): { service: string; reason: string } {
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const hasWeb = !!(p.has_website || p.website);

  if (!hasWeb) {
    return { service: "Website Redesign", reason: "No website detected — needs a professional, conversion-focused web presence." };
  }
  if (r > 0 && r < 4.0) {
    return { service: "Reputation Management", reason: `Rating is ${r} — review generation will lift trust and conversion.` };
  }
  if (rc < 20) {
    return { service: "Local SEO", reason: `Only ${rc} reviews — low local visibility; SEO will grow organic leads.` };
  }
  if (rc >= 100 && r >= 4.3) {
    return { service: "Google Ads", reason: "Strong reputation but capped by organic reach — paid search will scale lead volume." };
  }
  if (rc >= 20) {
    return { service: "Facebook Ads", reason: "Solid reputation and site — social ads can drive inspection bookings." };
  }
  return { service: "CRM Automation", reason: "Established business — automation will convert more of their existing leads." };
}

export type Priority = {
  level: "immediate" | "high" | "medium" | "low";
  label: string;
  emoji: string;
};

export function contactPriority(p: ScoreInput): Priority {
  const { score } = leadScore(p);
  const rc = p.review_count ?? 0;
  const hasWeb = !!(p.has_website || p.website);
  const bigBusiness = rc >= 50;        // proxy for size / service area
  const missingMarketing = !hasWeb;    // clear, sellable gap

  if (bigBusiness && missingMarketing) return { level: "immediate", label: "Contact Immediately", emoji: "🔥" };
  if (score >= 80 || (bigBusiness && score >= 60)) return { level: "high", label: "High", emoji: "⭐" };
  if (score >= 55) return { level: "medium", label: "Medium", emoji: "📞" };
  return { level: "low", label: "Low", emoji: "📋" };
}
