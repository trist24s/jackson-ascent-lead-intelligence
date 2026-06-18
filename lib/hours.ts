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

export function openStatus(
  hours: OpeningHour[] | null | undefined,
  now: Date = new Date()
): "open" | "closed" | "closing_soon" | "unknown" {
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

export function bestTimeToCall(
  hours: OpeningHour[] | null | undefined,
  now: Date = new Date()
): string {
  const norm = normalizeHours(hours);
  if (Object.keys(norm).length === 0) return "Best time unavailable";
  for (let i = 0; i < 7; i++) {
    const d = (now.getDay() + i) % 7;
    const range = norm[DAYS[d]];
    if (!range || range === "closed") continue;
    let open = 8 * 60;
    let close = 17 * 60;
    if (range !== "24h") { open = range.open; close = range.close; }
    let start = Math.max(open + 60, 10 * 60); // mid-morning, after they settle in
    if (start + 90 > close) start = Math.max(open, close - 120);
    const end = Math.min(start + 90, close);
    if (i === 0) {
      const mins = now.getHours() * 60 + now.getMinutes();
      if (mins > start) continue; // ideal window already passed today
    }
    return `${DAYS[d]} ${fmt(start)} - ${fmt(end)}`;
  }
  return "Best time unavailable";
}
