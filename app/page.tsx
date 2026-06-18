"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { leadScore, scoreColor, contactPriority, decisionMakerProbability } from "@/lib/scoring";
import { callWindow, hoursIntel, formatHours, type OpeningHour } from "@/lib/hours";
import { roofingConfidence, confidenceLabel } from "@/lib/qualify";
import { salesIntel } from "@/lib/sales";

const STAGES = ["New Lead", "Researched", "Qualified", "Contacted", "Follow Up", "Interested", "Discovery Call", "Proposal Sent", "Won", "Lost"];
const ACTIVE = new Set(["Contacted", "Follow Up", "Interested", "Discovery Call", "Proposal Sent"]);
function stageIndex(s: string | null): number { const i = STAGES.indexOf(s || "New Lead"); return i < 0 ? 0 : i; }

type Prospect = {
  id: string; name: string; industry: string | null; phone: string | null; email: string | null;
  website: string | null; address: string | null; city: string | null; state: string | null; zip: string | null;
  rating: number | null; review_count: number | null; has_website: boolean | null;
  description: string | null; category: string | null; business_hours: OpeningHour[] | null;
  pipeline_stage: string | null; qualified: boolean | null;
  roofing_confidence: number | null; owner_name: string | null;
  linkedin_url: string | null; facebook_url: string | null; google_profile_url: string | null;
  scrape_run_id: string | null;
};
type Note = { id: string; prospect_id: string; body: string; created_at: string };
type Debug = { city?: string; returned?: number; qualified?: number; rejected?: number; inserted?: number; updated?: number; errors?: number; error_sample?: string; sample?: any[] };
type LastSearch = { city: string; returned: number; inserted: number; updated: number; rejected: number; runId: string };

