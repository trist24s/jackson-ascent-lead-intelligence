import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
// Never statically cache this route — it must read live data on every request.
// (Without this, Next.js prerenders it at build time when the DB is empty and
// serves an empty array forever.)
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = getServiceClient();
    const { data, error, count } = await supabase
      .from("prospects")
      .select("*", { count: "exact" })
      .order("scraped_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[prospects] query error:", JSON.stringify(error));
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.log("[prospects] returned rows:", data?.length ?? 0, "exact count:", count);
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error("[prospects] fatal:", err?.message);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
