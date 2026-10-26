const inviteKitToggle = document.getElementById("inviteKitToggle");
const inviteKitRateWrap = document.getElementById("inviteKitRateWrap");
inviteKitToggle.addEventListener("change", () => {
  inviteKitRateWrap.classList.toggle("hidden", !inviteKitToggle.checked);
  if (!inviteKitToggle.checked) document.getElementById("inviteKitRateInput").value = "";
});

// ---- Invite emails ----
// Sent by the send-invite-email Edge Function (supabase/functions/send-invite-email).
// Until its Resend secrets are set it replies sent:false, and admins use "Copy Invite" instead.
const INVITE_EMAIL_FUNCTION = "send-invite-email";
async function dispatchInviteEmail(invite) {
  // Calls the "send-invite-email" Edge Function (Resend). If it isn't
  // deployed or configured yet, this just reports sent:false and the
  // admin falls back to "Copy Invite".
  try {
    const { data, error } = await client.functions.invoke(INVITE_EMAIL_FUNCTION, {
      body: invite.id ? { inviteId: invite.id } : { email: invite.email },
    });
    if (error) {
      let detail = error.message;
      if (error.context && typeof error.context.json === "function") {
        try { const b = await error.context.json(); if (b && b.error) detail = b.error; } catch (e) { /* keep generic */ }
      }
      return { sent: false, error: detail };
    }
    if (data && data.error) return { sent: false, error: data.error };
    return { sent: !!(data && data.sent) };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}

// Dates default to today through one year; change them under "More options" if needed.
function inviteDefaultDates(force) {
  const st = document.getElementById("inviteStartInput"), en = document.getElementById("inviteEndInput");
  const t = new Date(); const y = new Date(t.getFullYear() + 1, t.getMonth(), t.getDate());
  if (force || !st.value) st.value = ymd(t);
  if (force || !en.value) en.value = ymd(y);
}
inviteDefaultDates(false);

function syncInviteType() {
  const c = document.getElementById("inviteTypeSelect").value === "contractor";
  document.getElementById("inviteTsWrap").classList.toggle("hidden", c);
  document.getElementById("inviteKitRow").classList.toggle("hidden", c);
}
document.getElementById("inviteTypeSelect").addEventListener("change", syncInviteType);

document.getElementById("sendInviteBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("inviteMsg");
  const full_name = document.getElementById("inviteNameInput").value.trim();
  const email = document.getElementById("inviteEmailInput").value.trim();
  const phone = document.getElementById("invitePhoneInput").value.trim();
  const role = document.getElementById("inviteAccessSelect").value;
  const department = document.getElementById("inviteDeptSelect").value;
  const crew_role = document.getElementById("inviteCrewRoleSelect").value;
  const start_date = document.getElementById("inviteStartInput").value;
  const end_date = document.getElementById("inviteEndInput").value;
  const kit_fee_enabled = document.getElementById("inviteKitToggle").checked && document.getElementById("inviteTypeSelect").value !== "contractor";
  const kit_fee_rate = kit_fee_enabled ? Number(document.getElementById("inviteKitRateInput").value || 0) : null;
  const deal_memo_template_id = document.getElementById("inviteDealMemoSelect").value || null;
  const safety_template_id = document.getElementById("inviteSafetySelect").value || null;

  const checkedDocs = Array.from(
    document.querySelectorAll("#docRequestGrid input[type=checkbox]:checked")
  ).map((cb) => cb.value);
  const otherDocs = document.getElementById("inviteDocsOtherInput").value
    .split(",").map((s) => s.trim()).filter(Boolean);
  const requested_documents = [...checkedDocs, ...otherDocs];
  const isContractorInvite = document.getElementById("inviteTypeSelect").value === "contractor";
  if (isContractorInvite) requested_documents.unshift(CONTRACTOR_TAG);

  if (!full_name || !email || !department || !crew_role || !start_date || !end_date) {
    msgEl.innerHTML = `<div class="msg error">Add their name, email, department and crew role first.</div>`;
    return;
  }
  if (end_date < start_date) {
    msgEl.innerHTML = `<div class="msg error">End date is before the start date.</div>`;
    return;
  }

  const invitePayload = {
    company_id: currentCompany.id,
    email, role, full_name, phone, department, crew_role,
    start_date, end_date, kit_fee_enabled, kit_fee_rate,
    requested_documents, deal_memo_template_id, safety_template_id,
  };

  const tsSel = document.getElementById("inviteTimesheetSelect");
  if (tsSel && (tsSel.value || allTsTemplates.length)) invitePayload.timesheet_template_id = isContractorInvite ? null : (tsSel.value || null);

  const { data: inserted, error } = await client
    .from("company_invites")
    .upsert({ ...invitePayload, used: false }, { onConflict: "email" })
    .select()
    .single();

  if (error) {
    msgEl.innerHTML = `<div class="msg error">${error.message}</div>`;
    return;
  }

  // Best-effort — currently a no-op until dispatchInviteEmail is wired up.
  const dispatch = await dispatchInviteEmail(inserted || invitePayload).catch(() => ({ sent: false }));

  msgEl.innerHTML = dispatch.sent
    ? `<div class="msg ok">Invite emailed to ${email}.</div>`
    : `<div class="msg ok">Invite created for ${email}${dispatch.error ? `, but the email didn't send (${escHtml(dispatch.error)})` : ""}. Use "Copy Invite" below to send it manually.</div>`;

  ["inviteNameInput", "inviteEmailInput", "invitePhoneInput", "inviteKitRateInput", "inviteDocsOtherInput"]
    .forEach((id) => { document.getElementById(id).value = ""; });
  inviteDefaultDates(true);
  inviteKitToggle.checked = false;
  inviteKitRateWrap.classList.add("hidden");
  document.getElementById("inviteTypeSelect").value = ""; syncInviteType();
  document.querySelectorAll("#docRequestGrid input[type=checkbox]:checked")
    .forEach((cb) => { cb.checked = false; });

  loadPendingInvites();
});

