// ---- Admin: profile map (user_id -> email) ----
async function loadProfileMap() {
  const { data: rows } = await client.from("profiles").select("user_id, email");
  profileMap = new Map((rows || []).map((r) => [r.user_id, r.email]));
}

// ---- Admin: employees (onboarded accounts) ----
// Fully deletes the person's Supabase Auth account via a server-side
// Edge Function named "delete-user" — see the deployment instructions
// for that function's code. The function itself re-checks that the
// caller is an admin in the same company before it will act, so this
// isn't relying on the client alone for that safety check.
async function deleteAuthAccount(userId, purge) {
  try {
    const { data, error } = await client.functions.invoke("delete-user", {
      body: { userId, purge: !!purge },
    });
    if (error) {
      // client.functions.invoke() only gives a generic message by default
      // ("Edge Function returned a non-2xx status code") — the function's
      // actual JSON error body is on error.context, so pull the real
      // reason out of there when it's available.
      let detail = error.message;
      if (error.context && typeof error.context.json === "function") {
        try {
          const body = await error.context.json();
          if (body && body.error) detail = body.error;
        } catch (parseErr) {
          // response wasn't JSON — stick with the generic message
        }
      }
      return { deleted: false, error: detail };
    }
    if (data && data.error) return { deleted: false, error: data.error };
    return { deleted: true };
  } catch (e) {
    return { deleted: false, error: String(e) };
  }
}

// Progress bar for someone's onboarding steps (from crew_onboarding / onboarding_steps).
function onboardingBarHtml(steps) {
  const real = (steps || []).length > 1;
  if (!real) return `<span class="ob-progress none">No onboarding steps</span>`;
  const done = steps.filter((s) => s.done).length;
  const full = done === steps.length;
  return `<span class="ob-progress${full ? " full" : ""}" title="${escHtml(steps.map((s) => (s.done ? "✓ " : "○ ") + s.label).join("\n"))}">
    <span class="ob-segs">${steps.map((s) => `<i class="${s.done ? "on" : ""}"></i>`).join("")}</span>
    <span class="ob-progress-label">${full ? "Fully onboarded" : `${done} of ${steps.length} steps · next: ${escHtml(steps.find((s) => !s.done).label.toLowerCase())}`}</span>
  </span>`;
}

