// ---- Admin: onboarding tracker & reminders ----
// Everyone at the production in one list: where they are in onboarding, what they still owe and
// when they were last reminded. Reminders are emailed (and posted as a notification) by the
// send-reminder Edge Function, which works out the items itself.
const REMINDER_FUNCTION = "send-reminder";
const REMIND_GAP_HOURS = 12;  // matches supabase/functions/send-reminder
const OT_STAGES = ["Invited, not signed in", ...Object.values(STAGE_OF), "Fully onboarded"];
const WAITING_ON_ADMIN = new Set([STAGE_OF.approved, STAGE_OF.countersigned]);
let otRows = [];
let otFilter = { stage: "", dept: "", q: "" };

const todoText = (t) => (t.kind === "sign" ? "Sign: " : t.kind === "reupload" ? "Upload again: " : "Upload: ") + t.label;
const remindedRecently = (r) => r.lastReminded && Date.now() - new Date(r.lastReminded).getTime() < REMIND_GAP_HOURS * 3600e3;

// Before the onboarding_reminders migration is applied (previews), work the items out here instead.
function clientTodo(invite, docs, recs, userId) {
  const mine = docs.filter((d) => d.user_id === userId && d.doc_type);
  const todo = realDocs(invite && invite.requested_documents)
    .filter((d) => !mine.some((x) => x.doc_type === d && x.status !== "rejected"))
    .map((d) => ({ kind: mine.some((x) => x.doc_type === d) ? "reupload" : "upload", label: d }));
  recs.filter((r) => r.user_id === userId && r.status === "awaiting_signature").forEach((r) => {
    const t = allTemplates.find((x) => x.id === r.template_id);
    todo.push({ kind: "sign", label: t ? t.name : r.type === "safety" ? "Safety acknowledgment" : "Deal memo" });
  });
  return todo;
}

async function loadOutstanding() {
  const listEl = document.getElementById("outList");
  if (!listEl || !isAdmin) return;
  const [status, invites, profs, roles] = await Promise.all([
    client.rpc("crew_onboarding_status"),
    client.from("company_invites").select("id, email, full_name, crew_role, department, start_date, end_date, kit_fee_enabled, kit_fee_rate, requested_documents, used, created_at"),
    client.from("profiles").select("user_id, email"),
    client.from("user_roles").select("user_id, role"),
  ]);
  let progress = status.data;
  if (status.error) {
    const [old, docs, recs] = await Promise.all([
      client.rpc("crew_onboarding"),
      client.from("documents").select("user_id, doc_type, status"),
      client.from("esign_records").select("user_id, template_id, type, status"),
    ]);
    const invByUser = new Map((profs.data || []).map((p) => [p.user_id, (invites.data || []).find((i) => i.email === String(p.email).toLowerCase())]));
    progress = (old.data || []).map((r) => ({ ...r, todo: clientTodo(invByUser.get(r.user_id), docs.data || [], recs.data || [], r.user_id), last_reminded_at: null, reminders: 0 }));
  }

  const profileById = new Map((profs.data || []).map((p) => [p.user_id, p]));
  const inviteByEmail = new Map((invites.data || []).map((i) => [i.email, i]));
  const roleById = new Map((roles.data || []).map((r) => [r.user_id, r.role]));
  otRows = [];
  for (const r of progress || []) {
    if ((r.steps || []).length < 2) continue;  // nothing to onboard (e.g. admins without an invite)
    const p = profileById.get(r.user_id);
    if (!p) continue;
    const invite = inviteByEmail.get(String(p.email).toLowerCase());
    const next = r.steps.find((s) => !s.done);
    otRows.push({
      userId: r.user_id, profile: p, invite, role: roleById.get(r.user_id) || "employee",
      name: (invite && invite.full_name) || p.email, dept: (invite && invite.department) || "",
      steps: r.steps, todo: r.todo || [], lastReminded: r.last_reminded_at, reminders: r.reminders || 0,
      stage: next ? STAGE_OF[next.key] : "Fully onboarded",
    });
  }
  for (const i of invites.data || []) {
    if (i.used) continue;
    otRows.push({ invite: i, name: i.full_name || i.email, dept: i.department || "", todo: [], stage: OT_STAGES[0] });
  }
  otRows.sort((a, b) => OT_STAGES.indexOf(a.stage) - OT_STAGES.indexOf(b.stage) || a.name.localeCompare(b.name));
  renderOutstandingFilters();
  renderOutstanding();
}

