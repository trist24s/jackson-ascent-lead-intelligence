"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { leadScore, scoreColor, recommendService, contactPriority, decisionMakerProbability, opportunityValue } from "@/lib/scoring";
import { callWindow, hoursIntel, formatHours, type OpeningHour } from "@/lib/hours";
import { roofingConfidence, confidenceLabel } from "@/lib/qualify";

const STAGES = ["New Lead", "Researched", "Qualified", "Contacted", "Follow Up", "Interested", "Discovery Call", "Proposal Sent", "Won", "Lost"];
function stageIndex(s: string | null): number { const i = STAGES.indexOf(s || "New Lead"); return i < 0 ? 0 : i; }
const PRANK: Record<string, number> = { immediate: 0, high: 1, medium: 2, low: 3 };

type Prospect = {
  id: string; name: string; industry: string | null; phone: string | null; email: string | null;
  website: string | null; address: string | null; city: string | null; state: string | null; zip: string | null;
  rating: number | null; review_count: number | null; has_website: boolean | null;
  description: string | null; category: string | null; business_hours: OpeningHour[] | null;
  pipeline_stage: string | null; qualified: boolean | null;
  roofing_confidence: number | null; owner_name: string | null;
  linkedin_url: string | null; facebook_url: string | null; google_profile_url: string | null;
};
type Note = { id: string; prospect_id: string; body: string; created_at: string };

const SCORE_CLASS: Record<string, string> = { green: "bg-green-100 text-green-800", yellow: "bg-yellow-100 text-yellow-800", red: "bg-red-100 text-red-700" };
const STATUS_LABEL: Record<string, string> = { open: "🟢 Open Now", closed: "🔴 Closed", closing_soon: "🟡 Closing Soon", unknown: "—" };

