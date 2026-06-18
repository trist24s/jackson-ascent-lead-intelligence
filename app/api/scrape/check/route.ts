import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { getApifyRun, getApifyDataset, mapItem } from "@/lib/apify";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { scrape_run_id } = await req.json();
    if (!scrape_run_id) {
      return NextResponse.json({ error: "scrape_run_id required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: run } = await supabase
      .from("scrape_runs")
      .select("*")
      .eq("id", scrape_run_id)
      .single();
    if (!run) {
      return NextResponse.json({ error: "ScrapeRun not found" }, { status: 404 });
    }

    if (run.status === "complete" || run.status === "failed") {
      return NextResponse.json({
        status: run.status,
        inserted: run.inserted,
        updated: run.updated,
        skipped: run.skipped,
        error_message: run.error_message,
      });
    }

    const runRes = await getApifyRun(run.run_id);
    if (!runRes.ok) return NextResponse.json({ status: "running" });
    const runData = await runRes.json();
    const apifyStatus = runData?.data?.status;

    if (!apifyStatus || apifyStatus === "RUNNING" || apifyStatus === "READY") {
      return NextResponse.json({ status: "running" });
    }

    if (apifyStatus !== "SUCCEEDED") {
      await supabase
        .from("scrape_runs")
        .update({ status: "failed", error_message: `Apify run status: ${apifyStatus}`, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ status: "failed", error_message: `Apify run status: ${apifyStatus}` });
    }

    const datasetId = runData?.data?.defaultDatasetId;
    const dsRes = await getApifyDataset(datasetId);
    if (!dsRes.ok) {
      const b = await dsRes.text();
      await supabase
        .from("scrape_runs")
        .update({ status: "failed", error_message: `Dataset fetch failed: ${dsRes.status} ${b.slice(0, 200)}`, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ status: "failed" });
    }

    const items = await dsRes.json();
    const capped = (Array.isArray(items) ? items : []).slice(0, run.max_results || 50);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of capped) {
      if (!item.placeId || !item.title) {
        skipped++;
        continue;
      }
      const fields = mapItem(item, run);
      const { data: existing } = await supabase
        .from("prospects")
        .select("id")
        .eq("place_id", item.placeId)
        .maybeSingle();

      if (existing) {
        // Upsert: refresh scrape data, preserve CRM fields (qualified, stage, scores).
        const { error } = await supabase
          .from("prospects")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) errors.push(`${item.placeId}: ${error.message}`);
        else updated++;
      } else {
        const { error } = await supabase.from("prospects").insert(fields);
        if (error) errors.push(`${item.placeId}: ${error.message}`);
        else inserted++;
      }
    }

    await supabase
      .from("scrape_runs")
      .update({
        status: "complete",
        inserted,
        updated,
        skipped,
        error_message: errors.join(" | ").slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return NextResponse.json({ status: "complete", inserted, updated, skipped });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