function renderOutstandingFilters() {
  const depts = [...new Set(otRows.map((r) => r.dept).filter(Boolean))].sort();
  const deptSel = document.getElementById("outDept");
  if (otFilter.dept && !depts.includes(otFilter.dept)) otFilter.dept = "";
  deptSel.innerHTML = `<option value="">All departments</option>` + depts.map((d) => `<option${d === otFilter.dept ? " selected" : ""}>${escHtml(d)}</option>`).join("");
  const counts = new Map(OT_STAGES.map((s) => [s, 0]));
  otRows.forEach((r) => counts.set(r.stage, counts.get(r.stage) + 1));
  document.getElementById("outStages").innerHTML =
    `<button type="button" class="ot-stage${otFilter.stage ? "" : " on"}" data-stage="">Everyone <b>${otRows.length}</b></button>` +
    OT_STAGES.map((s) => `<button type="button" class="ot-stage${otFilter.stage === s ? " on" : ""}${counts.get(s) ? "" : " zero"}" data-stage="${escHtml(s)}">${escHtml(s)} <b>${counts.get(s)}</b></button>`).join("");
}

const otVisible = () => {
  const q = otFilter.q.trim().toLowerCase();
  return otRows.filter((r) => (!otFilter.stage || r.stage === otFilter.stage) && (!otFilter.dept || r.dept === otFilter.dept)
    && (!q || r.name.toLowerCase().includes(q) || String((r.invite && r.invite.email) || (r.profile && r.profile.email) || "").toLowerCase().includes(q)));
};
const otRemindable = (rows) => rows.filter((r) => r.userId && r.todo.length && !remindedRecently(r));

function renderOutstanding() {
  const listEl = document.getElementById("outList");
  const rows = otVisible();
  document.getElementById("outEmpty").classList.toggle("hidden", rows.length > 0);
  document.getElementById("outEmpty").textContent = otRows.length ? "No one matches these filters." : "No crew yet. Invite people to start onboarding.";
  document.querySelectorAll("#outStages .ot-stage").forEach((b) => b.classList.toggle("on", b.dataset.stage === otFilter.stage));
  const all = document.getElementById("outRemindAll"), n = otRemindable(rows).length;
  all.textContent = n ? `Remind ${n === rows.length ? "everyone" : n} with items outstanding` : "Remind everyone with items outstanding";
  all.disabled = !n;

  listEl.innerHTML = "";
  rows.forEach((r) => {
    const li = document.createElement("li");
    li.className = "ot-row";
    const sub = r.invite ? [r.invite.crew_role, r.dept].filter(Boolean).map(escHtml).join(" · ") : escHtml(r.profile.email);
    let detail;
    if (!r.userId) detail = `<span class="ot-note">Invited ${escHtml(ntAgo(r.invite.created_at))}, hasn't signed in yet</span>`;
    else if (r.todo.length) detail = `<ul class="ot-todo">${r.todo.map((t) => `<li class="ot-${t.kind}">${escHtml(todoText(t))}</li>`).join("")}</ul>`;
    else if (WAITING_ON_ADMIN.has(r.stage)) detail = `<span class="ot-note ot-you">Waiting on you: ${escHtml(r.stage.toLowerCase())}</span>`;
    else detail = "";
    li.innerHTML = `<span class="info">
        <button type="button" class="name ot-name">${escHtml(r.name)}</button>
        <span class="email">${sub || escHtml(r.invite ? r.invite.email : "")}</span>
        ${r.steps ? onboardingBarHtml(r.steps) : ""}
        ${detail}
      </span>
      <span class="actions"></span>`;
    const actions = li.querySelector(".actions");
    if (r.userId) {
      li.querySelector(".ot-name").addEventListener("click", () => openEmployeeModal(r.profile, r.role, r.invite));
      if (r.lastReminded) {
        const when = document.createElement("span");
        when.className = "ot-when";
        when.textContent = `Reminded ${ntAgo(r.lastReminded)}${r.reminders > 1 ? ` (${r.reminders}×)` : ""}`;
        actions.appendChild(when);
      }
      if (r.todo.length) {
        const remind = document.createElement("button");
        remind.className = "preview-link"; remind.dataset.nobusy = "";
        remind.textContent = "Email reminder";
        remind.disabled = remindedRecently(r);
        if (remind.disabled) remind.title = `Already reminded in the last ${REMIND_GAP_HOURS} hours`;
        remind.addEventListener("click", () => sendReminders([r], remind));
        actions.appendChild(remind);
        actions.appendChild(copyReminderButton(r));
      }
    } else {
      li.querySelector(".ot-name").disabled = true;
      const resend = document.createElement("button");
      resend.className = "preview-link"; resend.dataset.nobusy = "";
      resend.textContent = "Resend invite";
      resend.addEventListener("click", async () => {
        resend.disabled = true;
        const res = await dispatchInviteEmail(r.invite);
        resend.textContent = res.sent ? "Sent" : "Couldn't send";
        if (!res.sent) otMessage("error", `Couldn't email ${r.invite.email}${res.error ? ": " + res.error : ""}. Use Copy invite instead.`);
      });
      const copy = document.createElement("button");
      copy.className = "preview-link"; copy.textContent = "Copy invite";
      copy.addEventListener("click", () => copyInviteMessage(r.invite, copy));
      actions.appendChild(resend); actions.appendChild(copy);
    }
    const badge = document.createElement("span");
    badge.className = `status-badge status-${r.stage === "Fully onboarded" ? "approved" : r.todo.length || !r.userId ? "pending" : "approved"}`;
    badge.textContent = r.stage === "Fully onboarded" ? "done" : !r.userId ? "invited" : r.todo.length ? "waiting on crew" : "waiting on you";
    actions.appendChild(badge);
    listEl.appendChild(li);
  });
}

