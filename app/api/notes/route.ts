import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const prospectId = searchParams.get("prospect_id");
    const supabase = getServiceClient();
    let query = supabase.from("notes").select("*").order("created_at", { ascending: false });
    if (prospectId) query = query.eq("prospect_id", prospectId);
    else query = query.limit(2000);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const prospect_id = body.prospect_id;
    const text = (body.body || "").toString().trim();
    if (!prospect_id || !text) {
      return NextResponse.json({ error: "prospect_id and body required" }, { status: 400 });
    }
    const supabase = getServiceClient();
    const { data, error } = await supabase.from("notes").insert({ prospect_id, body: text }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