let employeeOnboarding = new Map();
async function loadEmployees() {
  const listEl = document.getElementById("employeesList");
  const emptyEl = document.getElementById("employeesEmpty");
  listEl.innerHTML = "";

  const [{ data: profiles }, { data: roles }, { data: invites }, { data: progress }] = await Promise.all([
    client.from("profiles").select("user_id, email"),
    client.from("user_roles").select("user_id, role"),
    client.from("company_invites").select("email, full_name, crew_role, department, start_date, end_date, kit_fee_enabled, kit_fee_rate, requested_documents").eq("used", true),
    client.rpc("crew_onboarding"),
  ]);

  if (!profiles || profiles.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  const roleMap = new Map((roles || []).map((r) => [r.user_id, r.role]));
  const inviteMap = new Map((invites || []).map((i) => [i.email, i]));
  employeeOnboarding = new Map((progress || []).map((r) => [r.user_id, r]));

  // People still onboarding first (least far along at the top), then everyone who's finished,
  // then people with nothing to do; by name within each.
  const nameOf = (p) => (inviteMap.get(p.email) && inviteMap.get(p.email).full_name) || p.email;
  const rank = (p) => {
    const st = (employeeOnboarding.get(p.user_id) || {}).steps || [];
    if (st.length < 2) return 2;
    const done = st.filter((s) => s.done).length;
    return done === st.length ? 1 : done / st.length;
  };
  profiles.sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));

  for (const p of profiles) {
    const li = document.createElement("li");
    li.className = "employee-row";
    const left = document.createElement("span");
    left.className = "info";

    const accessRole = roleMap.get(p.user_id) || "employee";
    const invite = inviteMap.get(p.email);
    let subtitle = escHtml(p.email);
    if (invite) {
      const kitBit = invite.kit_fee_enabled ? ` · <span class="kit-tag">$${Number(invite.kit_fee_rate || 0).toFixed(2)}/day kit</span>` : "";
      subtitle = `${escHtml(invite.crew_role || accessRole)}${invite.department ? " (" + escHtml(invite.department) + ")" : ""}${accessRole === "admin" ? " · admin" : ""}${kitBit}`;
    }

    left.innerHTML = `<span class="name">${escHtml(nameOf(p))}</span><span class="email">${subtitle}</span>${onboardingBarHtml((employeeOnboarding.get(p.user_id) || {}).steps)}`;
    left.addEventListener("click", () => openEmployeeModal(p, accessRole, invite));

    const right = document.createElement("span");
    right.className = "actions";

    const viewBtn = document.createElement("button");
    viewBtn.className = "remove-link";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => openEmployeeModal(p, accessRole, invite));
    right.appendChild(viewBtn);

    if (p.user_id === currentUserId) {
      const tag = document.createElement("span");
      tag.className = "status-badge status-approved";
      tag.textContent = "you";
      right.appendChild(tag);
    } else {
      // Another admin lets the last one leave the production or delete their account.
      const roleBtn = document.createElement("button");
      roleBtn.className = "remove-link";
      roleBtn.textContent = accessRole === "admin" ? "Remove admin" : "Make admin";
      roleBtn.addEventListener("click", () => setMemberRole(p.user_id, p.email, accessRole === "admin" ? "employee" : "admin"));
      right.appendChild(roleBtn);

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-link";
      removeBtn.textContent = "Remove access";
      removeBtn.addEventListener("click", () => removeEmployee(p.user_id, p.email));
      right.appendChild(removeBtn);
    }

    li.appendChild(left);
    li.appendChild(right);
    listEl.appendChild(li);
  }
  setupAllFilesBar();
}