export default function Home() {
  const [industry, setIndustry] = useState("roofing");
  const [city, setCity] = useState("");
  const [maxResults, setMaxResults] = useState(20);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteText, setNoteText] = useState("");

  async function loadProspects() {
    try {
      const res = await fetch("/api/prospects", { cache: "no-store" });
      const body = await res.json();
      setProspects(Array.isArray(body) ? body : []);
    } catch (e) { console.error("[prospects] load failed", e); }
  }
  useEffect(() => { loadProspects(); }, []);

  const derived = useMemo(() => {
    const now = new Date();
    return prospects.map((p) => {
      const input = { ...p, industry: p.industry || "roofing" };
      const ls = leadScore(input);
      const conf = p.roofing_confidence ?? roofingConfidence({ category: p.category, name: p.name, industry: input.industry });
      return {
        p, score: ls.score, color: scoreColor(ls.score), priority: contactPriority(input),
        service: recommendService(input), confidence: conf, dm: decisionMakerProbability(input),
        opp: opportunityValue(input), cw: callWindow(p.business_hours, now), hi: hoursIntel(p.business_hours, now),
      };
    });
  }, [prospects]);

  // FEATURE 1: only show confidently-roofing businesses.
  const qualified = useMemo(() => derived.filter((d) => d.confidence > 70), [derived]);

  const metrics = useMemo(() => {
    const total = qualified.length;
    const high = qualified.filter((d) => d.priority.level === "immediate" || d.priority.level === "high").length;
    const contacted = qualified.filter((d) => stageIndex(d.p.pipeline_stage) >= stageIndex("Contacted")).length;
    const discovery = qualified.filter((d) => stageIndex(d.p.pipeline_stage) >= stageIndex("Discovery Call")).length;
    const won = qualified.filter((d) => d.p.pipeline_stage === "Won").length;
    const conversion = total ? `${((won / total) * 100).toFixed(1)}%` : "0%";
    return { total, high, contacted, discovery, won, conversion };
  }, [qualified]);

  // FEATURE 7: Today's Call List — top 10 by priority then score.
  const queue = useMemo(() => {
    return [...qualified].sort((a, b) => (PRANK[a.priority.level] - PRANK[b.priority.level]) || (b.score - a.score)).slice(0, 10);
  }, [qualified]);

  async function runScrape(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setStatus("Starting scrape…");
    try {
      const startRes = await fetch("/api/scrape/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ industry, niche: industry, city, max_results: maxResults }) });
      const run = await startRes.json();
      if (!startRes.ok) { setStatus(`Error: ${run.error || "failed to start"}`); setBusy(false); return; }
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 3000));
        const checkRes = await fetch("/api/scrape/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scrape_run_id: run.id }) });
        const data = await checkRes.json();
        if (data.status === "running") { setStatus("Scraping… this usually takes 30–90 seconds."); continue; }
        if (data.status === "complete") setStatus(`Done — ${data.inserted} new, ${data.updated} updated, ${data.skipped} skipped (non-roofing skipped).`);
        else setStatus(`Scrape ${data.status || "error"}: ${data.error_message || data.error || ""}`);
        done = true;
      }
      await loadProspects();
    } catch (err: any) { setStatus(`Error: ${err.message}`); } finally { setBusy(false); }
  }

  async function updateStage(id: string, stage: string) {
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, pipeline_stage: stage } : p)));
    if (selected?.id === id) setSelected({ ...selected, pipeline_stage: stage });
    try { await fetch(`/api/prospects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pipeline_stage: stage }) }); }
    catch (e) { console.error("stage update failed", e); }
  }

  async function openDetail(p: Prospect) {
    setSelected(p); setNotes([]); setNoteText("");
    try { const res = await fetch(`/api/notes?prospect_id=${p.id}`, { cache: "no-store" }); if (res.ok) setNotes(await res.json()); }
    catch (e) { console.error("notes load failed", e); }
  }
  async function addNote() {
    if (!selected || !noteText.trim()) return;
    try {
      const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: selected.id, body: noteText.trim() }) });
      if (res.ok) { const n = await res.json(); setNotes((prev) => [n, ...prev]); setNoteText(""); }
    } catch (e) { console.error("add note failed", e); }
  }

  function download(name: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }

  async function exportCsv() {
    if (!qualified.length) return;
    let byProspect: Record<string, string> = {};
    try {
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (res.ok) { const all: Note[] = await res.json(); for (const n of all) byProspect[n.prospect_id] = byProspect[n.prospect_id] ? `${byProspect[n.prospect_id]} || ${n.body}` : n.body; }
    } catch (e) { /* best effort */ }
    const headers = ["name", "phone", "email", "website", "address", "city", "state", "zip", "rating", "review_count", "roofing_confidence", "lead_score", "priority", "recommended_service", "opportunity", "best_call_window", "pipeline_stage", "notes"];
    const rows = qualified.map((d) => [d.p.name, d.p.phone, d.p.email, d.p.website, d.p.address, d.p.city, d.p.state, d.p.zip, d.p.rating, d.p.review_count, d.confidence, d.score, d.priority.label, d.service.service, d.opp.display, d.cw.window, d.p.pipeline_stage || "New Lead", byProspect[d.p.id] || ""].map((v) => JSON.stringify(v ?? "")).join(","));
    download("jackson-ascent-leads.csv", [headers.join(","), ...rows].join("\n"));
  }

  // FEATURE 8: Call Sheet CSV.
  function exportCallSheet() {
    if (!queue.length && !qualified.length) return;
    const list = qualified.length ? [...qualified].sort((a, b) => (PRANK[a.priority.level] - PRANK[b.priority.level]) || (b.score - a.score)) : [];
    const headers = ["Business Name", "Phone", "Best Call Time", "Priority", "Lead Score", "Recommended Service"];
    const rows = list.map((d) => [d.p.name, d.p.phone, d.cw.window, d.priority.label, d.score, d.service.service].map((v) => JSON.stringify(v ?? "")).join(","));
    download("call-sheet.csv", [headers.join(","), ...rows].join("\n"));
  }

  const sd = selected ? derived.find((d) => d.p.id === selected.id) : null;

  return (
    <main className="min-h-screen max-w-7xl mx-auto p-6">
      <header className="mb-6 border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-blue-700">Jackson Ascent Lead Intelligence</h1>
          <p className="text-sm text-gray-500">Qualified roofing leads &amp; appointment setting.</p>
        </div>
        <Link href="/calling" className="bg-blue-700 text-white rounded px-4 py-2 text-sm">☎️ Appointment Setter Mode</Link>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {[{ label: "Total Leads", value: metrics.total }, { label: "High Priority", value: metrics.high }, { label: "Contacted", value: metrics.contacted }, { label: "Discovery Calls", value: metrics.discovery }, { label: "Deals Won", value: metrics.won }, { label: "Conversion Rate", value: metrics.conversion }].map((c) => (
          <div key={c.label} className="border rounded-lg p-3 bg-white"><div className="text-xs text-gray-500">{c.label}</div><div className="text-2xl font-bold text-gray-900">{c.value}</div></div>
        ))}
      </div>

      <form onSubmit={runScrape} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <input className="border rounded px-3 py-2" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (e.g. roofing)" />
        <input className="border rounded px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (e.g. Harrisburg, PA)" required />
        <input className="border rounded px-3 py-2" type="number" min={1} max={500} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} placeholder="Max results" />
        <button disabled={busy} className="bg-blue-700 text-white rounded px-4 py-2 disabled:opacity-50">{busy ? "Working…" : "Scrape leads"}</button>
      </form>
      {status && <p className="mb-4 text-sm text-gray-700">{status}</p>}

      {/* FEATURE 7: Today's Call List */}
      {queue.length > 0 && (
        <div className="mb-6 border rounded-lg p-4 bg-blue-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Today&apos;s Call List (Top {queue.length})</h2>
            <button onClick={exportCallSheet} className="text-sm border rounded px-3 py-1 bg-white">Call Sheet CSV</button>
          </div>
          <ol className="space-y-1 text-sm">
            {queue.map((d, i) => (
              <li key={d.p.id} className="flex items-center justify-between bg-white rounded px-3 py-1.5">
                <span><span className="text-gray-400 mr-2">{i + 1}.</span><button className="text-blue-700 underline" onClick={() => openDetail(d.p)}>{d.p.name}</button></span>
                <span className="text-gray-600 whitespace-nowrap">{d.priority.emoji} {d.priority.label} · {d.cw.window} · {d.p.phone || "no phone"}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Qualified Roofing Leads ({qualified.length})</h2>
        <div className="flex gap-2">
          <button onClick={loadProspects} className="text-sm border rounded px-3 py-1">Refresh</button>
          <button onClick={exportCsv} className="text-sm border rounded px-3 py-1">Export CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left"><tr>
            <th className="px-3 py-2">Business</th><th className="px-3 py-2">Conf</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Recommended</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Stage</th>
          </tr></thead>
          <tbody>
            {qualified.map((d) => (
              <tr key={d.p.id} className="border-t hover:bg-blue-50">
                <td className="px-3 py-2"><button onClick={() => openDetail(d.p)} className="text-left"><span className="font-medium text-blue-700 underline">{d.p.name}</span><span className="block text-xs text-gray-400">{d.p.city}{d.p.state ? `, ${d.p.state}` : ""}</span></button></td>
                <td className="px-3 py-2 text-gray-600">{d.confidence}%</td>
                <td className="px-3 py-2"><span className={`inline-block rounded px-2 py-0.5 font-semibold ${SCORE_CLASS[d.color]}`}>{d.score}/100</span></td>
                <td className="px-3 py-2 whitespace-nowrap">{d.priority.emoji} {d.priority.label}</td>
                <td className="px-3 py-2">{d.service.service}</td>
                <td className="px-3 py-2 whitespace-nowrap">{STATUS_LABEL[d.hi.status]}</td>
                <td className="px-3 py-2"><select value={d.p.pipeline_stage || "New Lead"} onChange={(e) => updateStage(d.p.id, e.target.value)} className="border rounded px-2 py-1 text-xs">{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
              </tr>
            ))}
            {!qualified.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No qualified roofing leads yet. Run a scrape to get started.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && sd && (
        <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md bg-white h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3"><h3 className="text-lg font-bold text-gray-900">{selected.name}</h3><button onClick={() => setSelected(null)} className="text-gray-400 text-xl leading-none">&times;</button></div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`inline-block rounded px-2 py-0.5 font-semibold ${SCORE_CLASS[sd.color]}`}>Lead Score: {sd.score}/100</span>
              <span>{sd.priority.emoji} {sd.priority.label}</span>
              <span className="text-gray-600">Roofing Confidence: {sd.confidence}% ({confidenceLabel(sd.confidence)})</span>
            </div>
            <div className="text-sm space-y-1 mb-4">
              <div><span className="text-gray-500">Phone:</span> {selected.phone ? <a className="text-blue-600" href={`tel:${selected.phone}`}>{selected.phone}</a> : "—"}</div>
              <div><span className="text-gray-500">Website:</span> {selected.website ? <a className="text-blue-600 underline" href={selected.website} target="_blank" rel="noreferrer">{selected.website}</a> : "none"}</div>
              <div><span className="text-gray-500">Address:</span> {selected.address || "—"}</div>
              <div><span className="text-gray-500">Rating:</span> {selected.rating ?? "—"} ({selected.review_count ?? 0} reviews)</div>
            </div>
            <div className="border rounded p-3 mb-3 bg-gray-50 text-sm">
              <div className="font-semibold mb-1">Call Intelligence</div>
              <div>Status: {STATUS_LABEL[sd.hi.status]}{sd.hi.closesAt ? ` · closes ${sd.hi.closesAt}` : ""}</div>
              {!sd.hi.openNow && sd.hi.opensNext && <div>Opens: {sd.hi.opensNext}</div>}
              <div className="mt-1">Best Call Window: <span className="font-medium">{sd.cw.window}</span></div>
              {sd.cw.reason && <div className="text-xs text-gray-500">{sd.cw.reason}</div>}
              <div className="text-xs text-gray-500 mt-1">Hours: {formatHours(selected.business_hours)}</div>
              <div className="mt-1">Decision-Maker Probability: <span className="font-medium">{sd.dm}%</span></div>
            </div>
            <div className="border rounded p-3 mb-3 text-sm">
              <div className="font-semibold">Recommended Service: {sd.service.service}</div>
              <div className="text-xs text-gray-600">{sd.service.reason}</div>
              <div className="mt-1">Potential Opportunity: <span className="font-semibold text-green-700">{sd.opp.display}</span></div>
            </div>
            <div className="border rounded p-3 mb-3 text-sm">
              <div className="font-semibold mb-1">Owner Research</div>
              <div><span className="text-gray-500">Owner:</span> {selected.owner_name || "—"}</div>
              <div><span className="text-gray-500">Google Profile:</span> {selected.google_profile_url ? <a className="text-blue-600 underline" href={selected.google_profile_url} target="_blank" rel="noreferrer">view</a> : "—"}</div>
              <div><span className="text-gray-500">LinkedIn:</span> {selected.linkedin_url ? <a className="text-blue-600 underline" href={selected.linkedin_url} target="_blank" rel="noreferrer">view</a> : "—"}</div>
              <div><span className="text-gray-500">Facebook:</span> {selected.facebook_url ? <a className="text-blue-600 underline" href={selected.facebook_url} target="_blank" rel="noreferrer">view</a> : "—"}</div>
            </div>
            <div className="mb-3"><label className="text-sm text-gray-500">Pipeline Stage</label><select value={selected.pipeline_stage || "New Lead"} onChange={(e) => updateStage(selected.id, e.target.value)} className="w-full border rounded px-2 py-1 mt-1">{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div>
              <div className="font-semibold text-sm mb-2">Notes</div>
              <div className="flex gap-2 mb-2"><input className="border rounded px-2 py-1 text-sm flex-1" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note (e.g. Called 6/18/26)" onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} /><button onClick={addNote} className="bg-blue-700 text-white rounded px-3 py-1 text-sm">Add</button></div>
              <ul className="space-y-1">{notes.map((n) => <li key={n.id} className="text-sm border-l-2 border-blue-200 pl-2">{n.body}<span className="block text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</span></li>)}{!notes.length && <li className="text-xs text-gray-400">No notes yet.</li>}</ul>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
