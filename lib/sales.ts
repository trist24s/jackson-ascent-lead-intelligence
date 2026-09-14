// Jackson Ascent sales intelligence. Pure functions, no I/O — client/server safe.
// Offer + pricing reflect the authoritative business context (Sept 2026):
//   ONE offer — the Growth System. Standard $1,000 setup + $2,000/mo (ad spend
//   billed separately). Founding Client Offer (first 3 clients): $1,500 first
//   month, then $2,000/mo.

import type { ScoreInput } from "./scoring";

export type SalesInput = ScoreInput & {
  roofing_confidence?: number | null;
  business_hours?: unknown;
};

function hasHours(p: SalesInput): boolean {
  return Array.isArray(p.business_hours) && (p.business_hours as unknown[]).length > 0;
}

// ---------------------------------------------------------------------------
// The offer (single Growth System).
// ---------------------------------------------------------------------------
export const GROWTH_SYSTEM = {
  name: "Growth System",
  setup: 1000,          // standard one-time setup
  monthly: 2000,        // standard recurring
  fcoFirstMonth: 1500,  // Founding Client Offer: first month total (setup + month 1)
  adSpendNote: "Ad spend billed separately, directly by the client.",
};
export const FOUNDING_CLIENT_LIMIT = 3;

// ---------------------------------------------------------------------------
// Opportunity Score (0-100).
// ---------------------------------------------------------------------------
export function opportunityScore(p: SalesInput): { score: number; category: "Low" | "Medium" | "High" } {
  let s = 0;
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const hasWeb = !!(p.has_website || p.website);

  if (rc >= 200) s += 30; else if (rc >= 100) s += 25; else if (rc >= 50) s += 18; else if (rc >= 20) s += 12; else if (rc >= 5) s += 6;
  if (r >= 4.5) s += 20; else if (r >= 4.0) s += 15; else if (r >= 3.5) s += 9; else if (r > 0) s += 4;
  if (hasWeb) s += 10;
  if (rc >= 100) s += 10; else if (rc >= 40) s += 5;
  s += Math.round(((p.roofing_confidence ?? 0) / 100) * 15);
  if (hasHours(p)) s += 5;
  if (r >= 4.5 && rc >= 50) s += 10; else if (r >= 4.2 && rc >= 30) s += 5;

  const score = Math.max(0, Math.min(100, s));
  const category = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return { score, category };
}

// ---------------------------------------------------------------------------
// Fit: is this roofer a good fit for the Growth System (~$2k/mo)?
// Ideal client = established roofer with capacity, real lead volume, and clear
// missed-call / follow-up gaps who can support the monthly and fund ad spend.
// ---------------------------------------------------------------------------
export type Fit = { level: "Strong Fit" | "Possible Fit" | "Weak Fit"; reason: string };

export function fitAssessment(p: SalesInput): Fit {
  const opp = opportunityScore(p).score;
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  if (opp >= 60 && rc >= 40 && r >= 3.8) {
    return { level: "Strong Fit", reason: "Established roofer with real volume and room to book more — can support ~$2k/mo and benefit meaningfully from the Growth System." };
  }
  if (opp >= 40) {
    return { level: "Possible Fit", reason: "Some traction — qualify their lead volume, missed-call pain, and budget on the call." };
  }
  return { level: "Weak Fit", reason: "Small or low-signal — may not have the volume or budget for the Growth System yet." };
}

// ---------------------------------------------------------------------------
// Estimated monthly ROI — booked estimates recovered from faster lead response.
// ---------------------------------------------------------------------------
export function estimatedMonthlyROI(p: SalesInput): { amount: number; appts: number; display: string } {
  const rc = p.review_count ?? 0;
  const appts = rc >= 150 ? 6 : rc >= 75 ? 5 : rc >= 30 ? 3 : 2;
  const avgJob = 9000; // avg roofing job revenue
  const amount = appts * avgJob;
  return { amount, appts, display: `~$${amount.toLocaleString()}/mo (${appts} recovered estimates)` };
}

// ---------------------------------------------------------------------------
// Sales angle, objection, response — framed around the complete Growth System.
// ---------------------------------------------------------------------------
export function salesAngle(p: SalesInput): string {
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const hasWeb = !!(p.has_website || p.website);
  if (r > 0 && r < 4.0) return "Reputation may be costing you jobs — a system that captures every lead, follows up instantly, and builds reviews lifts both close rate and trust.";
  if (!hasWeb || rc < 30) return "You may be losing leads after hours and missing calls during jobs — missed-call text-back, an AI receptionist, and instant follow-up book more estimates.";
  if (r >= 4.3 && rc >= 100) return "Strong reputation, but you may not be converting every inbound into a booked estimate — a full lead-management + follow-up system captures the leakage.";
  return "You generate interest but may be leaking leads between the call, the follow-up, and the booking — a complete Growth System closes those gaps.";
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
  "We already answer our own phones.": "Totally — but when you're on a roof or driving, those calls hit voicemail. The system texts every missed call back instantly and books the time, so you don't lose the job to whoever picks up next.",
  "We already have someone handling that.": "Love that you've got coverage. This runs alongside them — it catches after-hours and overflow, follows up automatically, and books straight into the calendar, so your person only works the hot ones.",
  "We're already busy — we don't need more leads.": "Makes sense — this isn't about more leads, it's about not losing the ones you already get. Recovering even 2-3 estimates a month from missed calls and slow follow-up more than covers it.",
  "We've tried something like this before.": "Fair — most setups are a single tool, not a system. This is the full loop for roofers: capture, instant follow-up, AI booking, pipeline, and reporting — and you'll see exactly what you were missing.",
};

export function suggestedResponse(p: SalesInput): string {
  return RESPONSES[objectionPrediction(p)] || RESPONSES["We already answer our own phones."];
}

// Everything a salesperson needs for one lead.
export function salesIntel(p: SalesInput) {
  return {
    offer: GROWTH_SYSTEM,
    fit: fitAssessment(p),
    opp: opportunityScore(p),
    roi: estimatedMonthlyROI(p),
    angle: salesAngle(p),
    objection: objectionPrediction(p),
    response: suggestedResponse(p),
  };
}
