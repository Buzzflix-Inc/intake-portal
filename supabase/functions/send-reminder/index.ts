// Reminds crew what they still owe for onboarding: missing or rejected uploads and unsigned forms.
//
//   { companyId, userIds: [...] }   an admin of that company reminds one or more people
//
// Each person gets an in-app notification and, when Resend is set up, an email. The items come from
// public.onboarding_todo, never from the caller. Someone reminded in the last REMIND_GAP_HOURS is
// skipped. Replies { results: [{ userId, status, emailed?, error? }] }, status is "sent",
// "nothing" (nothing outstanding), "recent" (reminded too recently) or "error".
//
// Uses the invite secrets: RESEND_API_KEY, INVITE_FROM, PORTAL_URL.
import { createClient } from "jsr:@supabase/supabase-js@2";

const REMIND_GAP_HOURS = 12;
const MAX_PEOPLE = 200;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Todo = { kind: "upload" | "reupload" | "sign"; label: string };
const todoText = (t: Todo) =>
  t.kind === "sign" ? `Sign: ${t.label}` : t.kind === "reupload" ? `Upload again: ${t.label} (the last one was rejected)` : `Upload: ${t.label}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user) return json({ error: "Not signed in." }, 401);

    const body = await req.json().catch(() => ({}));
    const companyId = String(body.companyId ?? "");
    const userIds = [...new Set((Array.isArray(body.userIds) ? body.userIds : []).map(String))];
    if (!companyId || !userIds.length) return json({ error: "Say who to remind." }, 400);
    if (userIds.length > MAX_PEOPLE) return json({ error: `Remind at most ${MAX_PEOPLE} people at once.` }, 400);

    const { data: isAdmin } = await asCaller.rpc("is_company_admin", { p_company: companyId });
    if (!isAdmin) return json({ error: "Only admins can send reminders." }, 403);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("INVITE_FROM");
    const portalUrl = Deno.env.get("PORTAL_URL");
    const canEmail = !!(apiKey && from && portalUrl);

    const [{ data: company }, { data: members }, { data: recent }] = await Promise.all([
      admin.from("companies").select("name").eq("id", companyId).maybeSingle(),
      admin.from("company_memberships").select("user_id").eq("company_id", companyId).in("user_id", userIds),
      admin.from("onboarding_reminders").select("user_id").eq("company_id", companyId).in("user_id", userIds)
        .gte("created_at", new Date(Date.now() - REMIND_GAP_HOURS * 3600e3).toISOString()),
    ]);
    const companyName = company?.name ?? "your production";
    const memberIds = new Set((members ?? []).map((m) => m.user_id));
    const recentIds = new Set((recent ?? []).map((r) => r.user_id));

    const results = [];
    for (const userId of userIds) {
      if (!memberIds.has(userId)) { results.push({ userId, status: "error", error: "Not at this production." }); continue; }
      if (recentIds.has(userId)) { results.push({ userId, status: "recent" }); continue; }
      const { data: todo, error: todoErr } = await admin.rpc("onboarding_todo", { p_user: userId, p_company: companyId });
      if (todoErr) { results.push({ userId, status: "error", error: todoErr.message }); continue; }
      const items = (todo ?? []) as Todo[];
      if (!items.length) { results.push({ userId, status: "nothing" }); continue; }

      const { data: profile } = await admin.from("profiles").select("email").eq("user_id", userId).maybeSingle();
      const email = String(profile?.email ?? "").toLowerCase();
      const { data: invite } = await admin.from("company_invites").select("full_name").eq("company_id", companyId).eq("email", email).maybeSingle();

      let emailed = false, error: string | undefined;
      if (!canEmail) error = "Email isn't set up (RESEND_API_KEY, INVITE_FROM and PORTAL_URL secrets).";
      else if (!email) error = "No email address on file.";
      else {
        const html = `
          <p>Hi ${esc(invite?.full_name ?? "")},</p>
          <p>A quick reminder from ${esc(companyName)}: we still need the following from you to finish onboarding.</p>
          <ul>${items.map((t) => `<li>${esc(todoText(t))}</li>`).join("")}</ul>
          <p><a href="${esc(portalUrl)}">Open the HR Intake Portal</a> and sign in with ${esc(email)} to finish these.</p>
          <p>Thanks!</p>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [email], subject: `Reminder: finish onboarding for ${companyName}`, html }),
        });
        emailed = res.ok;
        if (!res.ok) error = (await res.json().catch(() => ({}))).message ?? `Resend returned ${res.status}`;
        await sleep(550);  // Resend allows about two requests a second
      }

      await admin.from("notifications").insert({
        user_id: userId, company_id: companyId, kind: "reminder", title: "Onboarding reminder",
        body: "Still to do: " + items.map(todoText).join(" · "), view: "portal",
      });
      await admin.from("onboarding_reminders").insert({ company_id: companyId, user_id: userId, sent_by: user.id, items, emailed });
      results.push({ userId, status: "sent", emailed, error });
    }
    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