async function loadPendingInvites() {
  const listEl = document.getElementById("pendingInvitesList");
  const emptyEl = document.getElementById("pendingInvitesEmpty");
  listEl.innerHTML = "";

  const { data: rows, error } = await client
    .from("company_invites")
    .select("id, email, role, full_name, phone, department, crew_role, start_date, end_date, kit_fee_enabled, kit_fee_rate, requested_documents, used, created_at")
    .order("created_at", { ascending: false });

  if (error || !rows || rows.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  for (const row of rows) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.className = "info";

    const kitBit = row.kit_fee_enabled
      ? ` · <span class="kit-tag">$${Number(row.kit_fee_rate || 0).toFixed(2)}/day kit</span>`
      : "";
    const dates = row.start_date
      ? ` · ${row.start_date}${row.end_date ? " – " + row.end_date : ""}`
      : "";
    const subtitle = `${row.crew_role || row.role}${row.department ? " (" + row.department + ")" : ""}${dates} · ${row.used ? "joined" : "pending"}${kitBit}`;
    const docsBit = (row.requested_documents && row.requested_documents.length)
      ? `<span style="display:block;margin-top:4px;">${row.requested_documents.map((d) => `<span class="doc-tag">${d === CONTRACTOR_TAG ? "Solo contractor (invoices)" : d}</span>`).join("")}</span>`
      : "";

    left.innerHTML = `<span class="name">${row.full_name || row.email}</span><span class="email">${row.email}${row.phone ? " · " + row.phone : ""}</span><span class="email">${subtitle}</span>${docsBit}`;

    const right = document.createElement("span");
    right.className = "actions";
    if (!row.used) {
      const emailBtn = document.createElement("button");
      emailBtn.className = "preview-link";
      emailBtn.textContent = "Email Invite";
      emailBtn.addEventListener("click", async () => {
        emailBtn.disabled = true;
        const r = await dispatchInviteEmail(row);
        emailBtn.disabled = false;
        emailBtn.textContent = r.sent ? "Sent" : "Email Invite";
        document.getElementById("inviteMsg").innerHTML = r.sent
          ? `<div class="msg ok">Invite emailed to ${escHtml(row.email)}.</div>`
          : `<div class="msg error">Couldn't email ${escHtml(row.email)}${r.error ? ": " + escHtml(r.error) : ""}. Use Copy Invite instead.</div>`;
      });
      right.appendChild(emailBtn);

      const copyBtn = document.createElement("button");
      copyBtn.className = "preview-link";
      copyBtn.textContent = "Copy Invite";
      copyBtn.addEventListener("click", () => copyInviteMessage(row, copyBtn));
      right.appendChild(copyBtn);

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "remove-link";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => cancelInvite(row.id));
      right.appendChild(cancelBtn);
    } else if (row.email !== currentUserEmail) {
      const rmBtn = document.createElement("button");
      rmBtn.className = "remove-link";
      rmBtn.textContent = "Remove access";
      rmBtn.addEventListener("click", async () => {
        const { data: prof } = await client.from("profiles").select("user_id").eq("email", row.email).maybeSingle();
        const msgEl = document.getElementById("inviteMsg");
        if (!prof) {
          // Account is already gone: just clear the stale invite.
          if (window.confirm(`${row.email} has no active account. Remove this entry from the list?`)) {
            await client.from("company_invites").delete().eq("id", row.id);
            loadPendingInvites();
          }
          return;
        }
        removeMsgTarget = "inviteMsg";
        try { await removeEmployee(prof.user_id, row.email); } finally { removeMsgTarget = null; }
        loadPendingInvites();
      });
      right.appendChild(rmBtn);
    }

    li.appendChild(left);
    li.appendChild(right);
    listEl.appendChild(li);
  }
}

const PORTAL_URL = APP_CONFIG.portalUrl || location.origin + location.pathname;
const inviteLink = (email) => `${PORTAL_URL}?signup=1&email=${encodeURIComponent(email)}`;

async function copyInviteMessage(row, btn) {
  const kitLine = row.kit_fee_enabled ? `Kit fee: $${Number(row.kit_fee_rate || 0).toFixed(2)}/day\n` : "";
  const docsLine = (realDocs(row.requested_documents).length)
    ? `\nPlease upload the following before you start:\n` + realDocs(row.requested_documents).map((d) => `- ${d}`).join("\n") + `\n`
    : "";
  const message =
    `Hi ${row.full_name || ""},\n\n` +
    `You've been invited to the Buzzflix HR Intake Portal as ${row.crew_role} (${row.department}).\n\n` +
    `Dates: ${row.start_date} – ${row.end_date}\n` +
    kitLine + docsLine + `\n` +
    `Create your account here (use this email address, ${row.email}):\n${inviteLink(row.email)}\n\n` +
    `Then confirm your email to get started.`;

  try {
    await navigator.clipboard.writeText(message);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = original; }, 1800);
  } catch (err) {
    alert(message);
  }
}

async function cancelInvite(id) {
  await client.from("company_invites").delete().eq("id", id);
  loadPendingInvites();
}
