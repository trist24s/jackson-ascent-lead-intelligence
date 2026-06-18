import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getApifyRun, getApifyDataset, mapItem } from "@/lib/apify";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_CONFIDENCE = 70;

type SampleRow = {
  name: string; category: string | null; city: string | null; state: string | null;
  website: boolean; phone: string | null; confidence: number | null; action: string; reason: string;
};

export async function POST(req: Request) {
  try {
    const { scrape_run_id } = await req.json();
    if (!scrape_run_id) return NextResponse.json({ error: "scrape_run_id required" }, { status: 400 });

    const supabase = getServiceClient();
    const { data: run } = await supabase.from("scrape_runs").select("*").eq("id", scrape_run_id).single();
    if (!run) return NextResponse.json({ error: "ScrapeRun not found" }, { status: 404 });

    if (run.status === "complete" || run.status === "failed") {
      return NextResponse.json({ status: run.status, city: run.city, inserted: run.inserted, updated: run.updated, skipped: run.skipped, error_message: run.error_message });
    }
    if (!run.run_id || run.run_id === "pending") return NextResponse.json({ status: "running" });

    const runRes = await getApifyRun(run.run_id);
    if (!runRes.ok) {
      const b = await runRes.text();
      console.error("[scrape/check] getApifyRun not ok", JSON.stringify({ status: runRes.status, body: b.slice(0, 200) }));
      return NextResponse.json({ status: "running" });
    }
    const runData = await runRes.json();
    const apifyStatus = runData?.data?.status;
    console.log("[scrape/check] Apify run status:", apifyStatus, "run:", run.run_id, "city:", run.city);

    if (!apifyStatus || apifyStatus === "RUNNING" || apifyStatus === "READY") return NextResponse.json({ status: "running" });

    if (apifyStatus !== "SUCCEEDED") {
      const msg = `Apify run status: ${apifyStatus}`;
      await supabase.from("scrape_runs").update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() }).eq("id", run.id);
      return NextResponse.json({ status: "failed", error_message: msg });
    }

    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) {
      const msg = "Apify run succeeded but returned no defaultDatasetId";
      await supabase.from("scrape_runs").update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() }).eq("id", run.id);
      return NextResponse.json({ status: "failed", error_message: msg });
    }

    const dsRes = await getApifyDataset(datasetId);
    if (!dsRes.ok) {
      const b = await dsRes.text();
      const msg = `Dataset fetch failed (${dsRes.status}): ${b.slice(0, 200)}`;
      await supabase.from("scrape_runs").update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() }).eq("id", run.id);
      return NextResponse.json({ status: "failed", error_message: msg });
    }

    const items = await dsRes.json();
    const capped = (Array.isArray(items) ? items : []).slice(0, run.max_results || 50);
    const returned = capped.length;

    let qualified = 0;
    let rejected = 0;
    let inserted = 0;
    let updated = 0;
    let errorCount = 0;
    let firstError = "";
    const sample: SampleRow[] = [];

    for (const item of capped) {
      const category = item.categoryName ?? (Array.isArray(item.categories) ? item.categories[0] : null) ?? null;
      const base = { name: item.title || "(no name)", category, city: item.city ?? null, state: item.state ?? null, website: !!item.website, phone: item.phone ?? null };

      if (!item.placeId || !item.title) {
        rejected++;
        sample.push({ ...base, confidence: null, action: "rejected", reason: "Missing place_id or title" });
        continue;
      }
      const fields = mapItem(item, run);
      const conf = fields.roofing_confidence ?? 0;
      if (conf < MIN_CONFIDENCE) {
        rejected++;
        sample.push({ ...base, confidence: conf, action: "rejected", reason: `Low roofing confidence (${conf}%) for category "${fields.category || "unknown"}"` });
        continue;
      }
      qualified++;

      const { data: existing } = await supabase.from("prospects").select("id").eq("place_id", item.placeId).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("prospects").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", existing.id);
        if (error) { errorCount++; firstError = firstError || error.message; console.error("[scrape/check] update error:", JSON.stringify(error)); sample.push({ ...base, confidence: conf, action: "error", reason: `DB error: ${error.message}` }); }
        else { updated++; sample.push({ ...base, confidence: conf, action: "updated", reason: "Updated existing" }); }
      } else {
        const { error } = await supabase.from("prospects").insert(fields);
        if (error) { errorCount++; firstError = firstError || error.message; console.error("[scrape/check] insert error:", JSON.stringify(error)); sample.push({ ...base, confidence: conf, action: "error", reason: `DB error: ${error.message}` }); }
        else { inserted++; sample.push({ ...base, confidence: conf, action: "inserted", reason: "Inserted" }); }
      }
    }

    const errorSummary = errorCount ? `${errorCount} DB errors. First: ${firstError}` : "";
    await supabase.from("scrape_runs").update({
      status: "complete", inserted, updated, skipped: rejected,
      error_message: errorSummary.slice(0, 500), completed_at: new Date().toISOString(),
    }).eq("id", run.id);

    console.log("[scrape/check] complete", JSON.stringify({ city: run.city, returned, qualified, rejected, inserted, updated, errors: errorCount, firstError }));
    return NextResponse.json({
      status: "complete", city: run.city, returned, qualified, rejected, inserted, updated,
      errors: errorCount, error_sample: firstError, sample: sample.slice(0, 40),
    });
  } catch (err: any) {
    console.error("[scrape/check] fatal:", err?.message, err?.stack);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
