// ---- Super admin: companies and their admins ----
// Everything here goes through database functions that re-check the
// caller is a super admin (see add-superadmin.sql).
let isSuperadmin = false;


// ---- Audit log (super admin) ----
async function loadAuditLog() {
  const body = document.getElementById("auditBody"), msgEl = document.getElementById("auditMsg");
  if (!body) return;
  const sel = document.getElementById("auditTable");
  let q = client.from("audit_log").select("*").order("at", { ascending: false }).limit(150);
  if (sel.value) q = q.eq("table_name", sel.value);
  const { data, error } = await q;
  body.innerHTML = "";
  if (error) { msgEl.innerHTML = `<div class="msg error">${/audit_log/.test(error.message) ? "The audit log isn't set up yet. Run add-audit-log.sql in Supabase." : escHtml(error.message)}</div>`; return; }
  msgEl.innerHTML = data.length ? "" : `<div class="msg">No activity recorded yet.</div>`;
  if (sel.options.length < 2) [...new Set(data.map((r) => r.table_name))].sort().forEach((t) => sel.add(new Option(t.replace(/_/g, " "), t)));
  data.forEach((r) => {
    const tr = document.createElement("tr");
    [new Date(r.at).toLocaleString(), r.actor_email || "system", r.table_name.replace(/_/g, " "), r.action, r.summary || (r.changed || []).slice(0, 4).join(", ")]
      .forEach((t) => { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
    body.appendChild(tr);
  });
}
document.getElementById("auditRefreshBtn").addEventListener("click", loadAuditLog);
document.getElementById("auditTable").addEventListener("change", loadAuditLog);

async function loadSuperadminStatus() {
  const { data } = await client.from("superadmins").select("user_id").eq("user_id", currentUserId).maybeSingle();
  isSuperadmin = !!data;
  tabSuperBtn.classList.toggle("hidden", !isSuperadmin);
  if (isSuperadmin) { loadSuperOverview(); loadAuditLog(); }
}

function copyAdminInvite(companyName, email, btn) {
  const message =
    `You've been invited to administer ${companyName} on the HR Intake Portal.\n\n` +
    `Create your account here (use this email address, ${email}):\n${inviteLink(email)}\n\n` +
    `Then confirm your email to get started.`;
  const done = () => { const t = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = t; }, 1600); };
  try { navigator.clipboard.writeText(message).then(done, () => window.prompt("Copy this invite:", message)); }
  catch (e) { window.prompt("Copy this invite:", message); }
}

async function loadOrphans() {
  const listEl = document.getElementById("saOrphansList");
  const msgEl = document.getElementById("saOrphansMsg");
  listEl.innerHTML = "";
  msgEl.innerHTML = `<div class="msg ok">Checking…</div>`;
  const { data, error } = await client.functions.invoke("delete-user", { body: { action: "list-orphans" } });
  if (error || (data && data.error)) {
    let detail = (data && data.error) || (error && error.message) || "";
    if (error && error.context && typeof error.context.json === "function") { try { const b = await error.context.json(); if (b && b.error) detail = b.error; } catch (_) {} }
    msgEl.innerHTML = `<div class="msg error">Couldn't check: ${escHtml(detail)}. If this says the function doesn't understand it, redeploy the delete-user function with the newest code.</div>`;
    return;
  }
  const rows = data.orphans || [];
  msgEl.innerHTML = rows.length ? "" : `<div class="msg ok">No unassigned accounts. Everyone belongs to a company.</div>`;
  rows.forEach((u) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="info"><span class="name">${escHtml(u.email || u.id)}</span><span class="email">Created ${escHtml((u.created_at || "").slice(0, 10))}</span></span>`;
    const right = document.createElement("span"); right.className = "actions";
    const del = document.createElement("button"); del.className = "remove-link"; del.textContent = "Delete account";
    del.addEventListener("click", async () => {
      if (!window.confirm(`Permanently delete ${u.email || u.id} and everything it uploaded? This can't be undone.`)) return;
      del.disabled = true;
      const r = await client.functions.invoke("delete-user", { body: { action: "delete-orphan", userId: u.id } });
      if (r.error || (r.data && r.data.error)) { del.disabled = false; msgEl.innerHTML = `<div class="msg error">Couldn't delete ${escHtml(u.email || "")}${r.data && r.data.error ? ": " + escHtml(r.data.error) : ""}.</div>`; return; }
      loadOrphans();
    });
    right.appendChild(del); li.appendChild(right); listEl.appendChild(li);
  });
}
document.getElementById("saOrphansBtn").addEventListener("click", loadOrphans);

