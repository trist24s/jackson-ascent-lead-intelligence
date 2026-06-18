import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getApifyRun, getApifyDataset, mapItem } from "@/lib/apify";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_CONFIDENCE = 70;

export async function POST(req: Request) {
  try {
    const { scrape_run_id } = await req.json();
    if (!scrape_run_id) return NextResponse.json({ error: "scrape_run_id required" }, { status: 400 });

    const supabase = getServiceClient();
    const { data: run } = await supabase.from("scrape_runs").select("*").eq("id", scrape_run_id).single();
    if (!run) return NextResponse.json({ error: "ScrapeRun not found" }, { status: 404 });

    if (run.status === "complete" || run.status === "failed") {
      return NextResponse.json({ status: run.status, returned: run.returned ?? null, inserted: run.inserted, updated: run.updated, skipped: run.skipped, error_message: run.error_message });
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
    console.log("[scrape/check] city:", run.city, "dataset items returned:", Array.isArray(items) ? items.length : 0, "processing:", returned);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of capped) {
      if (!item.placeId || !item.title) { skipped++; continue; }
      const fields = mapItem(item, run);
      if ((fields.roofing_confidence ?? 0) < MIN_CONFIDENCE) { skipped++; continue; }

      const { data: existing } = await supabase.from("prospects").select("id").eq("place_id", item.placeId).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("prospects").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", existing.id);
        if (error) { console.error("[scrape/check] update error:", JSON.stringify(error)); errors.push(`${item.placeId}: ${error.message}`); }
        else updated++;
      } else {
        const { error } = await supabase.from("prospects").insert(fields);
        if (error) { console.error("[scrape/check] insert error:", JSON.stringify(error)); errors.push(`${item.placeId}: ${error.message}`); }
        else inserted++;
      }
    }

    await supabase.from("scrape_runs").update({
      status: "complete", inserted, updated, skipped,
      error_message: errors.join(" | ").slice(0, 500), completed_at: new Date().toISOString(),
    }).eq("id", run.id);

    console.log("[scrape/check] complete", JSON.stringify({ city: run.city, returned, inserted, updated, skipped }));
    return NextResponse.json({ status: "complete", returned, inserted, updated, skipped });
  } catch (err: any) {
    console.error("[scrape/check] fatal:", err?.message, err?.stack);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