function copyReminderButton(r) {
  const btn = document.createElement("button");
  btn.className = "preview-link"; btn.textContent = "Copy";
  btn.title = "Copy a reminder to paste into your own email or text";
  btn.addEventListener("click", () => {
    const msg = `Hi ${(r.invite && r.invite.full_name) || ""},\n\nA quick reminder: we still need the following from you on the HR Intake Portal:\n${r.todo.map((t) => "- " + todoText(t)).join("\n")}\n\nYou can finish these at ${PORTAL_URL}\n\nThanks!`;
    const done = () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1600); };
    try { navigator.clipboard.writeText(msg).then(done, () => window.prompt("Copy this reminder:", msg)); } catch (_) { window.prompt("Copy this reminder:", msg); }
  });
  return btn;
}

function otMessage(kind, text) {
  document.getElementById("outMsg").innerHTML = text ? `<div class="msg ${kind}">${escHtml(text)}</div>` : "";
}

async function sendReminders(rows, btn) {
  if (!rows.length || !currentCompany) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = rows.length > 1 ? `Sending ${rows.length}…` : "Sending…";
  otMessage("", "");
  let data, error;
  try {
    ({ data, error } = await client.functions.invoke(REMINDER_FUNCTION, { body: { companyId: currentCompany.id, userIds: rows.map((r) => r.userId) } }));
    if (error && error.context && typeof error.context.json === "function") {
      try { const b = await error.context.json(); if (b && b.error) error = { message: b.error }; } catch (_) { /* keep generic */ }
    }
  } catch (e) { error = e; }
  if (error || !data || !data.results) {
    btn.disabled = false; btn.textContent = label;
    otMessage("error", `Couldn't send reminders: ${(error && error.message) || (data && data.error) || "no reply"}. Use Copy to send one yourself.`);
    return;
  }
  const res = data.results;
  const sent = res.filter((x) => x.status === "sent"), emailed = sent.filter((x) => x.emailed);
  const failed = sent.filter((x) => !x.emailed).map((x) => (otRows.find((r) => r.userId === x.userId) || {}).name).filter(Boolean);
  const parts = [];
  if (emailed.length) parts.push(`Emailed ${emailed.length} ${emailed.length === 1 ? "person" : "people"}.`);
  if (failed.length) parts.push(`${failed.join(", ")} got an in-app notification, but the email didn't go out (${sent.find((x) => !x.emailed).error || "unknown error"}). Use Copy to send it yourself.`);
  if (res.some((x) => x.status === "recent")) parts.push(`Skipped anyone reminded in the last ${REMIND_GAP_HOURS} hours.`);
  if (res.some((x) => x.status === "nothing")) parts.push("Skipped anyone who's already caught up.");
  if (res.some((x) => x.status === "error")) parts.push(`${res.filter((x) => x.status === "error").length} couldn't be reminded.`);
  otMessage(failed.length || !sent.length ? "error" : "ok", parts.join(" ") || "Nothing to send.");
  await loadOutstanding();
}

document.getElementById("outRefreshBtn").addEventListener("click", loadOutstanding);
document.getElementById("outStages").addEventListener("click", (e) => {
  const b = e.target.closest("[data-stage]");
  if (!b) return;
  otFilter.stage = b.dataset.stage;
  renderOutstanding();
});
document.getElementById("outDept").addEventListener("change", (e) => { otFilter.dept = e.target.value; renderOutstanding(); });
document.getElementById("outSearch").addEventListener("input", (e) => { otFilter.q = e.target.value; renderOutstanding(); });
document.getElementById("outRemindAll").addEventListener("click", (e) => {
  const rows = otRemindable(otVisible());
  if (!rows.length) return;
  if (!window.confirm(`Email a reminder to ${rows.length} ${rows.length === 1 ? "person" : "people"} listing what they still owe? They'll also see it as a notification in the portal.`)) return;
  sendReminders(rows, e.currentTarget);
});