async function loadSuperOverview() {
  const listEl = document.getElementById("saCompaniesList");
  const emptyEl = document.getElementById("saCompaniesEmpty");
  const msgEl = document.getElementById("saMsg");
  const { data, error } = await client.rpc("superadmin_overview");
  let myEmail = "";
  try { const { data: u } = await client.auth.getUser(); myEmail = ((u && u.user && u.user.email) || "").toLowerCase(); } catch (_) {}
  listEl.innerHTML = "";
  if (error) { msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
  const companies = data || [];
  emptyEl.classList.toggle("hidden", companies.length > 0);

  companies.forEach((c) => {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.className = "info";
    const chips = [
      ...c.admins.map((a) => `<span class="sa-chip">${escHtml(a.email)}${a.email.toLowerCase() === myEmail ? "" : `<button type="button" data-remove="${escHtml(a.email)}">Remove</button>`}</span>`),
      ...c.pending.map((a) => `<span class="sa-chip pending">${escHtml(a.email)} · invited<button type="button" data-resend="${escHtml(a.email)}">Resend email</button><button type="button" data-copy="${escHtml(a.email)}">Copy invite</button><button type="button" data-remove="${escHtml(a.email)}">Remove</button></span>`),
    ].join("");
    left.innerHTML = `<span class="name">${escHtml(c.name)}</span><span class="email">${c.member_count} ${c.member_count === 1 ? "person" : "people"} · ${c.admins.length} admin${c.admins.length === 1 ? "" : "s"}</span><span>${chips || '<span class="email">No admins yet</span>'}</span>`;
    left.querySelectorAll("button[data-copy]").forEach((b) =>
      b.addEventListener("click", () => copyAdminInvite(c.name, b.dataset.copy, b))
    );
    left.querySelectorAll("button[data-remove]").forEach((b) =>
      b.addEventListener("click", async () => {
        const email = b.dataset.remove;
        const pending = c.pending.some((a) => a.email === email);
        const ask = pending
          ? `Cancel the pending admin invite for ${email} at ${c.name}?`
          : `Remove ${email} as an admin of ${c.name}?\n\nIf ${c.name} is the only company on their account, the whole account is deleted so that address can sign up again from scratch. Uploads and timesheets already on file are kept.`;
        if (!window.confirm(ask)) return;
        b.disabled = true;
        const { data: result, error: rmErr } = await client.rpc("superadmin_remove_admin", { p_company: c.id, p_email: email });
        const msgBox = document.getElementById("saMsg");
        if (rmErr) { b.disabled = false; msgBox.innerHTML = `<div class="msg error">${escHtml(rmErr.message)}</div>`; return; }
        const text = result === "deleted" ? `${email} was removed and their account deleted.`
          : result === "removed" ? `${email} was removed from ${c.name} and keeps their other company.`
          : `The pending invite for ${email} was cancelled.`;
        msgBox.innerHTML = `<div class="msg ok">${escHtml(text)}</div>`;
        loadSuperOverview();
      })
    );
    left.querySelectorAll("button[data-resend]").forEach((b) =>
      b.addEventListener("click", async () => {
        const email = b.dataset.resend;
        const label = b.textContent;
        b.disabled = true; b.textContent = "Sending…";
        const r = await dispatchInviteEmail({ email });
        b.disabled = false; b.textContent = label;
        document.getElementById("saMsg").innerHTML = r.sent
          ? `<div class="msg ok">Invite emailed to ${escHtml(email)}.</div>`
          : `<div class="msg error">Couldn't send the email to ${escHtml(email)}: ${escHtml(r.error || "unknown error")}. Use Copy invite instead.</div>`;
      })
    );

    const right = document.createElement("span");
    right.className = "actions";
    const toggle = document.createElement("button");
    toggle.className = "preview-link";
    toggle.textContent = "Add admin";
    right.appendChild(toggle);
    const del = document.createElement("button");
    del.className = "preview-link";
    del.textContent = "Delete company";
    if (c.admins.length) {
      del.disabled = true;
      del.style.opacity = "0.45";
      del.title = "Remove every admin first. A company can only be deleted when it has none.";
    } else {
      del.addEventListener("click", async () => {
        const pend = c.pending.length ? ` Its ${c.pending.length} pending admin invite${c.pending.length === 1 ? "" : "s"} will be cancelled too.` : "";
        if (!window.confirm(`Delete ${c.name}?${pend}\n\nThis can't be undone.`)) return;
        del.disabled = true;
        const { error: dErr } = await client.rpc("superadmin_delete_company", { p_company: c.id });
        const box = document.getElementById("saMsg");
        if (dErr) { del.disabled = false; box.innerHTML = `<div class="msg error">${escHtml(dErr.message)}</div>`; return; }
        box.innerHTML = `<div class="msg ok">${escHtml(c.name)} was deleted.</div>`;
        loadSuperOverview();
      });
    }
    right.appendChild(del);

    const extra = document.createElement("div");
    extra.className = "sa-company-extra hidden";
    extra.innerHTML = `
      <div><label>Name</label><input type="text" class="sa-n" placeholder="Jordan Lee" /></div>
      <div><label>Email</label><input type="email" class="sa-e" placeholder="admin@company.com" /></div>
      <button class="btn-secondary">Send invite</button>`;
    toggle.addEventListener("click", () => extra.classList.toggle("hidden"));
    extra.querySelector("button").addEventListener("click", async () => {
      const name = extra.querySelector(".sa-n").value.trim();
      const email = extra.querySelector(".sa-e").value.trim();
      if (!name || !email) { msgEl.innerHTML = `<div class="msg error">Enter the admin's name and email.</div>`; return; }
      const { data: outcome, error: e2 } = await client.rpc("superadmin_invite_admin", { p_company: c.id, p_email: email, p_name: name });
      if (e2) { msgEl.innerHTML = `<div class="msg error">${escHtml(e2.message)}</div>`; return; }
      if (outcome === "added") {
        msgEl.innerHTML = `<div class="msg ok">${escHtml(email)} already has an account and is now an admin of ${escHtml(c.name)}. They switch to it from the picker in the header.</div>`;
      } else {
        const r = await dispatchInviteEmail({ email });
        msgEl.innerHTML = r.sent
          ? `<div class="msg ok">Invite emailed to ${escHtml(email)}.</div>`
          : `<div class="msg ok">Invite created for ${escHtml(email)}${r.error ? `, but the email didn't send (${escHtml(r.error)})` : ""}. Use "Copy invite" to send it.</div>`;
      }
      loadSuperOverview();
    });

    li.appendChild(left);
    li.appendChild(right);
    li.appendChild(extra);
    listEl.appendChild(li);
  });
}

document.getElementById("saCreateBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("saMsg");
  const btn = document.getElementById("saCreateBtn");
  const name = document.getElementById("saCompanyName").value.trim();
  const adminName = document.getElementById("saAdminName").value.trim();
  const adminEmail = document.getElementById("saAdminEmail").value.trim();
  if (!name || !adminName || !adminEmail) {
    msgEl.innerHTML = `<div class="msg error">Fill in the company name and the first admin's name and email.</div>`;
    return;
  }
  btn.disabled = true;
  const { data: outcome, error } = await client.rpc("superadmin_create_company", { p_name: name, p_admin_email: adminEmail, p_admin_name: adminName });
  btn.disabled = false;
  if (error) { msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
  if (outcome === "added") {
    msgEl.innerHTML = `<div class="msg ok">${escHtml(name)} created. ${escHtml(adminEmail)} already has an account and can switch to it from the picker in the header.</div>`;
  } else {
    const r = await dispatchInviteEmail({ email: adminEmail });
    msgEl.innerHTML = r.sent
      ? `<div class="msg ok">${escHtml(name)} created and the invite was emailed to ${escHtml(adminEmail)}.</div>`
      : `<div class="msg ok">${escHtml(name)} created${r.error ? `, but the invite email didn't send (${escHtml(r.error)})` : ""}. Use Copy invite below to send it to ${escHtml(adminEmail)}.</div>`;
  }
  ["saCompanyName", "saAdminName", "saAdminEmail"].forEach((id) => { document.getElementById(id).value = ""; });
  loadSuperOverview();
});
