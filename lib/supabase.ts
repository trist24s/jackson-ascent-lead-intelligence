import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service-role key.
// Never import this from a client component — the service role key must stay on the server.
export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
