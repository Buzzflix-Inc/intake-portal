// Demo mode: a ready-made production ("Silver Harbour") whose crew sit at different points of
// onboarding, for showing the portal off.
//
//   { action: "people" }                     ->  { people }      the demo accounts and where each one is
//   { action: "login", email, termsVersion } ->  { tokenHash }   (the app exchanges it with supabase.auth.verifyOtp)
//   { action: "reset", termsVersion }        ->  { ok }          signed-in demo accounts only
//
// Every demo address is @demo.example.com (a reserved domain no real person can own), signs in
// without email, and never needs two-step sign-in. Reset deletes the demo production with everything
// in it, and builds it again from PEOPLE below. Only works while public.demo_settings is enabled.
// Deployed without JWT verification: "login" happens before there is a session, and "reset" checks
// the caller itself.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DOMAIN = "demo.example.com";
const COMPANY_ID = "d0000000-0000-4000-8000-000000000001"; // public.demo_company_id()
const ADMIN_EMAIL = `demo@${DOMAIN}`;
const USER_BUCKETS = ["documents", "timesheets", "paystubs"];
const ID = "Government-issued ID", CHEQUE = "Void cheque / direct deposit form", SIN = "SIN documentation";

type Person = {
  key: string; email: string; name: string; dept: string; role: string; stage: string;
  admin?: boolean; invitedOnly?: boolean; contractor?: boolean; kit?: number; docs?: string[]; phone?: string;
};
// The crew, in the order the demo bar lists them. invitedOnly people have an invite but no account
// until someone signs in as them, which shows the new-hire flow from the very start.
const PEOPLE: Person[] = [
  { key: "admin", email: ADMIN_EMAIL, name: "Jordan Avery", dept: "Production", role: "Production Manager", admin: true, stage: "Production admin" },
  { key: "maya", email: `maya.chen@${DOMAIN}`, name: "Maya Chen", dept: "Camera", role: "Director of Photography", stage: "Fully onboarded · Camera head, reviews timesheets" },
  { key: "liam", email: `liam.oconnor@${DOMAIN}`, name: "Liam O'Connor", dept: "Camera", role: "1st Assistant Camera (Focus Puller)", kit: 50, stage: "Deal memo waiting for countersignature · SIN missing" },
  { key: "priya", email: `priya.patel@${DOMAIN}`, name: "Priya Patel", dept: "Grip & Electric", role: "Gaffer", kit: 75, stage: "Just joined · deal memo and safety form to sign" },
  { key: "noah", email: `noah.williams@${DOMAIN}`, name: "Noah Williams", dept: "Sound", role: "Boom Operator", stage: "ID rejected · deal memo sent back to re-sign" },
  { key: "ethan", email: `ethan.brooks@${DOMAIN}`, name: "Ethan Brooks", dept: "Art Department", role: "Set Dresser", stage: "Timesheet ready for final approval" },
  { key: "grace", email: `grace.kim@${DOMAIN}`, name: "Grace Kim", dept: "Art Department", role: "Art Director", stage: "Fully onboarded · Art head" },
  { key: "sofia", email: `sofia.martinez@${DOMAIN}`, name: "Sofia Martinez", dept: "Costume & Wardrobe", role: "Costume Designer", contractor: true, docs: [ID, CHEQUE], stage: "Contractor · one invoice paid, one waiting" },
  { key: "olivia", email: `olivia.reyes@${DOMAIN}`, name: "Olivia Reyes", dept: "Hair & Makeup", role: "Key Makeup Artist", invitedOnly: true, stage: "Invited · hasn't signed in yet" },
  { key: "marcus", email: `marcus.lee@${DOMAIN}`, name: "Marcus Lee", dept: "Transportation", role: "Driver", invitedOnly: true, docs: [ID, CHEQUE, SIN, "Driver's license / abstract"], stage: "Invited · hasn't signed in yet" },
];

// ---------- Dates ----------
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysFrom = (n: number) => new Date(Date.now() + n * DAY);
const ago = (days: number, hour = 10) => { const d = daysFrom(-days); d.setUTCHours(hour + 7, 0, 0, 0); return d.toISOString(); };
// Timesheet weeks start on Sunday (weekStartOf in src/js/lib/utils.js).
function weekStart(weeksBack: number) {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  return new Date(d.getTime() - (d.getUTCDay() + 7 * weeksBack) * DAY);
}
const fmtDay = (d: Date) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

