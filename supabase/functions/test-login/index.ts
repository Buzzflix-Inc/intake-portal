// Test mode for local development: signs in an @example.com address without sending email.
//
//   { email, key }  ->  { tokenHash }   (the app exchanges it with supabase.auth.verifyOtp)
//
// Only works while public.test_login_settings is enabled, with the key whose SHA-256 hash is stored
// there, and only for @example.com / .org / .net (reserved domains no real person can own), so it
// can't be used to get into a real account. New addresses get an account, like a first emailed code.
// Remove this function and that table before going to production.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TEST_EMAIL = /^[a-z0-9._%+-]+@example\.(com|org|net)$/;

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compare without stopping at the first different character.
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const key = String(body.key ?? "");
    if (!TEST_EMAIL.test(email)) return json({ error: "Test mode only works for @example.com addresses." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settings } = await admin.from("test_login_settings").select("enabled, key_hash").eq("id", 1).maybeSingle();
    if (!settings?.enabled || !settings.key_hash) return json({ error: "Test mode is turned off." }, 403);
    if (!key || !sameHex(await sha256Hex(key), settings.key_hash)) return json({ error: "Wrong test-mode key." }, 403);

    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link?.properties?.hashed_token) throw error ?? new Error("Couldn't start the session.");
    return json({ tokenHash: link.properties.hashed_token });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
