// Pure helpers for Google business hours (Apify openingHours format).
// Times are evaluated against the provided `now` (browser local time) — an
// approximation of the business's local time, good enough for call planning.

export type OpeningHour = { day: string; hours: string };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseTime(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

type DayRange = { open: number; close: number } | "closed" | "24h";

export function normalizeHours(hours: OpeningHour[] | null | undefined): Record<string, DayRange> {
  const out: Record<string, DayRange> = {};
  if (!Array.isArray(hours)) return out;
  for (const h of hours) {
    if (!h || !h.day) continue;
    const raw = (h.hours || "").trim();
    if (/closed/i.test(raw)) { out[h.day] = "closed"; continue; }
    if (/24\s*hours|open 24/i.test(raw)) { out[h.day] = "24h"; continue; }
    const parts = raw.split(/to|–|-|—/i);
    if (parts.length >= 2) {
      const open = parseTime(parts[0]);
      const close = parseTime(parts[1]);
      if (open != null && close != null) { out[h.day] = { open, close }; continue; }
    }
  }
  return out;
}

export function openStatus(hours: OpeningHour[] | null | undefined, now: Date = new Date()): "open" | "closed" | "closing_soon" | "unknown" {
  const norm = normalizeHours(hours);
  if (Object.keys(norm).length === 0) return "unknown";
  const range = norm[DAYS[now.getDay()]];
  if (!range || range === "closed") return "closed";
  if (range === "24h") return "open";
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < range.open || mins >= range.close) return "closed";
  if (range.close - mins <= 30) return "closing_soon";
  return "open";
}

export function formatHours(hours: OpeningHour[] | null | undefined): string {
  if (!Array.isArray(hours) || hours.length === 0) return "Hours unavailable";
  return hours.map((h) => `${h.day}: ${h.hours}`).join("   ");
}

function fmt(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${m.toString().padStart(2, "0")} ${ap}`;
}

export function bestTimeToCall(hours: OpeningHour[] | null | undefined, now: Date = new Date()): string {
  return callWindow(hours, now).window;
}

// V3: open_now / closes_at / opens_next intelligence.
export function hoursIntel(hours: OpeningHour[] | null | undefined, now: Date = new Date()): {
  openNow: boolean;
  status: "open" | "closed" | "closing_soon" | "unknown";
  closesAt: string | null;
  opensNext: string | null;
} {
  const norm = normalizeHours(hours);
  const status = openStatus(hours, now);
  const mins = now.getHours() * 60 + now.getMinutes();
  let closesAt: string | null = null;
  const today = norm[DAYS[now.getDay()]];
  if (today && today !== "closed" && today !== "24h") closesAt = fmt(today.close);

  let opensNext: string | null = null;
  for (let i = 0; i < 8; i++) {
    const d = (now.getDay() + i) % 7;
    const range = norm[DAYS[d]];
    if (!range || range === "closed") continue;
    const openMin = range === "24h" ? 0 : range.open;
    if (i === 0) {
      if (mins < openMin) { opensNext = `Today ${fmt(openMin)}`; break; }
      continue;
    }
    const label = i === 1 ? "Tomorrow" : DAYS[d];
    opensNext = `${label} ${fmt(openMin)}`;
    break;
  }
  return { openNow: status === "open" || status === "closing_soon", status, closesAt, opensNext };
}

const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;

function pickCallSlot(open: number, close: number): [number, number] | null {
  const earliest = open + 30; // avoid first 30 min after opening
  const latest = close - 60;  // avoid last hour before closing
  const prefs: [number, number][] = [[9 * 60, 11 * 60], [14 * 60, 16 * 60]];
  for (const [ps, pe] of prefs) {
    let s = Math.max(ps, earliest);
    let e = Math.min(pe, latest);
    if (s >= LUNCH_START && s < LUNCH_END) s = LUNCH_END;
    if (e > LUNCH_START && e <= LUNCH_END) e = LUNCH_START;
    if (e - s >= 60) return [s, Math.min(s + 90, e)];
  }
  let s = Math.max(earliest, 10 * 60);
  if (s >= LUNCH_START && s < LUNCH_END) s = LUNCH_END;
  const e = Math.min(s + 90, latest);
  if (e - s >= 60) return [s, e];
  return null;
}

// V3: best cold-call window with reason.
export function callWindow(hours: OpeningHour[] | null | undefined, now: Date = new Date()): { window: string; reason: string } {
  const norm = normalizeHours(hours);
  const reason = "Owner is likely available — past the morning rush, before lunch or end-of-day wind-down.";
  if (Object.keys(norm).length === 0) return { window: "Best window unavailable", reason: "" };
  for (let i = 0; i < 7; i++) {
    const d = (now.getDay() + i) % 7;
    const range = norm[DAYS[d]];
    if (!range || range === "closed") continue;
    let open = 8 * 60;
    let close = 17 * 60;
    if (range !== "24h") { open = range.open; close = range.close; }
    const slot = pickCallSlot(open, close);
    if (!slot) continue;
    if (i === 0) {
      const mins = now.getHours() * 60 + now.getMinutes();
      if (mins > slot[0]) continue;
    }
    return { window: `${DAYS[d]} ${fmt(slot[0])} - ${fmt(slot[1])}`, reason };
  }
  return { window: "Best window unavailable", reason: "" };
}