// ---------- A small one-page PDF, so previews and downloads show something ----------
function pdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "-").replace(/([\\()])/g, "\\$1");
  let y = 724;
  let body = `0.75 G 1 w 40 40 532 712 re S\nBT /F2 20 Tf 60 ${y} Td (${esc(title)}) Tj ET\n`;
  y -= 20;
  body += `BT /F1 9 Tf 60 ${y} Td (SAMPLE - demo data for the Silver Harbour demo production. Not a real document.) Tj ET\n`;
  y -= 34;
  for (const l of lines) { body += `BT /F1 12 Tf 60 ${y} Td (${esc(l)}) Tj ET\n`; y -= 20; }
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${body.length} >>\nstream\n${body}endstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
const slug = (s: string) => s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");

// ---------- Clearing out ----------
async function removeTree(admin: SupabaseClient, bucket: string, prefix: string) {
  const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  const files: string[] = [];
  for (const item of data ?? []) {
    if (item.id === null) await removeTree(admin, bucket, `${prefix}/${item.name}`); // a folder
    else files.push(`${prefix}/${item.name}`);
  }
  if (files.length) await admin.storage.from(bucket).remove(files);
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

// ---------- Reset: delete the demo production and build it again ----------
async function reset(admin: SupabaseClient, termsVersion: string) {
  // 1. Everything the demo accounts and the demo production own.
  const profs = must(await admin.from("profiles").select("user_id, email").like("email", `%@${DOMAIN}`), "Reading demo accounts") ?? [];
  const ids = profs.map((p) => p.user_id);
  await Promise.all([
    ...profs.flatMap((p) => USER_BUCKETS.map((b) => removeTree(admin, b, p.user_id))),
    removeTree(admin, "deal-memos", COMPANY_ID),
    removeTree(admin, "branding", COMPANY_ID),
  ]);
  if (ids.length) {
    for (const t of ["esign_records", "timesheets", "documents", "paystubs"]) {
      must(await admin.from(t).delete().in("user_id", ids), `Clearing ${t}`);
    }
  }
  must(await admin.from("companies").delete().eq("id", COMPANY_ID), "Removing the demo production");

  // 2. Accounts: keep the starting crew (same ids, so open sessions carry on), without two-step
  //    sign-in or passkeys; delete everyone else, such as invited crew who have since signed in.
  const starting = new Set(PEOPLE.filter((p) => !p.invitedOnly).map((p) => p.email));
  const idOf = new Map<string, string>();
  for (const p of profs) {
    if (!starting.has(p.email)) {
      const { error } = await admin.auth.admin.deleteUser(p.user_id);
      if (error) throw new Error(`Removing ${p.email}: ${error.message}`);
      continue;
    }
    idOf.set(p.email, p.user_id);
    const { data: f } = await admin.auth.admin.mfa.listFactors({ userId: p.user_id });
    for (const x of f?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: x.id, userId: p.user_id });
  }
  if (ids.length) {
    await admin.from("passkeys").delete().in("user_id", ids);
    await admin.from("mfa_recovery_codes").delete().in("user_id", ids);
  }
  for (const p of PEOPLE.filter((x) => !x.invitedOnly && !idOf.has(x.email))) {
    const { data, error } = await admin.auth.admin.createUser({ email: p.email, email_confirm: true, user_metadata: { full_name: p.name } });
    if (error || !data.user) throw new Error(`Creating ${p.email}: ${error?.message}`);
    idOf.set(p.email, data.user.id);
  }
  const uid = (key: string) => idOf.get(PEOPLE.find((p) => p.key === key)!.email)!;
  const person = (key: string) => PEOPLE.find((p) => p.key === key)!;
  const adminId = uid("admin");
  must(await admin.from("profiles")
    .update({ terms_version: termsVersion, terms_accepted_at: ago(30) })
    .in("user_id", [...idOf.values()]), "Accepting the Terms");

  // 3. The production and its forms.
  must(await admin.from("companies").insert({
    id: COMPANY_ID, name: "Silver Harbour", tagline: "Feature film · Demo production",
    theme: "ocean", primary_color: "#0b2a3c", accent_color: "#0e7490", setup_done: true, created_by: adminId,
    production_type: "Feature film", union_status: "Mixed", province: "British Columbia",
    start_date: ymd(daysFrom(-35)), wrap_date: ymd(daysFrom(70)), created_at: ago(40),
  }), "Creating the demo production");

  const tpl = must(await admin.from("esign_templates").insert([
    {
      company_id: COMPANY_ID, type: "deal_memo", name: "Silver Harbour Crew Deal Memo", created_at: ago(38),
      deal_points: [
        { label: "Production", value: "Silver Harbour (feature film)" },
        { label: "Engagement", value: "Daily, 10-hour guarantee" },
        { label: "Overtime", value: "1.5x after 10 hours, 2x after 12 hours" },
        { label: "Holiday pay", value: "4% added to each pay" },
        { label: "Pay schedule", value: "Weekly, by direct deposit" },
      ],
      terms_text: "This memo confirms your engagement on Silver Harbour. Hours, overtime and kit fees are paid from approved timesheets. Either party may end the engagement with one week's notice. Everything you see on set is confidential.",
    },
    {
      company_id: COMPANY_ID, type: "safety", name: "On-Set Safety Acknowledgment", created_at: ago(38),
      deal_points: [
        { label: "Safety orientation", value: "Completed on your first day" },
        { label: "Report hazards to", value: "1st AD or the Safety Coordinator" },
        { label: "PPE", value: "Closed-toe shoes on set at all times" },
      ],
      terms_text: "I have read the production's safety guidelines, know where the first aid station and muster point are, and will report any incident or hazard straight away.",
    },
    {
      company_id: COMPANY_ID, type: "deal_memo", name: "Contractor Services Agreement", created_at: ago(38),
      deal_points: [
        { label: "Services", value: "Costume design" },
        { label: "Fee", value: "Weekly flat fee, invoiced" },
        { label: "Payment terms", value: "Net 15 from approval" },
      ],
      terms_text: "You provide these services as an independent contractor and are responsible for your own taxes and insurance. Submit invoices through the portal.",
    },
  ]).select("id, name"), "Adding forms");
  const tplId = (name: string) => tpl.find((t) => t.name.startsWith(name))!.id;
  const DEAL = tplId("Silver Harbour Crew"), SAFETY = tplId("On-Set Safety"), CONTRACT = tplId("Contractor");

  // 4. Invites. Inserting one for an existing account makes them a member straight away.
  must(await admin.from("company_invites").insert(PEOPLE.map((p, i) => ({
    company_id: COMPANY_ID, email: p.email, role: p.admin ? "admin" : "employee",
    full_name: p.name, phone: `604-555-01${String(10 + i)}`, department: p.dept, crew_role: p.role,
    start_date: ymd(daysFrom(p.invitedOnly ? 3 : -28)), end_date: ymd(daysFrom(70)),
    kit_fee_enabled: !!p.kit, kit_fee_rate: p.kit ?? null,
    requested_documents: p.admin ? [] : [...(p.contractor ? ["__contractor__"] : []), ...(p.docs ?? [ID, CHEQUE, SIN])],
    deal_memo_template_id: p.admin ? null : p.contractor ? CONTRACT : DEAL,
    safety_template_id: p.admin || p.contractor ? null : SAFETY,
    used: false, created_at: p.invitedOnly ? ago(1) : ago(32),
  }))), "Inviting the crew");
  must(await admin.from("profiles").update({ company_id: COMPANY_ID }).in("user_id", [...idOf.values()]), "Setting the active production");

  must(await admin.from("approval_chain").insert({ company_id: COMPANY_ID, step_order: 1, approver_email: ADMIN_EMAIL, label: "Production Manager" }), "Approval chain");
  must(await admin.from("department_heads").insert([
    { company_id: COMPANY_ID, department: "Camera", head_user_id: uid("maya") },
    { company_id: COMPANY_ID, department: "Art Department", head_user_id: uid("grace") },
  ]), "Department heads");

  // 5. Uploaded documents. [person, document, status, days ago]
  const docs: [string, string, string, number][] = [
    ["maya", ID, "approved", 27], ["maya", CHEQUE, "approved", 27], ["maya", SIN, "approved", 27],
    ["grace", ID, "approved", 26], ["grace", CHEQUE, "approved", 26], ["grace", SIN, "approved", 26],
    ["ethan", ID, "approved", 20], ["ethan", CHEQUE, "approved", 20], ["ethan", SIN, "approved", 19],
    ["liam", ID, "approved", 12], ["liam", CHEQUE, "pending", 2],
    ["noah", ID, "rejected", 6], ["noah", CHEQUE, "approved", 6], ["noah", SIN, "pending", 1],
    ["sofia", CHEQUE, "approved", 15], ["sofia", ID, "pending", 3],
  ];
  await Promise.all(docs.map(async ([key, docType, status, days], i) => {
    const p = person(key);
    const path = `${uid(key)}/${Date.now() + i}-${slug(docType.split(" /")[0])}.pdf`;
    const lines = [`Name: ${p.name}`, `Document: ${docType}`, `Uploaded: ${fmtDay(daysFrom(-days))}`];
    if (status === "rejected") lines.push("", "Photo too blurry to read the expiry date.");
    must(await admin.storage.from("documents").upload(path, pdf(docType, lines), { contentType: "application/pdf", upsert: true }), "Uploading a document");
    const row = must(await admin.from("documents").insert({
      company_id: COMPANY_ID, user_id: uid(key), status, file_path: path, doc_type: docType, approval_step: 1, created_at: ago(days),
    }).select("id").single(), "Adding a document");
    if (status !== "pending") {
      must(await admin.from("document_approvals").insert({
        document_id: row.id, step_order: 1, approver_id: adminId, decision: status, created_at: ago(Math.max(0, days - 1), 15),
      }), "Recording a review");
    }
  }));

  // 6. Deal memos and safety forms.
  const signed = (key: string, days: number) => ({ employee_signature: person(key).name, employee_signed_at: ago(days, 9) });
  const counter = (days: number) => ({ admin_signature: "Jordan Avery", admin_signed_at: ago(days, 14), admin_id: adminId });
  const rec = (key: string, template_id: string, type: string, status: string, extra: Record<string, unknown>, days: number) =>
    ({ user_id: uid(key), template_id, type, status, created_at: ago(days, 8), ...extra });
  must(await admin.from("esign_records").insert([
    rec("maya", DEAL, "deal_memo", "countersigned", { ...signed("maya", 27), ...counter(26) }, 28),
    rec("maya", SAFETY, "safety", "countersigned", { ...signed("maya", 27), ...counter(26) }, 28),
    rec("grace", DEAL, "deal_memo", "countersigned", { ...signed("grace", 26), ...counter(25) }, 27),
    rec("grace", SAFETY, "safety", "countersigned", { ...signed("grace", 26), ...counter(25) }, 27),
    rec("ethan", DEAL, "deal_memo", "countersigned", { ...signed("ethan", 19), ...counter(18) }, 21),
    rec("ethan", SAFETY, "safety", "countersigned", { ...signed("ethan", 19), ...counter(18) }, 21),
    rec("sofia", CONTRACT, "deal_memo", "countersigned", { ...signed("sofia", 15), ...counter(14) }, 16),
    rec("liam", DEAL, "deal_memo", "awaiting_countersignature", signed("liam", 1), 13),
    rec("liam", SAFETY, "safety", "countersigned", { ...signed("liam", 11), ...counter(10) }, 13),
    rec("noah", DEAL, "deal_memo", "awaiting_signature", { reject_reason: "Please sign with your full legal name, as it appears on your SIN." }, 7),
    rec("noah", SAFETY, "safety", "countersigned", { ...signed("noah", 6), ...counter(5) }, 7),
    rec("priya", DEAL, "deal_memo", "awaiting_signature", {}, 0),
    rec("priya", SAFETY, "safety", "awaiting_signature", {}, 0),
  ]), "Adding deal memos");

  // 7. Timesheets: weekdays 7:00 to 18:30 with a 30-minute lunch (11 hours, 1 of it overtime).
  const sheet = (key: string, weeksBack: number) => {
    const ws = weekStart(weeksBack), kit = !!person(key).kit;
    const entries = [1, 2, 3, 4, 5].map((i) => ({
      date: ymd(new Date(ws.getTime() + i * DAY)), day: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i],
      call: "07:00", wrap: "18:30", break_minutes: 30, kit, minutes: 660, ot15: 1,
    }));
    return { ws, entries, hours: 55, kitDays: kit ? 5 : 0 };
  };
  const addSheet = async (key: string, weeksBack: number, status: string, deptStatus: string, reviewer: string | null, i: number) => {
    const p = person(key), s = sheet(key, weeksBack);
    const path = `${uid(key)}/${Date.now() + i}-Timesheet-${ymd(s.ws)}.pdf`;
    const lines = [`Name: ${p.name}`, `Position: ${p.role} (${p.dept})`, `Week of ${fmtDay(s.ws)}`, "",
      ...s.entries.map((e) => `${e.day.padEnd(10)} ${e.call} - ${e.wrap}   30 min break   11.00 hrs`), "", `Total: ${s.hours.toFixed(2)} hours`];
    must(await admin.storage.from("timesheets").upload(path, pdf("Weekly timesheet", lines), { contentType: "application/pdf", upsert: true }), "Uploading a timesheet");
    const row = must(await admin.from("timesheets").insert({
      company_id: COMPANY_ID, user_id: uid(key), file_path: path, week_start: ymd(s.ws), entries: s.entries,
      total_hours: s.hours, kit_days: s.kitDays, signature: p.name, created_at: new Date(s.ws.getTime() + 6 * DAY).toISOString(),
    }).select("id").single(), "Adding a timesheet");
    if (status !== "pending" || deptStatus !== "pending") {
      must(await admin.from("timesheets").update({
        status, dept_status: deptStatus,
        dept_reviewed_by: reviewer ? uid(reviewer) : null, dept_reviewed_at: reviewer ? new Date(s.ws.getTime() + 7 * DAY).toISOString() : null,
      }).eq("id", row.id), "Reviewing a timesheet");
    }
  };
  await Promise.all([
    addSheet("maya", 2, "approved", "approved", "maya", 1),
    addSheet("maya", 1, "approved", "approved", "maya", 2),
    addSheet("grace", 1, "approved", "approved", "grace", 3),
    addSheet("liam", 2, "approved", "approved", "maya", 4),
    addSheet("liam", 1, "pending", "pending", null, 5),
    addSheet("ethan", 2, "approved", "approved", "grace", 6),
    addSheet("ethan", 1, "pending", "approved", "grace", 7),
    addSheet("noah", 1, "rejected", "pending", null, 8),
  ]);

  // Contractor invoices.
  const sofia = person("sofia");
  for (const [n, number, days, status] of [[1, "SM-1001", 13, "approved"], [2, "SM-1002", 2, "pending"]] as const) {
    const lines = [{ desc: "Costume design, weekly fee", qty: 1, rate: 2800, amount: 2800 }, { desc: "Fabric and fittings", qty: 1, rate: 340, amount: 340 }];
    const inv = {
      number, date: ymd(daysFrom(-days)), period: `Week ${n}`, lines, subtotal: 3140, taxPct: 5, tax: 157, total: 3297,
      taxNo: "123456789RT0001", notes: "Thank you!", name: sofia.name, email: sofia.email, company: "Silver Harbour",
    };
    const path = `${uid("sofia")}/${Date.now() + n}-Invoice-${number}.pdf`;
    must(await admin.storage.from("timesheets").upload(path, pdf(`Invoice ${number}`, [
      `From: ${sofia.name}`, "To: Silver Harbour", `Date: ${inv.date}`, "",
      ...lines.map((l) => `${l.desc}: $${l.amount.toFixed(2)}`), "GST (5%): $157.00", "Total: $3,297.00",
    ]), { contentType: "application/pdf", upsert: true }), "Uploading an invoice");
    const row = must(await admin.from("timesheets").insert({
      company_id: COMPANY_ID, user_id: uid("sofia"), file_path: path, entries: { invoice: inv }, created_at: ago(days),
    }).select("id").single(), "Adding an invoice");
    if (status === "approved") must(await admin.from("timesheets").update({ status }).eq("id", row.id), "Approving an invoice");
  }

  // 8. Paystubs for the week everyone was paid.
  const paid = weekStart(2);
  await Promise.all(["maya", "grace", "liam", "ethan"].map(async (key, i) => {
    const p = person(key);
    const path = `${uid(key)}/${Date.now() + i}-Paystub-${ymd(paid)}.pdf`;
    must(await admin.storage.from("paystubs").upload(path, pdf("Pay statement", [
      `Employee: ${p.name}`, `Pay period: week of ${fmtDay(paid)}`, "", "Regular hours: 50.00", "Overtime (1.5x): 5.00",
      ...(p.kit ? [`Kit rental: 5 days x $${p.kit.toFixed(2)}`] : []), "", "Deposited to the account on file.",
    ]), { contentType: "application/pdf", upsert: true }), "Uploading a paystub");
    must(await admin.from("paystubs").insert({ company_id: COMPANY_ID, user_id: uid(key), file_path: path, created_at: ago(5, 16) }), "Adding a paystub");
  }));

  // 9. Announcements, and the notifications that came with them.
  const members = PEOPLE.filter((p) => !p.invitedOnly);
  const announce = async (authorKey: string, title: string, body: string, depts: string[] | null, days: number) => {
    const to = members.filter((p) => p.key !== authorKey && (!depts || depts.includes(p.dept)));
    const a = must(await admin.from("announcements").insert({
      company_id: COMPANY_ID, author_id: uid(authorKey), author_name: person(authorKey).name, title, body,
      departments: depts, recipient_count: to.length, created_at: ago(days, 12),
    }).select("id").single(), "Posting an announcement");
    must(await admin.from("notifications").insert(to.map((p) => ({
      user_id: uid(p.key), company_id: COMPANY_ID, kind: "announcement", title, body, announcement_id: a.id,
      created_at: ago(days, 12), read_at: days > 3 ? ago(days - 1) : null,
    }))), "Notifying crew");
  };
  await announce("admin", "Welcome to Silver Harbour", "Thanks for joining us! Please finish your paperwork in the portal before your first day: sign your deal memo, then upload your ID, void cheque and SIN.", null, 25);
  await announce("admin", "Call time change on Thursday", "Thursday's call moves to 6:00 AM for the harbour sunrise scenes. Breakfast is served from 5:15 AM at basecamp.", null, 1);
  await announce("maya", "Camera prep day", "Camera team: prep at the rental house on Monday at 8:00 AM. Bring your own tools and a sharpie.", ["Camera"], 2);
  must(await admin.from("notifications").insert({
    user_id: adminId, company_id: COMPANY_ID, kind: "deal_signed", title: "Ready to countersign",
    body: "Liam O'Connor signed their deal memo.", view: "admin:countersign", created_at: ago(1, 9),
  }), "Notifying the admin");

  must(await admin.from("demo_settings").update({ last_reset_at: new Date().toISOString() }).eq("id", 1), "Recording the reset");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const termsVersion = String(body.termsVersion ?? "").slice(0, 40);

    const { data: settings } = await admin.from("demo_settings").select("enabled, last_reset_at").eq("id", 1).maybeSingle();
    if (!settings?.enabled) return json({ error: "The demo is turned off." }, 403);

    if (action === "people") {
      return json({ people: PEOPLE.map(({ email, name, role, dept, stage, admin: a, invitedOnly }) => ({ email, name, role, dept, stage, admin: !!a, invitedOnly: !!invitedOnly })) });
    }

    if (action === "login") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!PEOPLE.some((p) => p.email === email)) return json({ error: "That isn't one of the demo accounts." }, 400);
      // First use: build the demo production.
      const { data: co } = await admin.from("companies").select("id").eq("id", COMPANY_ID).maybeSingle();
      if (!co || !settings.last_reset_at) await reset(admin, termsVersion);
      const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (error || !link?.properties?.hashed_token) throw error ?? new Error("Couldn't start the session.");
      return json({ tokenHash: link.properties.hashed_token });
    }

    if (action === "reset") {
      const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: { user } } = await asCaller.auth.getUser();
      if (!user || !String(user.email ?? "").toLowerCase().endsWith(`@${DOMAIN}`)) {
        return json({ error: "Only demo accounts can reset the demo." }, 403);
      }
      if (!termsVersion) return json({ error: "Missing terms version." }, 400);
      await reset(admin, termsVersion);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
