import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service-role key.
// Never import this from a client component — the service role key must stay on the server.
export function getServiceClient(): SupabaseClient {
  const rawUrl = process.env.SUPABASE_URL;
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!rawUrl || !rawUrl.trim()) {
    throw new Error("Missing SUPABASE_URL environment variable");
  }
  if (!rawKey || !rawKey.trim()) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
  }

  // Trim to defend against trailing spaces/newlines from pasting into Vercel.
  const urlInput = rawUrl.trim();
  const key = rawKey.trim();

  let parsed: URL;
  try {
    parsed = new URL(urlInput);
  } catch {
    throw new Error(
      `SUPABASE_URL is not a valid URL: "${urlInput}". It must look like https://<project-ref>.supabase.co (Project Settings -> Data API -> Project URL).`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `SUPABASE_URL must start with https:// — got "${parsed.protocol}//". Use your project URL (https://<ref>.supabase.co), not the database connection string.`
    );
  }

  // Use ONLY the origin so no stray path is ever concatenated into requests.
  const url = parsed.origin;

  console.log(
    "[supabase] init",
    JSON.stringify({ host: parsed.host, normalizedFromInput: url !== urlInput, keyLength: key.length })
  );

  return createClient(url, key, { auth: { persistSession: false } });
}
