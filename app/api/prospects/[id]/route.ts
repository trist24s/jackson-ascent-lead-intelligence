import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES = [
  "New Lead", "Researched", "Qualified", "Contacted", "Follow Up",
  "Interested", "Discovery Call", "Proposal Sent", "Won", "Lost",
];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const update: Record<string, any> = {};

    if (typeof body.pipeline_stage === "string") {
      if (!STAGES.includes(body.pipeline_stage)) {
        return NextResponse.json({ error: `Invalid stage: ${body.pipeline_stage}` }, { status: 400 });
      }
      update.pipeline_stage = body.pipeline_stage;
    }
    if (typeof body.qualified === "boolean") update.qualified = body.qualified;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    update.updated_at = new Date().toISOString();

    const supabase = getServiceClient();
    const { data, error } = await supabase.from("prospects").update(update).eq("id", params.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
