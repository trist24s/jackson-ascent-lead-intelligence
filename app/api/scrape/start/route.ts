import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { startApifyRun } from "@/lib/apify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    // V1 defaults to roofing. `industry` is the vertical; `niche` is the literal search term.
    const industry = String(body.industry || body.niche || "roofing");
    const niche = String(body.niche || industry);
    const city = body.city ? String(body.city) : "";
    const cap = Math.max(1, Math.min(Number(body.max_results) || 50, 500));

    if (!city) {
      return NextResponse.json({ error: "city required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: run, error } = await supabase
      .from("scrape_runs")
      .insert({ run_id: "pending", industry, niche, city, max_results: cap, status: "running" })
      .select()
      .single();
    if (error || !run) {
      return NextResponse.json({ error: error?.message || "insert failed" }, { status: 500 });
    }

    const apifyRes = await startApifyRun({ niche, city, cap });
    if (!apifyRes.ok) {
      const t = await apifyRes.text();
      await supabase
        .from("scrape_runs")
        .update({
          status: "failed",
          error_message: `Apify start failed: ${apifyRes.status} ${t.slice(0, 300)}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      return NextResponse.json({ error: `Apify start failed: ${apifyRes.status}` }, { status: 502 });
    }

    const apifyData = await apifyRes.json();
    const runId = apifyData?.data?.id;
    if (!runId) {
      await supabase
        .from("scrape_runs")
        .update({ status: "failed", error_message: "Apify did not return a run id", completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ error: "No run id from Apify" }, { status: 502 });
    }

    const { data: updated } = await supabase
      .from("scrape_runs")
      .update({ run_id: runId })
      .eq("id", run.id)
      .select()
      .single();

    return NextResponse.json(updated ?? run);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
