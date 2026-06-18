import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { startApifyRun, ACTOR_ID } from "@/lib/apify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    // V1 defaults to roofing. `industry` is the vertical; `niche` is the literal search term.
    const industry = String(body.industry || body.niche || "roofing");
    const niche = String(body.niche || industry);
    const city = body.city ? String(body.city) : "";
    const cap = Math.max(1, Math.min(Number(body.max_results) || 50, 500));

    console.log("[scrape/start] request", JSON.stringify({ industry, niche, city, cap, actorId: ACTOR_ID }));

    if (!city) {
      return NextResponse.json({ error: "city required" }, { status: 400 });
    }

    const supabase = getServiceClient();

    const insertPayload = { run_id: "pending", industry, niche, city, max_results: cap, status: "running" };
    console.log("[scrape/start] insert table=scrape_runs keys=", JSON.stringify(Object.keys(insertPayload)));

    const { data: run, error } = await supabase
      .from("scrape_runs")
      .insert(insertPayload)
      .select()
      .single();
    if (error || !run) {
      console.error("[scrape/start] supabase insert error:", JSON.stringify(error));
      return NextResponse.json(
        { error: `DB insert failed: ${error?.message || "unknown"}`, supabaseError: error },
        { status: 500 }
      );
    }

    const apifyRes = await startApifyRun({ niche, city, cap });
    if (!apifyRes.ok) {
      const apifyBody = await apifyRes.text();
      console.error("[scrape/start] Apify start failed", JSON.stringify({ status: apifyRes.status, body: apifyBody }));
      const msg = `Apify start failed (${apifyRes.status}): ${apifyBody.slice(0, 400)}`;
      await supabase
        .from("scrape_runs")
        .update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ error: msg, apifyStatus: apifyRes.status }, { status: 502 });
    }

    const apifyData = await apifyRes.json();
    const runId = apifyData?.data?.id;
    if (!runId) {
      console.error("[scrape/start] no run id in Apify response", JSON.stringify(apifyData));
      await supabase
        .from("scrape_runs")
        .update({ status: "failed", error_message: "Apify did not return a run id", completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ error: "Apify did not return a run id" }, { status: 502 });
    }

    console.log("[scrape/start] started Apify run", runId);
    const { data: updated } = await supabase
      .from("scrape_runs")
      .update({ run_id: runId })
      .eq("id", run.id)
      .select()
      .single();

    return NextResponse.json(updated ?? run);
  } catch (err: any) {
    console.error("[scrape/start] fatal:", err?.message, err?.stack);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
