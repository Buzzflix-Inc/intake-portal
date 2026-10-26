// Emails an invite through Resend.
//
//   { inviteId }  an admin of the invite's company sends a crew invite
//   { email }     a super admin sends (or resends) a company-admin invite
//
// Replies { sent: true } or { sent: false, error }. The app falls back to "Copy invite" when not sent.
//
// Secrets (set with `supabase secrets set`, never committed):
//   RESEND_API_KEY   API key from resend.com
//   INVITE_FROM      sender, e.g. "HR Intake Portal <hr@yourdomain.com>"
//   PORTAL_URL       where the portal is hosted, e.g. https://portal.yourdomain.com/
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("INVITE_FROM");
    const portalUrl = Deno.env.get("PORTAL_URL");
    if (!apiKey || !from || !portalUrl) {
      return json({ sent: false, error: "Invite email isn't set up yet (RESEND_API_KEY, INVITE_FROM and PORTAL_URL secrets)" });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user) return json({ sent: false, error: "Not signed in." }, 401);

    const body = await req.json().catch(() => ({}));
    const query = admin.from("company_invites").select("*, companies(name)");
    const { data: invite } = body.inviteId
      ? await query.eq("id", body.inviteId).maybeSingle()
      : await query.eq("email", String(body.email ?? "").trim().toLowerCase()).maybeSingle();
    if (!invite) return json({ sent: false, error: "Invite not found." }, 404);

    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      asCaller.rpc("is_company_admin", { p_company: invite.company_id }),
      asCaller.rpc("is_superadmin"),
    ]);
    if (!isAdmin && !isSuper) return json({ sent: false, error: "Only admins can send invites." }, 403);
    if (invite.used) return json({ sent: false, error: "They have already signed up." }, 400);

    const company = invite.companies?.name ?? "your company";
    const link = `${portalUrl}?signup=1&email=${encodeURIComponent(invite.email)}`;
    const asAdmin = invite.role === "admin";
    const docs = (invite.requested_documents ?? []).filter((d: string) => d !== "__contractor__");
    const details = asAdmin ? "" : [
      invite.crew_role ? `<p>Role: ${esc(invite.crew_role)}${invite.department ? ` (${esc(invite.department)})` : ""}</p>` : "",
      invite.start_date ? `<p>Dates: ${esc(invite.start_date)} – ${esc(invite.end_date ?? "")}</p>` : "",
      invite.kit_fee_enabled ? `<p>Kit fee: $${Number(invite.kit_fee_rate ?? 0).toFixed(2)}/day</p>` : "",
      docs.length ? `<p>Please upload these before you start:</p><ul>${docs.map((d: string) => `<li>${esc(d)}</li>`).join("")}</ul>` : "",
    ].join("");

    const html = `
      <p>Hi ${esc(invite.full_name ?? "")},</p>
      <p>You've been invited to ${asAdmin ? `administer ${esc(company)}` : `join ${esc(company)}`} on the HR Intake Portal.</p>
      ${details}
      <p><a href="${esc(link)}">Create your account</a> using this email address (${esc(invite.email)}), then confirm your email to get started.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [invite.email], subject: `Your invite to ${company}`, html }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return json({ sent: false, error: detail.message ?? `Resend returned ${res.status}` });
    }
    return json({ sent: true });
  } catch (e) {
    return json({ sent: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
