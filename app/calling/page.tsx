"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { leadScore, contactPriority, recommendService } from "@/lib/scoring";
import { callWindow, hoursIntel, type OpeningHour } from "@/lib/hours";
import { roofingConfidence } from "@/lib/qualify";

const PRANK: Record<string, number> = { immediate: 0, high: 1, medium: 2, low: 3 };
const STATUS_LABEL: Record<string, string> = { open: "🟢 Open Now", closed: "🔴 Closed", closing_soon: "🟡 Closing Soon", unknown: "—" };

type Prospect = {
  id: string; name: string; industry: string | null; phone: string | null; email: string | null;
  website: string | null; city: string | null; state: string | null; rating: number | null;
  review_count: number | null; has_website: boolean | null; description: string | null;
  category: string | null; business_hours: OpeningHour[] | null; pipeline_stage: string | null;
  roofing_confidence: number | null;
};
type Note = { id: string; prospect_id: string; body: string; created_at: string };

export default function Calling() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [idx, setIdx] = useState(0);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteText, setNoteText] = useState("");
  const [working, setWorking] = useState(false);

  async function loadProspects() {
    try { const res = await fetch("/api/prospects", { cache: "no-store" }); const body = await res.json(); setProspects(Array.isArray(body) ? body : []); }
    catch (e) { console.error(e); }
  }
  useEffect(() => { loadProspects(); }, []);

  // Queue: qualified roofing leads not yet closed, ordered by priority then score.
  const queue = useMemo(() => {
    return prospects
      .map((p) => {
        const input = { ...p, industry: p.industry || "roofing" };
        const conf = p.roofing_confidence ?? roofingConfidence({ category: p.category, name: p.name, industry: input.industry });
        return { p, conf, score: leadScore(input).score, priority: contactPriority(input), service: recommendService(input) };
      })
      .filter((d) => d.conf > 70 && d.p.pipeline_stage !== "Won" && d.p.pipeline_stage !== "Lost")
      .sort((a, b) => (PRANK[a.priority.level] - PRANK[b.priority.level]) || (b.score - a.score));
  }, [prospects]);

  const current = queue[idx];

  useEffect(() => {
    if (!current) { setNotes([]); return; }
    (async () => {
      try { const res = await fetch(`/api/notes?prospect_id=${current.p.id}`, { cache: "no-store" }); if (res.ok) setNotes(await res.json()); } catch (e) { /* */ }
    })();
    setNoteText("");
  }, [current?.p.id]);

  async function logNote(prospectId: string, body: string) {
    try { await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: prospectId, body }) }); } catch (e) { /* */ }
  }

  async function act(stage: string, note?: string) {
    if (!current) return;
    setWorking(true);
    const id = current.p.id;
    try {
      await fetch(`/api/prospects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pipeline_stage: stage }) });
      if (note) await logNote(id, note);
      // reflect locally so the queue drops Won/Lost and stage updates
      setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, pipeline_stage: stage } : p)));
      setIdx((i) => i + 1);
    } catch (e) { console.error("action failed", e); }
    finally { setWorking(false); }
  }

  async function addNote() {
    if (!current || !noteText.trim()) return;
    await logNote(current.p.id, noteText.trim());
    setNotes((prev) => [{ id: Math.random().toString(), prospect_id: current.p.id, body: noteText.trim(), created_at: new Date().toISOString() }, ...prev]);
    setNoteText("");
  }

  const now = new Date();
  const cw = current ? callWindow(current.p.business_hours, now) : null;
  const hi = current ? hoursIntel(current.p.business_hours, now) : null;

  return (
    <main className="min-h-screen max-w-2xl mx-auto p-6">
      <header className="mb-6 border-b pb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-blue-700">Appointment Setter Mode</h1>
        <Link href="/" className="text-sm text-blue-700 underline">← Dashboard</Link>
      </header>

      {!current && (
        <div className="text-center text-gray-500 py-20">
          {queue.length === 0 && prospects.length > 0 ? "🎉 Call list complete — every qualified lead has been worked." : "No qualified leads in the queue yet. Run a scrape from the dashboard."}
        </div>
      )}

      {current && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Lead {idx + 1} of {queue.length} · {current.priority.emoji} {current.priority.label}</div>
          <div className="border rounded-lg p-5 mb-4">
            <h2 className="text-2xl font-bold text-gray-900">{current.p.name}</h2>
            <div className="text-sm text-gray-500 mb-3">{current.p.city}{current.p.state ? `, ${current.p.state}` : ""} · {current.p.rating ?? "—"}★ ({current.p.review_count ?? 0}) · {hi ? STATUS_LABEL[hi.status] : ""}</div>
            <a href={current.p.phone ? `tel:${current.p.phone}` : undefined} className="text-3xl font-bold text-blue-700 block mb-3">{current.p.phone || "No phone on file"}</a>
            <div className="text-sm mb-1"><span className="text-gray-500">Best Call Window:</span> <span className="font-medium">{cw?.window}</span></div>
            <div className="bg-blue-50 rounded p-3 mt-3 text-sm">
              <div className="font-semibold">Suggested Offer</div>
              <div>Free roof inspection, then position <span className="font-medium">{current.service.service}</span>.</div>
              <div className="text-xs text-gray-600 mt-1">{current.service.reason}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            <button disabled={working} onClick={() => act("Contacted")} className="bg-gray-800 text-white rounded px-3 py-2 text-sm disabled:opacity-50">Contacted</button>
            <button disabled={working} onClick={() => act("Contacted", "Left voicemail")} className="bg-gray-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50">Voicemail</button>
            <button disabled={working} onClick={() => act("Lost", "Not interested")} className="bg-red-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50">Not Interested</button>
            <button disabled={working} onClick={() => act("Follow Up")} className="bg-yellow-500 text-white rounded px-3 py-2 text-sm disabled:opacity-50">Follow Up</button>
            <button disabled={working} onClick={() => act("Discovery Call", "Booked discovery call")} className="bg-green-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50">Booked Call</button>
          </div>
          <button onClick={() => setIdx((i) => i + 1)} className="text-sm text-gray-500 underline mb-6">Skip for now →</button>

          <div>
            <div className="font-semibold text-sm mb-2">Notes</div>
            <div className="flex gap-2 mb-2"><input className="border rounded px-2 py-1 text-sm flex-1" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note" onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} /><button onClick={addNote} className="bg-blue-700 text-white rounded px-3 py-1 text-sm">Add</button></div>
            <ul className="space-y-1">{notes.map((n) => <li key={n.id} className="text-sm border-l-2 border-blue-200 pl-2">{n.body}<span className="block text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</span></li>)}{!notes.length && <li className="text-xs text-gray-400">No notes yet.</li>}</ul>
          </div>
        </div>
      )}
    </main>
  );
}