const SCORE_CLASS: Record<string, string> = { green: "bg-green-100 text-green-800", yellow: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-700" };
const OPP_CLASS: Record<string, string> = { High: "bg-green-100 text-green-800", Medium: "bg-amber-100 text-amber-800", Low: "bg-gray-100 text-gray-600" };
const OFFER_CLASS: Record<string, string> = { "AI Lead Conversations": "bg-blue-100 text-blue-800", "Complete Growth System": "bg-indigo-100 text-indigo-800" };
const STATUS_LABEL: Record<string, string> = { open: "🟢 Open Now", closed: "🔴 Closed", closing_soon: "🟡 Closing Soon", unknown: "—" };
const PRANK: Record<string, number> = { immediate: 0, high: 1, medium: 2, low: 3 };

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
  const [viewMode, setViewMode] = useState<"current" | "database">("database");
  const [cityFilter, setCityFilter] = useState("All Cities");
  const [lastSearch, setLastSearch] = useState<LastSearch | null>(null);
  const [debug, setDebug] = useState<Debug | null>(null);

  async function loadProspects() {
    try { const res = await fetch("/api/prospects", { cache: "no-store" }); const body = await res.json(); setProspects(Array.isArray(body) ? body : []); }
    catch (e) { console.error("[prospects] load failed", e); }
  }
  useEffect(() => { loadProspects(); }, []);

  const derived = useMemo(() => {
    const now = new Date();
    return prospects.map((p) => {
      const conf = p.roofing_confidence ?? roofingConfidence({ category: p.category, name: p.name, industry: p.industry || "roofing" });
      const input = { ...p, industry: p.industry || "roofing", roofing_confidence: conf };
      const ls = leadScore(input).score;
      return {
        p, confidence: conf, score: ls, color: scoreColor(ls),
        priority: contactPriority(input), dm: decisionMakerProbability(input), intel: salesIntel(input),
        cw: callWindow(p.business_hours, now), hi: hoursIntel(p.business_hours, now),
      };
    });
  }, [prospects]);

  const qualified = useMemo(() => derived.filter((d) => d.confidence > 70), [derived]);
  const cities = useMemo(() => Array.from(new Set(prospects.map((p) => p.city).filter((c): c is string => !!c))).sort(), [prospects]);

  const visible = useMemo(() => {
    if (viewMode === "current") { if (!lastSearch?.runId) return []; return qualified.filter((d) => d.p.scrape_run_id === lastSearch.runId); }
    if (cityFilter !== "All Cities") return qualified.filter((d) => (d.p.city || "") === cityFilter);
    return qualified;
  }, [qualified, viewMode, cityFilter, lastSearch]);

  const metrics = useMemo(() => {
    const total = visible.length;
    const high = visible.filter((d) => d.priority.level === "immediate" || d.priority.level === "high").length;
    const callsMade = visible.filter((d) => stageIndex(d.p.pipeline_stage) >= stageIndex("Contacted")).length;
    const appts = visible.filter((d) => stageIndex(d.p.pipeline_stage) >= stageIndex("Discovery Call")).length;
    const discovery = visible.filter((d) => d.p.pipeline_stage === "Discovery Call").length;
    const won = visible.filter((d) => d.p.pipeline_stage === "Won").length;
    const pipelineValue = visible.filter((d) => ACTIVE.has(d.p.pipeline_stage || "")).reduce((s, d) => s + d.intel.offer.setup + d.intel.offer.monthly * 12, 0);
    const conversion = total ? `${((won / total) * 100).toFixed(1)}%` : "0%";
    return { total, high, callsMade, appts, discovery, won, pipelineValue, conversion };
  }, [visible]);

  const queue = useMemo(() => {
    return [...visible].sort((a, b) => (b.intel.opp.score - a.intel.opp.score) || (b.dm - a.dm) || (b.score - a.score)).slice(0, 10);
  }, [visible]);

  async function runScrape(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setStatus(`Starting scrape for ${city}…`); setDebug(null);
    try {
      const startRes = await fetch("/api/scrape/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ industry, niche: industry, city, max_results: maxResults }) });
      const run = await startRes.json();
      if (!startRes.ok) { setStatus(`Error: ${run.error || "failed to start"}`); setBusy(false); return; }
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 3000));
        const checkRes = await fetch("/api/scrape/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scrape_run_id: run.id }) });
        const data = await checkRes.json();
        if (data.status === "running") { setStatus(`Scraping ${city}… this usually takes 30–90 seconds.`); continue; }
        if (data.status === "complete") {
          setDebug(data);
          setStatus(`Done with ${city} — ${data.returned} returned, ${data.qualified} qualified, ${data.inserted} new, ${data.updated} updated, ${data.errors || 0} DB errors.`);
          setLastSearch({ city, returned: data.returned ?? 0, inserted: data.inserted ?? 0, updated: data.updated ?? 0, rejected: data.rejected ?? 0, runId: run.id });
          setViewMode("current");
        } else setStatus(`Scrape ${data.status || "error"}: ${data.error_message || data.error || ""}`);
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
    try { const res = await fetch(`/api/notes?prospect_id=${p.id}`, { cache: "no-store" }); if (res.ok) setNotes(await res.json()); } catch (e) { console.error(e); }
  }
  async function addNote() {
    if (!selected || !noteText.trim()) return;
    try { const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect_id: selected.id, body: noteText.trim() }) }); if (res.ok) { const n = await res.json(); setNotes((prev) => [n, ...prev]); setNoteText(""); } } catch (e) { console.error(e); }
  }

  function download(name: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  async function exportCsv() {
    if (!visible.length) return;
    let byP: Record<string, string> = {};
    try { const res = await fetch("/api/notes", { cache: "no-store" }); if (res.ok) { const all: Note[] = await res.json(); for (const n of all) byP[n.prospect_id] = byP[n.prospect_id] ? `${byP[n.prospect_id]} || ${n.body}` : n.body; } } catch (e) { /* */ }
    const headers = ["name", "phone", "email", "website", "city", "state", "rating", "review_count", "roofing_confidence", "lead_score", "opportunity_score", "priority", "recommended_offer", "setup_fee", "monthly", "est_monthly_roi", "best_call_window", "pipeline_stage", "notes"];
    const rows = visible.map((d) => [d.p.name, d.p.phone, d.p.email, d.p.website, d.p.city, d.p.state, d.p.rating, d.p.review_count, d.confidence, d.score, d.intel.opp.score, d.priority.label, d.intel.offer.name, d.intel.offer.setup, d.intel.offer.monthly, d.intel.roi.amount, d.cw.window, d.p.pipeline_stage || "New Lead", byP[d.p.id] || ""].map((v) => JSON.stringify(v ?? "")).join(","));
    download("jackson-ascent-leads.csv", [headers.join(","), ...rows].join("\n"));
  }
  function exportCallSheet() {
    if (!visible.length) return;
    const list = [...queue];
    const headers = ["Business Name", "Phone", "Recommended Offer", "Best Call Time", "Priority", "Lead Score", "Opportunity Score"];
    const rows = list.map((d) => [d.p.name, d.p.phone, d.intel.offer.name, d.cw.window, d.priority.label, d.score, d.intel.opp.score].map((v) => JSON.stringify(v ?? "")).join(","));
    download("call-sheet.csv", [headers.join(","), ...rows].join("\n"));
  }

  const sd = selected ? derived.find((d) => d.p.id === selected.id) : null;
  const heading = viewMode === "current" ? (lastSearch ? `Current Search: ${lastSearch.city}` : "Current Search") : (cityFilter === "All Cities" ? "All Saved Leads" : `Leads in ${cityFilter}`);

  const KPIS = [
    { label: "Total Leads", value: metrics.total }, { label: "High Priority", value: metrics.high },
    { label: "Calls Made", value: metrics.callsMade }, { label: "Appointments Booked", value: metrics.appts },
    { label: "Discovery Calls", value: metrics.discovery }, { label: "Deals Won", value: metrics.won },
    { label: "Est. Pipeline Value", value: `$${metrics.pipelineValue.toLocaleString()}` }, { label: "Conversion Rate", value: metrics.conversion },
  ];

  return (
    <main className="min-h-screen bg-gray-50 px-4 sm:px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Jackson Ascent <span className="text-blue-700">Intelligence</span></h1>
            <p className="text-sm text-gray-500">Know who to call, when, what to pitch, and how to close.</p>
          </div>
          <Link href="/calling" className="bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-4 py-2 text-sm font-medium shadow-sm">☎️ Appointment Setter</Link>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {KPIS.map((c) => (
            <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm"><div className="text-xs text-gray-500">{c.label}</div><div className="text-2xl font-bold text-gray-900 mt-1">{c.value}</div></div>
          ))}
        </div>

        <form onSubmit={runScrape} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <input className="border border-gray-300 rounded-lg px-3 py-2" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (e.g. roofing)" />
          <input className="border border-gray-300 rounded-lg px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (e.g. Phoenix, AZ)" required />
          <input className="border border-gray-300 rounded-lg px-3 py-2" type="number" min={1} max={500} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} placeholder="Max results" />
          <button disabled={busy} className="bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-4 py-2 font-medium disabled:opacity-50">{busy ? "Working…" : "Scrape leads"}</button>
        </form>
        {status && <p className="mb-3 text-sm text-gray-700">{status}</p>}

        {debug && (
          <div className="mb-4 border border-amber-200 rounded-xl p-3 bg-amber-50 text-sm">
            <div className="font-semibold mb-1">Pipeline Trace — {debug.city}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Apify Returned: <b>{debug.returned}</b></span><span>Qualified: <b>{debug.qualified}</b></span><span>Rejected: <b>{debug.rejected}</b></span><span>Inserted: <b>{debug.inserted}</b></span><span>Updated: <b>{debug.updated}</b></span><span className={debug.errors ? "text-red-600 font-semibold" : ""}>DB Errors: <b>{debug.errors || 0}</b></span>
            </div>
            {debug.error_sample && <div className="mt-1 text-red-600">First DB error: {debug.error_sample}</div>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => setViewMode("current")} className={`text-sm rounded-lg px-3 py-1.5 border ${viewMode === "current" ? "bg-blue-700 text-white border-blue-700" : "bg-white border-gray-300"}`}>Current Search</button>
          <button onClick={() => setViewMode("database")} className={`text-sm rounded-lg px-3 py-1.5 border ${viewMode === "database" ? "bg-blue-700 text-white border-blue-700" : "bg-white border-gray-300"}`}>Database</button>
          <select value={cityFilter} onChange={(e) => { setCityFilter(e.target.value); setViewMode("database"); }} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white"><option>All Cities</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          {viewMode === "current" && lastSearch && <span className="text-xs text-gray-500">{lastSearch.city}: {lastSearch.returned} returned · {lastSearch.inserted} new · {lastSearch.rejected} skipped</span>}
        </div>

        {queue.length > 0 && (
          <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-gray-900">Today&apos;s Top {queue.length} Calls</h2><button onClick={exportCallSheet} className="text-sm border border-gray-300 rounded-lg px-3 py-1">Call Sheet CSV</button></div>
            <ol className="divide-y divide-gray-100">
              {queue.map((d, i) => (
                <li key={d.p.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2"><span className="text-gray-400 w-5">{i + 1}.</span><button className="text-blue-700 font-medium hover:underline" onClick={() => openDetail(d.p)}>{d.p.name}</button><span className={`text-xs rounded px-1.5 py-0.5 ${OPP_CLASS[d.intel.opp.category]}`}>Opp {d.intel.opp.score}</span></span>
                  <span className="text-gray-600 whitespace-nowrap text-xs sm:text-sm">{d.intel.offer.name} · {d.cw.window} · {d.p.phone || "no phone"}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-gray-900">{heading} ({visible.length})</h2><div className="flex gap-2"><button onClick={loadProspects} className="text-sm border border-gray-300 rounded-lg px-3 py-1">Refresh</button><button onClick={exportCsv} className="text-sm border border-gray-300 rounded-lg px-3 py-1">Export CSV</button></div></div>

        <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr><th className="px-4 py-2.5 font-medium">Business</th><th className="px-4 py-2.5 font-medium">Lead Score</th><th className="px-4 py-2.5 font-medium">Priority</th><th className="px-4 py-2.5 font-medium">Recommended Offer</th><th className="px-4 py-2.5 font-medium">Best Call Window</th><th className="px-4 py-2.5 font-medium">Stage</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((d) => (
                <tr key={d.p.id} className="hover:bg-blue-50/40">
                  <td className="px-4 py-2.5"><button onClick={() => openDetail(d.p)} className="text-left"><span className="font-medium text-blue-700 hover:underline">{d.p.name}</span><span className="block text-xs text-gray-400">{d.p.city}{d.p.state ? `, ${d.p.state}` : ""}</span></button></td>
                  <td className="px-4 py-2.5"><span className={`inline-block rounded-md px-2 py-0.5 font-semibold ${SCORE_CLASS[d.color]}`}>{d.score}</span></td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{d.priority.emoji} {d.priority.label}</td>
                  <td className="px-4 py-2.5"><span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${OFFER_CLASS[d.intel.offer.name]}`}>{d.intel.offer.name}</span></td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{d.cw.window}</td>
                  <td className="px-4 py-2.5"><select value={d.p.pipeline_stage || "New Lead"} onChange={(e) => updateStage(d.p.id, e.target.value)} className="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white">{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                </tr>
              ))}
              {!visible.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{viewMode === "current" && !lastSearch ? "Run a scrape to see current results, or switch to Database." : "No leads in this view."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selected && sd && (
        <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md bg-white h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3"><h3 className="text-lg font-bold text-gray-900">{selected.name}</h3><button onClick={() => setSelected(null)} className="text-gray-400 text-xl leading-none">&times;</button></div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-md px-2 py-0.5 font-semibold ${SCORE_CLASS[sd.color]}`}>Lead {sd.score}</span>
              <span className={`rounded-md px-2 py-0.5 font-semibold ${OPP_CLASS[sd.intel.opp.category]}`}>Opportunity {sd.intel.opp.score} ({sd.intel.opp.category})</span>
              <span className="text-gray-600">Roofing {sd.confidence}%</span>
            </div>

            <div className="text-sm space-y-1 mb-4">
              <div><span className="text-gray-500">Phone:</span> {selected.phone ? <a className="text-blue-600" href={`tel:${selected.phone}`}>{selected.phone}</a> : "—"}</div>
              <div><span className="text-gray-500">Website:</span> {selected.website ? <a className="text-blue-600 underline" href={selected.website} target="_blank" rel="noreferrer">{selected.website}</a> : "none"}</div>
              <div><span className="text-gray-500">Address:</span> {selected.address || "—"}</div>
              <div><span className="text-gray-500">City:</span> {selected.city || "—"}{selected.state ? `, ${selected.state}` : ""}</div>
              <div><span className="text-gray-500">Rating:</span> {selected.rating ?? "—"} ({selected.review_count ?? 0} reviews)</div>
            </div>

            <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 text-sm">
              <div className="font-semibold mb-1">Call Intelligence</div>
              <div>Status: {STATUS_LABEL[sd.hi.status]}{sd.hi.closesAt ? ` · closes ${sd.hi.closesAt}` : ""}{!sd.hi.openNow && sd.hi.opensNext ? ` · opens ${sd.hi.opensNext}` : ""}</div>
              <div className="mt-1">Best Call Window: <span className="font-medium">{sd.cw.window}</span></div>
              {sd.cw.reason && <div className="text-xs text-gray-500">{sd.cw.reason}</div>}
              <div className="text-xs text-gray-500 mt-1">Hours: {formatHours(selected.business_hours)}</div>
              <div className="mt-1">Decision-Maker Probability: <span className="font-medium">{sd.dm}%</span></div>
            </div>

            <div className="border border-blue-200 rounded-lg p-3 mb-3 bg-blue-50 text-sm">
              <div className="font-semibold text-blue-900">Recommended Offer: {sd.intel.offer.name}</div>
              <div className="flex gap-4 mt-1"><span>Setup: <b>${sd.intel.offer.setup.toLocaleString()}</b></span><span>Monthly: <b>${sd.intel.offer.monthly.toLocaleString()}</b></span></div>
              <div className="text-xs text-gray-700 mt-1">Why: {sd.intel.offer.why}</div>
              <div className="mt-1">Estimated ROI: <span className="font-semibold text-green-700">{sd.intel.roi.display}</span></div>
            </div>

            <div className="border border-gray-200 rounded-lg p-3 mb-3 text-sm">
              <div className="font-semibold mb-1">Sales Playbook</div>
              <div><span className="text-gray-500">Angle:</span> {sd.intel.angle}</div>
              <div className="mt-1"><span className="text-gray-500">Likely objection:</span> “{sd.intel.objection}”</div>
              <div className="mt-1"><span className="text-gray-500">Suggested response:</span> {sd.intel.response}</div>
            </div>

            <div className="border border-gray-200 rounded-lg p-3 mb-3 text-sm">
              <div className="font-semibold mb-1">Links</div>
              <div className="flex gap-3">
                {selected.google_profile_url ? <a className="text-blue-600 underline" href={selected.google_profile_url} target="_blank" rel="noreferrer">Google</a> : <span className="text-gray-400">Google</span>}
                {selected.linkedin_url ? <a className="text-blue-600 underline" href={selected.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a> : <span className="text-gray-400">LinkedIn</span>}
                {selected.facebook_url ? <a className="text-blue-600 underline" href={selected.facebook_url} target="_blank" rel="noreferrer">Facebook</a> : <span className="text-gray-400">Facebook</span>}
              </div>
            </div>

            <div className="mb-3"><label className="text-sm text-gray-500">Pipeline Stage</label><select value={selected.pipeline_stage || "New Lead"} onChange={(e) => updateStage(selected.id, e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 mt-1">{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>

            <div>
              <div className="font-semibold text-sm mb-2">Notes</div>
              <div className="flex gap-2 mb-2"><input className="border border-gray-300 rounded-lg px-2 py-1 text-sm flex-1" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note (e.g. Called 6/18/26)" onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} /><button onClick={addNote} className="bg-blue-700 text-white rounded-lg px-3 py-1 text-sm">Add</button></div>
              <ul className="space-y-1">{notes.map((n) => <li key={n.id} className="text-sm border-l-2 border-blue-200 pl-2">{n.body}<span className="block text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</span></li>)}{!notes.length && <li className="text-xs text-gray-400">No notes yet.</li>}</ul>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
