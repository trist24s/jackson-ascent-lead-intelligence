"use client";

import { useEffect, useMemo, useState } from "react";
import { leadScore, scoreColor, recommendService, contactPriority } from "@/lib/scoring";
import { openStatus, bestTimeToCall, formatHours, type OpeningHour } from "@/lib/hours";

const STAGES = [
  "New Lead", "Researched", "Qualified", "Contacted", "Follow Up",
  "Interested", "Discovery Call", "Proposal Sent", "Won", "Lost",
];
function stageIndex(s: string | null): number {
  const i = STAGES.indexOf(s || "New Lead");
  return i < 0 ? 0 : i;
}

type Prospect = {
  id: string;
  name: string;
  industry: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rating: number | null;
  review_count: number | null;
  has_website: boolean | null;
  description: string | null;
  category: string | null;
  business_hours: OpeningHour[] | null;
  pipeline_stage: string | null;
  qualified: boolean | null;
};

type Note = { id: string; prospect_id: string; body: string; created_at: string };

const SCORE_CLASS: Record<string, string> = {
  green: "bg-green-100 text-green-800",
  yellow: "bg-yellow-100 text-yellow-800",
  red: "bg-red-100 text-red-700",
};
const STATUS_LABEL: Record<string, string> = {
  open: "🟢 Open Now",
  closed: "🔴 Closed",
  closing_soon: "🟡 Closing Soon",
  unknown: "—",
};

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
    } catch (e) {
      console.error("[prospects] load failed", e);
    }
  }

  useEffect(() => { loadProspects(); }, []);

  // Derived intelligence for every prospect (computed, not stored).
  const derived = useMemo(() => {
    const now = new Date();
    return prospects.map((p) => {
      const input = { ...p, industry: p.industry || "roofing" };
      const ls = leadScore(input);
      const pr = contactPriority(input);
      const svc = recommendService(input);
      return {
        p,
        score: ls.score,
        reasons: ls.reasons,
        color: scoreColor(ls.score),
        priority: pr,
        service: svc,
        status: openStatus(p.business_hours, now),
        best: bestTimeToCall(p.business_hours, now),
      };
    });
  }, [prospects]);

  const metrics = useMemo(() => {
    const total = derived.length;
    const high = derived.filter((d) => d.priority.level === "immediate" || d.priority.level === "high").length;
    const contacted = derived.filter((d) => stageIndex(d.p.pipeline_stage) >= stageIndex("Contacted")).length;
    const discovery = derived.filter((d) => stageIndex(d.p.pipeline_stage) >= stageIndex("Discovery Call")).length;
    const won = derived.filter((d) => d.p.pipeline_stage === "Won").length;
    const conversion = total ? `${((won / total) * 100).toFixed(1)}%` : "0%";
    return { total, high, contacted, discovery, won, conversion };
  }, [derived]);

  async function runScrape(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus("Starting scrape…");
    try {
      const startRes = await fetch("/api/scrape/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, niche: industry, city, max_results: maxResults }),
      });
      const run = await startRes.json();
      if (!startRes.ok) { setStatus(`Error: ${run.error || "failed to start"}`); setBusy(false); return; }
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 3000));
        const checkRes = await fetch("/api/scrape/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scrape_run_id: run.id }),
        });
        const data = await checkRes.json();
        if (data.status === "running") { setStatus("Scraping… this usually takes 30–90 seconds."); continue; }
        if (data.status === "complete") setStatus(`Done — ${data.inserted} new, ${data.updated} updated, ${data.skipped} skipped.`);
        else setStatus(`Scrape ${data.status || "error"}: ${data.error_message || data.error || ""}`);
        done = true;
      }
      await loadProspects();
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateStage(id: string, stage: string) {
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, pipeline_stage: stage } : p)));
    if (selected?.id === id) setSelected({ ...selected, pipeline_stage: stage });
    try {
      await fetch(`/api/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_stage: stage }),
      });
    } catch (e) { console.error("stage update failed", e); }
  }

  async function openDetail(p: Prospect) {
    setSelected(p);
    setNotes([]);
    setNoteText("");
    try {
      const res = await fetch(`/api/notes?prospect_id=${p.id}`, { cache: "no-store" });
      if (res.ok) setNotes(await res.json());
    } catch (e) { console.error("notes load failed", e); }
  }

  async function addNote() {
    if (!selected || !noteText.trim()) return;
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect_id: selected.id, body: noteText.trim() }),
      });
      if (res.ok) {
        const n = await res.json();
        setNotes((prev) => [n, ...prev]);
        setNoteText("");
      }
    } catch (e) { console.error("add note failed", e); }
  }

  async function exportCsv() {
    if (!derived.length) return;
    let notesByProspect: Record<string, string> = {};
    try {
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (res.ok) {
        const all: Note[] = await res.json();
        for (const n of all) {
          notesByProspect[n.prospect_id] = notesByProspect[n.prospect_id]
            ? `${notesByProspect[n.prospect_id]} || ${n.body}`
            : n.body;
        }
      }
    } catch (e) { /* notes are best-effort in export */ }

    const headers = [
      "name", "phone", "email", "website", "address", "city", "state", "zip",
      "rating", "review_count", "lead_score", "priority", "recommended_service",
      "best_time_to_call", "pipeline_stage", "notes",
    ];
    const rows = derived.map((d) => {
      const vals = [
        d.p.name, d.p.phone, d.p.email, d.p.website, d.p.address, d.p.city, d.p.state, d.p.zip,
        d.p.rating, d.p.review_count, d.score, d.priority.label, d.service.service,
        d.best, d.p.pipeline_stage || "New Lead", notesByProspect[d.p.id] || "",
      ];
      return vals.map((v) => JSON.stringify(v ?? "")).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jackson-ascent-leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const selDerived = selected ? derived.find((d) => d.p.id === selected.id) : null;

  return (
    <main className="min-h-screen max-w-7xl mx-auto p-6">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold text-blue-700">Jackson Ascent Lead Intelligence</h1>
        <p className="text-sm text-gray-500">Lead qualification &amp; appointment-setting for home-service businesses. Default industry: roofing.</p>
      </header>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {[
          { label: "Total Leads", value: metrics.total },
          { label: "High Priority", value: metrics.high },
          { label: "Contacted", value: metrics.contacted },
          { label: "Discovery Calls", value: metrics.discovery },
          { label: "Deals Won", value: metrics.won },
          { label: "Conversion Rate", value: metrics.conversion },
        ].map((c) => (
          <div key={c.label} className="border rounded-lg p-3 bg-white">
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className="text-2xl font-bold text-gray-900">{c.value}</div>
          </div>
        ))}
      </div>

      <form onSubmit={runScrape} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <input className="border rounded px-3 py-2" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (e.g. roofing)" />
        <input className="border rounded px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (e.g. Harrisburg, PA)" required />
        <input className="border rounded px-3 py-2" type="number" min={1} max={500} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} placeholder="Max results" />
        <button disabled={busy} className="bg-blue-700 text-white rounded px-4 py-2 disabled:opacity-50">{busy ? "Working…" : "Scrape leads"}</button>
      </form>
      {status && <p className="mb-4 text-sm text-gray-700">{status}</p>}

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Prospects ({derived.length})</h2>
        <div className="flex gap-2">
          <button onClick={loadProspects} className="text-sm border rounded px-3 py-1">Refresh</button>
          <button onClick={exportCsv} className="text-sm border rounded px-3 py-1">Export CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Recommended</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Stage</th>
            </tr>
          </thead>
          <tbody>
            {derived.map((d) => (
              <tr key={d.p.id} className="border-t hover:bg-blue-50">
                <td className="px-3 py-2">
                  <button onClick={() => openDetail(d.p)} className="text-left">
                    <span className="font-medium text-blue-700 underline">{d.p.name}</span>
                    <span className="block text-xs text-gray-400">{d.p.city}{d.p.state ? `, ${d.p.state}` : ""}</span>
                  </button>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 font-semibold ${SCORE_CLASS[d.color]}`}>{d.score}/100</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{d.priority.emoji} {d.priority.label}</td>
                <td className="px-3 py-2">{d.service.service}</td>
                <td className="px-3 py-2 whitespace-nowrap">{STATUS_LABEL[d.status]}</td>
                <td className="px-3 py-2">
                  <select
                    value={d.p.pipeline_stage || "New Lead"}
                    onChange={(e) => updateStage(d.p.id, e.target.value)}
                    className="border rounded px-2 py-1 text-xs"
                  >
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {!derived.length && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No prospects yet. Run a scrape to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Lead detail panel */}
      {selected && selDerived && (
        <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md bg-white h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-gray-900">{selected.name}</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 text-xl leading-none">&times;</button>
            </div>

            <div className="mb-4 flex items-center gap-2">
              <span className={`inline-block rounded px-2 py-0.5 font-semibold ${SCORE_CLASS[selDerived.color]}`}>Lead Score: {selDerived.score}/100</span>
              <span className="text-sm">{selDerived.priority.emoji} {selDerived.priority.label}</span>
            </div>

            <div className="text-sm space-y-1 mb-4">
              <div><span className="text-gray-500">Phone:</span> {selected.phone || "—"}</div>
              <div><span className="text-gray-500">Website:</span> {selected.website ? <a className="text-blue-600 underline" href={selected.website} target="_blank" rel="noreferrer">{selected.website}</a> : "none"}</div>
              <div><span className="text-gray-500">Address:</span> {selected.address || "—"}</div>
              <div><span className="text-gray-500">City/State:</span> {selected.city || "—"}{selected.state ? `, ${selected.state}` : ""} {selected.zip || ""}</div>
              <div><span className="text-gray-500">Google Rating:</span> {selected.rating ?? "—"} ({selected.review_count ?? 0} reviews)</div>
              <div><span className="text-gray-500">Category:</span> {selected.category || "—"}</div>
            </div>

            <div className="border rounded p-3 mb-4 bg-gray-50">
              <div className="font-semibold text-sm mb-1">Call Intelligence</div>
              <div className="text-sm">Status: {STATUS_LABEL[selDerived.status]}</div>
              <div className="text-sm">Best Time To Call: <span className="font-medium">{selDerived.best}</span></div>
              <div className="text-xs text-gray-500 mt-1">Business Hours: {formatHours(selected.business_hours)}</div>
            </div>

            <div className="border rounded p-3 mb-4">
              <div className="font-semibold text-sm">Recommended Service: {selDerived.service.service}</div>
              <div className="text-xs text-gray-600">Reason: {selDerived.service.reason}</div>
            </div>

            <div className="mb-4">
              <label className="text-sm text-gray-500">Pipeline Stage</label>
              <select
                value={selected.pipeline_stage || "New Lead"}
                onChange={(e) => updateStage(selected.id, e.target.value)}
                className="w-full border rounded px-2 py-1 mt-1"
              >
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <div className="font-semibold text-sm mb-2">Notes</div>
              <div className="flex gap-2 mb-2">
                <input
                  className="border rounded px-2 py-1 text-sm flex-1"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note (e.g. Called 6/18/26)"
                  onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                />
                <button onClick={addNote} className="bg-blue-700 text-white rounded px-3 py-1 text-sm">Add</button>
              </div>
              <ul className="space-y-1">
                {notes.map((n) => (
                  <li key={n.id} className="text-sm border-l-2 border-blue-200 pl-2">
                    {n.body}
                    <span className="block text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</span>
                  </li>
                ))}
                {!notes.length && <li className="text-xs text-gray-400">No notes yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
