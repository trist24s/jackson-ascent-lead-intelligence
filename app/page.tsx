"use client";

import { useEffect, useState } from "react";

type Prospect = {
  id: string;
  name: string;
  industry: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rating: number | null;
  review_count: number | null;
  has_website: boolean | null;
};

export default function Home() {
  const [industry, setIndustry] = useState("roofing");
  const [city, setCity] = useState("");
  const [maxResults, setMaxResults] = useState(20);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [prospects, setProspects] = useState<Prospect[]>([]);

  async function loadProspects() {
    const res = await fetch("/api/prospects");
    if (res.ok) setProspects(await res.json());
  }

  useEffect(() => {
    loadProspects();
  }, []);

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
      if (!startRes.ok) {
        setStatus(`Error: ${run.error || "failed to start"}`);
        setBusy(false);
        return;
      }

      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 3000));
        const checkRes = await fetch("/api/scrape/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scrape_run_id: run.id }),
        });
        const data = await checkRes.json();
        if (data.status === "running") {
          setStatus("Scraping… this usually takes 30–90 seconds.");
          continue;
        }
        if (data.status === "complete") {
          setStatus(`Done — ${data.inserted} new, ${data.updated} updated, ${data.skipped} skipped.`);
        } else {
          setStatus(`Scrape ${data.status}: ${data.error_message || ""}`);
        }
        done = true;
      }
      await loadProspects();
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!prospects.length) return;
    const cols = ["name", "industry", "phone", "email", "website", "city", "state", "zip", "rating", "review_count", "has_website"];
    const rows = prospects.map((p) => cols.map((c) => JSON.stringify((p as any)[c] ?? "")).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prospects.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-6">
      <header className="mb-8 border-b pb-4">
        <h1 className="text-2xl font-bold text-blue-700">Jackson Ascent Lead Intelligence</h1>
        <p className="text-sm text-gray-500">Find and qualify home-service businesses. Default industry: roofing.</p>
      </header>

      <form onSubmit={runScrape} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <input className="border rounded px-3 py-2" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (e.g. roofing)" />
        <input className="border rounded px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (e.g. Dallas, TX)" required />
        <input className="border rounded px-3 py-2" type="number" min={1} max={500} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} placeholder="Max results" />
        <button disabled={busy} className="bg-blue-700 text-white rounded px-4 py-2 disabled:opacity-50">{busy ? "Working…" : "Scrape leads"}</button>
      </form>

      {status && <p className="mb-4 text-sm text-gray-700">{status}</p>}

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Prospects ({prospects.length})</h2>
        <div className="flex gap-2">
          <button onClick={loadProspects} className="text-sm border rounded px-3 py-1">Refresh</button>
          <button onClick={exportCsv} className="text-sm border rounded px-3 py-1">Export CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Website</th>
              <th className="px-3 py-2">City</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Rating</th>
              <th className="px-3 py-2">Reviews</th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2">{p.phone}</td>
                <td className="px-3 py-2">
                  {p.website ? (
                    <a className="text-blue-600 underline" href={p.website} target="_blank" rel="noreferrer">site</a>
                  ) : (
                    <span className="text-red-500">none</span>
                  )}
                </td>
                <td className="px-3 py-2">{p.city}</td>
                <td className="px-3 py-2">{p.state}</td>
                <td className="px-3 py-2">{p.rating ?? ""}</td>
                <td className="px-3 py-2">{p.review_count ?? ""}</td>
              </tr>
            ))}
            {!prospects.length && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">No prospects yet. Run a scrape to get started.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
