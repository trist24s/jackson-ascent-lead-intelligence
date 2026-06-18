// Jackson Ascent sales intelligence. Pure functions, no I/O — client/server safe.
// Turns a stored prospect into: which offer to pitch, price, why, opportunity score,
// ROI estimate, the sales angle, the likely objection, and how to respond.

import type { ScoreInput } from "./scoring";

export type SalesInput = ScoreInput & {
  roofing_confidence?: number | null;
  business_hours?: unknown;
};

function hasHours(p: SalesInput): boolean {
  return Array.isArray(p.business_hours) && (p.business_hours as unknown[]).length > 0;
}

// ---------------------------------------------------------------------------
// Opportunity Score (0-100) — separate from Lead Score.
// ---------------------------------------------------------------------------
export function opportunityScore(p: SalesInput): { score: number; category: "Low" | "Medium" | "High" } {
  let s = 0;
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const hasWeb = !!(p.has_website || p.website);

  // Review volume (0-30)
  if (rc >= 200) s += 30; else if (rc >= 100) s += 25; else if (rc >= 50) s += 18; else if (rc >= 20) s += 12; else if (rc >= 5) s += 6;
  // Rating (0-20)
  if (r >= 4.5) s += 20; else if (r >= 4.0) s += 15; else if (r >= 3.5) s += 9; else if (r > 0) s += 4;
  // Website presence (0-10)
  if (hasWeb) s += 10;
  // Business size signal (0-10)
  if (rc >= 100) s += 10; else if (rc >= 40) s += 5;
  // Roofing confidence (0-15)
  s += Math.round(((p.roofing_confidence ?? 0) / 100) * 15);
  // Hours of operation present (0-5)
  if (hasHours(p)) s += 5;
  // Local reputation bonus (0-10)
  if (r >= 4.5 && rc >= 50) s += 10; else if (r >= 4.2 && rc >= 30) s += 5;

  const score = Math.max(0, Math.min(100, s));
  const category = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return { score, category };
}

// ---------------------------------------------------------------------------
// Offer recommendation.
// ---------------------------------------------------------------------------
export type Offer = { name: string; setup: number; monthly: number; why: string };

const AI_LEAD = { name: "AI Lead Conversations", setup: 1500, monthly: 1000 };
const GROWTH = { name: "Complete Growth System", setup: 1500, monthly: 1800 };

export function recommendOffer(p: SalesInput): Offer {
  const opp = opportunityScore(p).score;
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const established = rc >= 75 && r >= 4.2;

  if (opp >= 70 && established) {
    return { ...GROWTH, why: "Established operation with strong reviews and growth headroom — the full system maximizes conversion, retention, reviews, and lead reactivation." };
  }
  return { ...AI_LEAD, why: "Likely missing calls and slow to follow up — an AI receptionist, missed-call text-back, and automated booking recover booked estimates quickly." };
}

// ---------------------------------------------------------------------------
// Estimated monthly ROI — recovered jobs from faster lead response.
// ---------------------------------------------------------------------------
export function estimatedMonthlyROI(p: SalesInput): { amount: number; appts: number; display: string } {
  const rc = p.review_count ?? 0;
  const appts = rc >= 150 ? 6 : rc >= 75 ? 5 : rc >= 30 ? 3 : 2; // est. extra booked estimates / mo
  const avgJob = 9000; // avg roofing job revenue
  const amount = appts * avgJob;
  return { amount, appts, display: `~$${amount.toLocaleString()}/mo (${appts} recovered estimates)` };
}

// ---------------------------------------------------------------------------
// Sales angle, objection, response.
// ---------------------------------------------------------------------------
export function salesAngle(p: SalesInput): string {
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const hasWeb = !!(p.has_website || p.website);
  if (r > 0 && r < 4.0) return "Your online reputation may be costing you jobs — capturing every lead and generating reviews lifts both close rate and trust.";
  if (!hasWeb || rc < 30) return "You may be losing leads after hours and missing calls during busy jobs — speed-to-lead books more estimates.";
  if (r >= 4.3 && rc >= 100) return "Strong reputation, but you may not be converting every inbound call into a booked estimate — small conversion gains mean big revenue.";
  return "You generate interest but may be leaking leads between the call, the follow-up, and the booking — automation closes the gap.";
}

export function objectionPrediction(p: SalesInput): string {
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const hasWeb = !!(p.has_website || p.website);
  if (rc < 50 || !hasWeb) return "We already answer our own phones.";
  if (rc >= 150) return "We already have someone handling that.";
  if (r >= 4.3) return "We're already busy — we don't need more leads.";
  return "We've tried something like this before.";
}

const RESPONSES: Record<string, string> = {
  "We already answer our own phones.": "Totally — but when you're on a roof or driving, those calls hit voicemail. We make sure every missed call gets an instant text back and a booked time, so you don't lose the job to whoever picks up next.",
  "We already have someone handling that.": "Love that you've got coverage. This runs alongside them — it catches after-hours and overflow calls and books straight into your calendar, so your person only works the hot ones.",
  "We're already busy — we don't need more leads.": "Makes sense — this isn't about more leads, it's about not losing the ones you already get. Booking even 2-3 extra estimates a month from missed calls pays for itself many times over.",
  "We've tried something like this before.": "Fair — most tools are generic. Ours is built for roofers: it qualifies the caller, books the inspection, and follows up automatically. Worst case, you finally see how many calls you've been missing.",
};

export function suggestedResponse(p: SalesInput): string {
  return RESPONSES[objectionPrediction(p)] || RESPONSES["We already answer our own phones."];
}

// Convenience: everything a salesperson needs for one lead.
export function salesIntel(p: SalesInput) {
  return {
    offer: recommendOffer(p),
    opp: opportunityScore(p),
    roi: estimatedMonthlyROI(p),
    angle: salesAngle(p),
    objection: objectionPrediction(p),
    response: suggestedResponse(p),
  };
}
