// Jackson Ascent sales intelligence. Pure functions, no I/O — client/server safe.
// Offer + pricing reflect the current model (Nov 9, 2026):
//   ONE offer — the Missed-Call Recovery System. $1,500/mo, NO setup fee, no ad spend.
//   First month is paid upfront (before setup starts) and is non-refundable once
//   setup begins. Month-to-month after that; cancel before the next billing date.

import type { ScoreInput } from "./scoring";

export type SalesInput = ScoreInput & {
  roofing_confidence?: number | null;
  business_hours?: unknown;
};

function hasHours(p: SalesInput): boolean {
  return Array.isArray(p.business_hours) && (p.business_hours as unknown[]).length > 0;
}

// ---------------------------------------------------------------------------
// The offer.
// ---------------------------------------------------------------------------
export const OFFER = {
  name: "Missed-Call Recovery System",
  setup: 0, // no setup fee — month 1 is collected upfront instead
  monthly: 1500,
  terms: "No setup fee · first month paid upfront · month-to-month",
  pitch: "No setup fee, no ad spend, $1,500 a month, cancel anytime. If it doesn't catch at least one job's worth of calls, you walk.",
};

// One-click Meta Ad Library lookup for a business (free, public). Opens active ads
// matching the business name so you can eyeball whether they're advertising.
export function adLibraryUrl(name: string, state?: string | null): string {
  const q = encodeURIComponent([name, state].filter(Boolean).join(" "));
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${q}&search_type=keyword_unordered`;
}

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
  // Paying for ads = paying for calls they can't afford to miss.
  if (p.ads_running || (p.ads_score ?? 0) >= 5) s += 10;
  // Already open 24 hours = probably already answering; weaker fit.
  if (Array.isArray(p.business_hours) && (p.business_hours as { hours?: string }[]).some((h) => /24\s*hours|open 24/i.test(h?.hours || ""))) s -= 10;

  const score = Math.max(0, Math.min(100, s));
  const category = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return { score, category };
}

// ---------------------------------------------------------------------------
// Fit: is this roofer a good fit for the Missed-Call Recovery System?
// Ideal = established roofer getting real inbound call volume that they miss while
// crews are on jobs / after hours.
// ---------------------------------------------------------------------------
export type Fit = { level: "Strong Fit" | "Possible Fit" | "Weak Fit"; reason: string };

export function fitAssessment(p: SalesInput): Fit {
  const opp = opportunityScore(p).score;
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  if (rc < 20) {
    return { level: "Weak Fit", reason: "Under 20 reviews — probably not enough call volume to justify $1,500/mo yet." };
  }
  if (opp >= 60 && rc >= 40 && r >= 3.8) {
    return { level: "Strong Fit", reason: "Established roofer with real call volume — exactly who loses the most to missed calls, and who recovers the cost the fastest (one saved roof job more than covers the month)." };
  }
  if (opp >= 40) {
    return { level: "Possible Fit", reason: "Some traction — confirm they're getting inbound calls they miss while out on jobs." };
  }
  return { level: "Weak Fit", reason: "Small or low-signal — may not have the call volume yet for this to pay off." };
}

// ---------------------------------------------------------------------------
// Estimated monthly ROI — roofing jobs recovered from catching missed calls.
// ---------------------------------------------------------------------------
export function estimatedMonthlyROI(p: SalesInput): { amount: number; appts: number; display: string } {
  const rc = p.review_count ?? 0;
  const appts = rc >= 150 ? 6 : rc >= 75 ? 5 : rc >= 30 ? 3 : 2;
  const avgJob = 9000; // avg roofing job revenue
  const amount = appts * avgJob;
  return { amount, appts, display: `~$${amount.toLocaleString()}/mo (${appts} recovered jobs)` };
}

// ---------------------------------------------------------------------------
// Sales angle, objection, response — framed around missed-call recovery.
// ---------------------------------------------------------------------------
export function salesAngle(p: SalesInput): string {
  const rc = p.review_count ?? 0;
  const r = p.rating ?? 0;
  const hasWeb = !!(p.has_website || p.website);
  if (r > 0 && r < 4.0) return "A missed call when your rating's already shaky means that homeowner books the next roofer — catching and texting back every missed call keeps those jobs with you.";
  if (!hasWeb || rc < 30) return "When your crew's on a roof or driving between jobs, those calls go to voicemail and the homeowner calls the next contractor — this catches every missed call, texts them back in 30 seconds, and books the inspection.";
  if (r >= 4.3 && rc >= 100) return "You've got the demand, but every missed call during a job is a lost estimate — this locks those leads down automatically and books them straight onto your calendar.";
  return "You're getting calls you can't always grab on the roof — this catches the missed ones, follows up instantly, and books the inspection, so none slip away.";
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
  "We already answer our own phones.": "For sure — but when you're up on a roof or driving between jobs, those calls hit voicemail, and most homeowners just call the next roofer. This texts every missed call back within 30 seconds and books the inspection, so you keep the job you already earned.",
  "We already have someone handling that.": "Nice — this runs right alongside them. It covers the after-hours and overflow they can't catch, texts the homeowner back instantly, and drops the booked inspection on your calendar.",
  "We're already busy — we don't need more leads.": "Totally — this isn't about more leads, it's about not losing the ones calling you right now. One recovered roof job a month more than pays for it.",
  "We've tried something like this before.": "Fair — most of those were one gadget, not the full catch-and-book loop. This answers the missed call, texts back in 30 seconds, qualifies them, and books the inspection automatically. No setup fee and it's month-to-month — worst case, you finally see how many calls you've been missing and cancel.",
};

export function suggestedResponse(p: SalesInput): string {
  return RESPONSES[objectionPrediction(p)] || RESPONSES["We already answer our own phones."];
}

// Everything a salesperson needs for one lead.
export function salesIntel(p: SalesInput) {
  return {
    offer: OFFER,
    fit: fitAssessment(p),
    opp: opportunityScore(p),
    roi: estimatedMonthlyROI(p),
    angle: salesAngle(p),
    objection: objectionPrediction(p),
    response: suggestedResponse(p),
  };
}
