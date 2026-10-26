// Deletes Supabase Auth accounts, which needs the service-role key and so can't run in the browser.
//
//   { userId, purge? }            admin of the caller's active company deletes someone whose only
//                                 company it is; purge also removes their records and files
//   { action: "list-orphans" }    super admin: accounts that belong to no company
//   { action: "delete-orphan", userId }  super admin: delete one of those (and its records)
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase at runtime.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const USER_BUCKETS = ["documents", "timesheets", "paystubs"];

async function removeFolder(admin: SupabaseClient, bucket: string, folder: string) {
  const { data } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
  const paths = (data ?? []).map((f) => `${folder}/${f.name}`);
  if (paths.length) await admin.storage.from(bucket).remove(paths);
}

// Removes everything the account owns so the auth delete isn't blocked by foreign keys.
async function purgeRecords(admin: SupabaseClient, userId: string) {
  const { data: signed } = await admin.from("esign_records").select("final_pdf_path").eq("user_id", userId);
  const finals = (signed ?? []).map((r) => r.final_pdf_path).filter(Boolean);
  if (finals.length) await admin.storage.from("deal-memos").remove(finals);
  for (const table of ["esign_records", "timesheets", "documents", "paystubs"]) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`Couldn't remove ${table}: ${error.message}`);
  }
  for (const bucket of USER_BUCKETS) await removeFolder(admin, bucket, userId);
}

async function listOrphans(admin: SupabaseClient) {
  const [{ data: members }, { data: supers }] = await Promise.all([
    admin.from("company_memberships").select("user_id"),
    admin.from("superadmins").select("user_id"),
  ]);
  const keep = new Set([...(members ?? []), ...(supers ?? [])].map((r) => r.user_id));
  const orphans: { id: string; email?: string; created_at: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (!keep.has(u.id)) orphans.push({ id: u.id, email: u.email, created_at: u.created_at });
    if (data.users.length < 1000) break;
  }
  return orphans;
}

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
    const action = body.action ?? "delete";

    if (action === "list-orphans" || action === "delete-orphan") {
      const { data: isSuper } = await asCaller.rpc("is_superadmin");
      if (!isSuper) return json({ error: "Super admins only." }, 403);
      const orphans = await listOrphans(admin);
      if (action === "list-orphans") return json({ orphans });
      if (!orphans.some((o) => o.id === body.userId)) {
        return json({ error: "That account belongs to a company, so it isn't an orphan." }, 400);
      }
      await purgeRecords(admin, body.userId);
      const { error } = await admin.auth.admin.deleteUser(body.userId);
      if (error) return json({ error: error.message }, 400);
      return json({ deleted: true });
    }

    if (action !== "delete") return json({ error: `Unknown action "${action}".` }, 400);

    const userId = body.userId as string | undefined;
    if (!userId) return json({ error: "Missing userId." }, 400);
    if (userId === user.id) return json({ error: "You can't delete your own account." }, 400);

    const [{ data: companyId }, { data: isAdmin }] = await Promise.all([
      asCaller.rpc("current_company_id"),
      asCaller.rpc("is_company_admin"),
    ]);
    if (!companyId || !isAdmin) return json({ error: "Only admins can delete accounts." }, 403);

    const { data: memberships } = await admin.from("company_memberships").select("company_id").eq("user_id", userId);
    const companies = (memberships ?? []).map((m) => m.company_id);
    if (!companies.includes(companyId)) return json({ error: "That person isn't in your company." }, 403);
    if (companies.length > 1) {
      return json({ error: "They belong to another company too. Remove their access instead of deleting the account." }, 400);
    }
    const { data: isSuperTarget } = await admin.from("superadmins").select("user_id").eq("user_id", userId).maybeSingle();
    if (isSuperTarget) return json({ error: "Super admin accounts can't be deleted here." }, 400);

    if (body.purge) await purgeRecords(admin, userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    // A foreign-key block comes back as "Database error deleting user"; the app then offers to purge.
    if (error) return json({ error: error.message }, 400);
    return json({ deleted: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