async function setMemberRole(userId, email, role) {
  const msgEl = document.getElementById("employeesMsg");
  const ask = role === "admin"
    ? `Make ${email} an admin? They'll see everyone's paperwork and can manage the production. They'll need to set up two-step sign-in.`
    : `Remove ${email}'s admin access? They'll keep their crew access.`;
  if (!window.confirm(ask)) return;
  const { error } = await client.rpc("set_member_role", { p_user: userId, p_role: role });
  if (error) { msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
  msgEl.innerHTML = `<div class="msg ok">${escHtml(email)} is ${role === "admin" ? "now an admin" : "no longer an admin"}.</div>`;
  loadEmployees();
}

// ---- Admin: employee overview modal ----
let employeeModalCtx = null;
async function openEmployeeModal(profile, accessRole, invite) {
  employeeModalCtx = { profile, accessRole, invite };
  const overlay = document.getElementById("employeeModalOverlay");
  const body = document.getElementById("employeeModalBody");
  body.innerHTML = `<p class="empty">Loading…</p>`;
  overlay.classList.remove("hidden");

  const [{ data: docs }, { data: sheets }, { data: stubs }, { data: deals }] = await Promise.all([
    client.from("documents").select("id, status, file_path, created_at, doc_type").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
    client.from("timesheets").select("id, status, file_path, created_at, week_start, total_hours, entries").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
    client.from("paystubs").select("id, file_path, created_at").eq("user_id", profile.user_id).order("created_at", { ascending: false }),
    client.from("esign_records").select("id, type, status, template_id, employee_signature, employee_signed_at, final_pdf_path, revoke_reason").eq("user_id", profile.user_id),
    client.rpc("crew_onboarding").then(({ data }) => { if (data) employeeOnboarding = new Map(data.map((r) => [r.user_id, r])); }),
  ]);

  const requested = realDocs(invite && invite.requested_documents);
  const submittedTypes = new Set((docs || []).filter((d) => d.status !== "rejected" && d.doc_type).map((d) => d.doc_type));

  const checklistHtml = requested.length
    ? `<ul class="checklist">${requested.map((item) => {
        const got = submittedTypes.has(item);
        return `<li class="${got ? "got" : "missing"}"><span class="mark">${got ? "✓" : "!"}</span><span class="label">${item}</span></li>`;
      }).join("")}</ul>`
    : `<p class="empty" style="padding:0 0 16px;text-align:left;">No specific documents were requested on their invite.</p>`;

  const sheetCounts = { pending: 0, approved: 0, rejected: 0 };
  (sheets || []).forEach((s) => { if (sheetCounts[s.status] != null) sheetCounts[s.status]++; });

  const dealsHtml = (deals || []).length
    ? `<ul class="file-list">${deals.map((d) => {
        const t = allTemplates.find((tpl) => tpl.id === d.template_id);
        const kind = t ? t.name : (d.type === "deal_memo" ? "Deal memo" : "Safety acknowledgment");
        const statusLabel = d.status === "revoked" ? "revoked" : d.status === "countersigned" ? "countersigned" : d.status === "awaiting_countersignature" ? "awaiting countersignature" : "not yet signed";
        const statusClass = d.status === "revoked" ? "rejected" : d.status === "countersigned" ? "approved" : d.status === "awaiting_countersignature" ? "pending" : "rejected";
        return `<li><span class="info"><span class="name">${kind}</span><span class="email">${d.employee_signature ? `signed <span class="signature-rendered" style="font-size:15px;">${d.employee_signature}</span>` : "no signature yet"}${d.status === "revoked" && d.revoke_reason ? ` · reason: ${escHtml(d.revoke_reason)}` : ""}</span></span><span class="actions">${d.final_pdf_path ? `<button class="remove-link" data-final-path="${escHtml(d.final_pdf_path)}">Signed PDF</button>` : ""}${d.status === "revoked" ? `<button class="remove-link" data-rmrevoked="${d.id}">Remove</button>` : ""}${d.status !== "revoked" ? `<button class="remove-link" data-revoke="${d.id}" data-reissue="0">Revoke</button><button class="remove-link" data-revoke="${d.id}" data-reissue="1">Revoke &amp; reissue</button>` : ""}<span class="status-badge status-${statusClass}">${statusLabel}</span></span></li>`;
      }).join("")}</ul>`
    : `<p class="empty" style="padding:0;text-align:left;">No deal memo or safety acknowledgment assigned.</p>`;

  const kitBit = invite && invite.kit_fee_enabled ? ` · $${Number(invite.kit_fee_rate || 0).toFixed(2)}/day kit` : "";
  const dates = invite && invite.start_date ? `${invite.start_date} – ${invite.end_date || "?"}` : null;

  // Onboarding steps, as a numbered row of ticks.
  const steps = (employeeOnboarding.get(profile.user_id) || {}).steps || [];
  const stepsHtml = steps.length > 1
    ? `<ol class="ob-stepper">${steps.map((st, i) => `<li class="${st.done ? "done" : steps.findIndex((x) => !x.done) === i ? "next" : ""}"><span class="ob-dot">${st.done ? "✓" : i + 1}</span><span>${escHtml(st.label)}${st.total ? ` <em>${st.count}/${st.total}</em>` : ""}</span></li>`).join("")}</ol>`
    : `<p class="empty" style="padding:0 0 8px;text-align:left;">Nothing to complete: no documents or forms were assigned to them.</p>`;
  const onboardedAt = (employeeOnboarding.get(profile.user_id) || {}).onboarded_at;

  body.innerHTML = `
    <h2>${escHtml((invite && invite.full_name) || profile.email)}</h2>
    <p class="modal-sub">${escHtml(profile.email)} · ${invite ? `${escHtml(invite.crew_role || accessRole)}${invite.department ? " (" + escHtml(invite.department) + ")" : ""}` : accessRole}${kitBit}</p>
    <div class="summary-row">
      <span class="summary-chip">${accessRole}</span>
      ${dates ? `<span class="summary-chip">${dates}</span>` : ""}
      <span class="summary-chip">${sheetCounts.pending} timesheet${sheetCounts.pending === 1 ? "" : "s"} pending</span>
      <span class="summary-chip">${(stubs || []).length} paystub${(stubs || []).length === 1 ? "" : "s"} issued</span>
    </div>

    <h3>Onboarding${onboardedAt ? ` <span class="status-badge status-approved">fully onboarded ${new Date(onboardedAt).toLocaleDateString()}</span>` : ""}</h3>
    ${onboardingBarHtml(steps)}
    ${stepsHtml}

    <h3>Requested documents</h3>
    ${checklistHtml}

    <h3>Deals</h3>
    ${dealsHtml}
    <div class="dept-filters" style="margin:10px 0 18px;align-items:flex-end;">
      <div style="flex:1;min-width:180px;"><label for="sendDealSelect">Send a deal memo or form</label>
        <select id="sendDealSelect">${allTemplates.map((t) => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("") || `<option value="">No templates yet</option>`}</select></div>
      <button type="button" class="btn-secondary" id="sendDealBtn"${allTemplates.length ? "" : " disabled"}>Send</button>
    </div>
    <div id="sendDealMsg"></div>

    <h3>Files</h3>
    ${fileFilterBar("efOne", true)}
  `;
  const files = await gatherFiles(profile.user_id);
  if (employeeModalCtx.profile !== profile) return;  // they opened someone else meanwhile
  const who = safeName((invite && invite.full_name) || profile.email);
  wireFileFilters(body, "efOne", () => files, {
    byPerson: false,
    zipName: ({ from, to }) => `${who} files${from || to ? ` ${from || "start"} to ${to || "today"}` : ""}.zip`,
    render: (list) => renderFileRows(body.querySelector("#efOneList"), list),
  });
}

document.getElementById("employeeModalBody").addEventListener("click", async (e) => {
  const rm = e.target.closest("[data-rmrevoked]");
  if (rm) {
    const ctx = employeeModalCtx; if (!ctx) return;
    if (!window.confirm("Remove this revoked memo from their record for good? This can't be undone.")) return;
    rm.disabled = true;
    const { data: path, error } = await client.rpc("admin_delete_revoked_deal", { p_id: rm.dataset.rmrevoked });
    if (error) {
      rm.disabled = false;
      window.alert(/admin_delete_revoked_deal|function/i.test(error.message) ? "Removing isn't set up yet. Run add-revoke-deals.sql in Supabase again (it was updated), then try again." : "Couldn't remove: " + error.message);
      return;
    }
    if (path) { try { await client.storage.from(DEAL_BUCKET).remove([path]); } catch (_) {} }
    await openEmployeeModal(ctx.profile, ctx.accessRole, ctx.invite);
    return;
  }
  const rv = e.target.closest("[data-revoke]");
  if (rv) {
    const ctx = employeeModalCtx; if (!ctx) return;
    const reissue = rv.dataset.reissue === "1";
    const reason = window.prompt(reissue ? "Why is this being revoked? A fresh copy will be sent to them to sign:" : "Why is this being revoked? They will no longer be asked to sign it:");
    if (reason === null) return;
    if (!reason.trim()) { window.alert("Please give a short reason (kept for the record)."); return; }
    rv.disabled = true;
    const { data: tid, error } = await client.rpc("admin_revoke_deal", { p_id: rv.dataset.revoke, p_reason: reason.trim() });
    if (error) {
      rv.disabled = false;
      window.alert(/admin_revoke_deal|function/i.test(error.message) ? "Revoking isn't set up yet. Run add-revoke-deals.sql in Supabase, then try again." : "Couldn't revoke: " + error.message);
      return;
    }
    let note = "Revoked.";
    if (reissue && tid) {
      const r2 = await client.rpc("admin_send_deal", { p_user: ctx.profile.user_id, p_template: tid });
      note = r2.error ? "Revoked, but the new copy couldn't be sent: " + r2.error.message : "Revoked. A new copy was sent to them.";
    }
    await openEmployeeModal(ctx.profile, ctx.accessRole, ctx.invite);
    const m3 = document.getElementById("sendDealMsg"); if (m3) m3.innerHTML = `<div class="msg ok">${escHtml(note)}</div>`;
    loadPendingCountersignatures();
    return;
  }
  const btn = e.target.closest("#sendDealBtn");
  if (!btn) return;
  const sel = document.getElementById("sendDealSelect"), msg = document.getElementById("sendDealMsg");
  const ctx = employeeModalCtx;
  if (!sel.value || !ctx) return;
  btn.disabled = true;
  const { data: res, error } = await client.rpc("admin_send_deal", { p_user: ctx.profile.user_id, p_template: sel.value });
  if (error) { btn.disabled = false; msg.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
  await openEmployeeModal(ctx.profile, ctx.accessRole, ctx.invite);
  const m2 = document.getElementById("sendDealMsg");
  if (m2) m2.innerHTML = `<div class="msg ok">${res === "already_signed" ? "They've already signed that one." : res === "resent" ? "They already had it unsigned. It's flagged again on their front page." : "Sent. It appears on their front page with a red !."}</div>`;
});

function closeEmployeeModal() {
  document.getElementById("employeeModalOverlay").classList.add("hidden");
}
document.getElementById("employeeModalClose").addEventListener("click", closeEmployeeModal);
document.getElementById("employeeModalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "employeeModalOverlay") closeEmployeeModal();
});

let removeMsgTarget = null;
async function removeEmployee(userId, email) {
  const msgEl = document.getElementById(removeMsgTarget || "employeesMsg");
  if (!window.confirm(`Remove ${email}'s portal access? If this is their only company, this deletes their account entirely — they will no longer be able to sign in at all. Their submitted documents, timesheets and paystubs are kept on file.`)) {
    return;
  }

  // Someone who belongs to several companies is only removed from this
  // one. Only their last company deletes the whole account.
  const { data: removal, error: removalErr } = await client.rpc("remove_from_company", { p_user: userId });
  if (removalErr) {
    msgEl.innerHTML = `<div class="msg error">Couldn't remove access: ${escHtml(removalErr.message)}</div>`;
    return;
  }
  if (removal === "removed") {
    msgEl.innerHTML = `<div class="msg ok">${escHtml(email)} was removed from this company. Their account stays active for their other companies.</div>`;
    loadProfileMap().then(populateEmployeeSelect);
    loadEmployees();
    return;
  }

  // The Edge Function handles everything: it verifies you're an admin
  // in the same company, deletes their profile/role rows (so nothing
  // blocks the account deletion), then deletes the auth account itself.
  let dispatch = await deleteAuthAccount(userId);
  if (!dispatch.deleted && /database error deleting user/i.test(dispatch.error || "")) {
    // The account still owns records (documents, timesheets, deal memos...). Ask before wiping them.
    if (window.confirm(`${email} still has records on file (documents, timesheets, paystubs or deal memos), which block deleting the account.\n\nDelete the account AND all of those records and files? This can't be undone.`)) {
      msgEl.innerHTML = `<div class="msg ok">Deleting the account and its records…</div>`;
      dispatch = await deleteAuthAccount(userId, true);
    }
  }
  if (!dispatch.deleted) {
    msgEl.innerHTML = `<div class="msg error">Couldn't delete the account${dispatch.error ? ": " + dispatch.error : ""}. Nothing was changed.</div>`;
    return;
  }

  msgEl.innerHTML = `<div class="msg ok">${email}'s account has been fully deleted.</div>`;
  loadProfileMap().then(populateEmployeeSelect);
  loadEmployees();
}

function populateEmployeeSelect() {
  const select = document.getElementById("paystubEmployeeSelect");
  select.innerHTML = "";
  for (const [userId, email] of profileMap.entries()) {
    const opt = document.createElement("option");
    opt.value = userId;
    opt.textContent = email;
    select.appendChild(opt);
  }
}
