// Passkeys: register one while signed in, or sign in with one instead of an emailed code.
//
//   { action: "register-options" }                       signed in: options for navigator.credentials.create
//   { action: "register-verify", challengeId, response }  signed in: checks it and saves the passkey
//   { action: "login-options" }                           anyone: options for navigator.credentials.get
//   { action: "login-verify", challengeId, response }     anyone: checks it and replies { tokenHash }
//
// The app exchanges tokenHash for a normal session with supabase.auth.verifyOtp({ token_hash, type: "email" }),
// so a passkey sign-in counts like an emailed code. Admins still enter their authenticator code after it.
//
// Secrets (optional): PASSKEY_ORIGINS, a comma-separated list of origins allowed to use passkeys.
// Defaults to PORTAL_URL's origin plus http://localhost:5173 and http://localhost:5174.
// This function checks the caller itself, so it is deployed without JWT verification.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.3.3";
import { isoBase64URL } from "npm:@simplewebauthn/server@13.3.3/helpers";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function allowedOrigins(): string[] {
  const list = (Deno.env.get("PASSKEY_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;
  const out = ["http://localhost:5173", "http://localhost:5174"];
  const portal = Deno.env.get("PORTAL_URL");
  if (portal) { try { out.push(new URL(portal).origin); } catch (_) { /* ignore */ } }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const origin = req.headers.get("Origin") ?? "";
    if (!allowedOrigins().includes(origin)) return json({ error: "Passkeys aren't enabled for this site." }, 403);
    const rpID = new URL(origin).hostname;

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // Challenges are single use and short lived; expired ones are cleared as new ones are made.
    const sweep = () =>
      admin.from("passkey_challenges").delete().lt("created_at", new Date(Date.now() - CHALLENGE_TTL_MS).toISOString());
    const takeChallenge = async (id: string, kind: string, userId: string | null) => {
      const { data } = await admin.from("passkey_challenges").select("*").eq("id", id).eq("kind", kind).maybeSingle();
      if (!data) return null;
      await admin.from("passkey_challenges").delete().eq("id", id);
      if (Date.now() - new Date(data.created_at).getTime() > CHALLENGE_TTL_MS) return null;
      if (userId && data.user_id !== userId) return null;
      return data.challenge as string;
    };

    if (action === "login-options") {
      await sweep();
      const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
      const { data: ch, error } = await admin.from("passkey_challenges")
        .insert({ kind: "login", challenge: options.challenge }).select("id").single();
      if (error) throw error;
      return json({ options, challengeId: ch.id });
    }

    if (action === "login-verify") {
      const response = body.response;
      const challenge = await takeChallenge(String(body.challengeId ?? ""), "login", null);
      if (!challenge || !response?.id) return json({ error: "That passkey request expired. Try again." }, 400);
      const { data: pk } = await admin.from("passkeys").select("*").eq("credential_id", response.id).maybeSingle();
      if (!pk) return json({ error: "This passkey isn't registered here. Sign in with your email instead." }, 400);
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: pk.credential_id,
          publicKey: isoBase64URL.toBuffer(pk.public_key),
          counter: Number(pk.counter ?? 0),
          transports: pk.transports ?? [],
        },
      });
      if (!result.verified) return json({ error: "That passkey couldn't be verified." }, 400);
      await admin.from("passkeys")
        .update({ counter: result.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
        .eq("id", pk.id);
      const { data: u, error: ue } = await admin.auth.admin.getUserById(pk.user_id);
      if (ue || !u?.user?.email) return json({ error: "That account no longer exists." }, 400);
      // A one-time sign-in token, as if they had clicked an emailed link (nothing is emailed).
      const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
      if (le || !link?.properties?.hashed_token) throw le ?? new Error("Couldn't start the session.");
      return json({ tokenHash: link.properties.hashed_token, email: u.user.email });
    }

    // Registering needs the signed-in person.
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user) return json({ error: "Sign in first." }, 401);

    if (action === "register-options") {
      await sweep();
      const { data: existing } = await admin.from("passkeys").select("credential_id, transports").eq("user_id", user.id);
      const options = await generateRegistrationOptions({
        rpName: "HR Intake Portal",
        rpID,
        userName: user.email ?? user.id,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials: (existing ?? []).map((c) => ({ id: c.credential_id, transports: c.transports ?? [] })),
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      });
      const { data: ch, error } = await admin.from("passkey_challenges")
        .insert({ kind: "register", challenge: options.challenge, user_id: user.id }).select("id").single();
      if (error) throw error;
      return json({ options, challengeId: ch.id });
    }

    if (action === "register-verify") {
      const challenge = await takeChallenge(String(body.challengeId ?? ""), "register", user.id);
      if (!challenge) return json({ error: "That passkey request expired. Try again." }, 400);
      const result = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
      if (!result.verified || !result.registrationInfo) return json({ error: "That passkey couldn't be verified." }, 400);
      const cred = result.registrationInfo.credential;
      const { error } = await admin.from("passkeys").insert({
        user_id: user.id,
        credential_id: cred.id,
        public_key: isoBase64URL.fromBuffer(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports ?? [],
        device_name: String(body.deviceName ?? "").slice(0, 80) || null,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
