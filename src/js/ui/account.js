// ---- Account pane: opened from your name in the top right ----
// Your details, productions (switch or leave), two-step sign-in, passkeys, signing out everywhere,
// downloading your data, the Terms you accepted, and deleting your account. Deleting removes the
// login and leaves every production; the records each production holds stay with it.
const acctOverlay = document.createElement("div");
acctOverlay.id = "accountOverlay";
acctOverlay.className = "modal-overlay hidden";
acctOverlay.innerHTML = `<div class="modal-card account-card" role="dialog" aria-modal="true" aria-labelledby="acctTitle">
  <button class="modal-close" id="acctClose" aria-label="Close">&times;</button>
  <div id="acctBody"></div>
</div>`;
document.body.appendChild(acctOverlay);
const acctBody = acctOverlay.querySelector("#acctBody");
const acctDemo = () => isDemoEmail(currentUserEmail);
const acctMsg = (el, text, kind) => { if (el) el.innerHTML = text ? `<div class="msg ${kind || "error"}">${escHtml(text)}</div>` : ""; };
const acctFmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "");

function openAccount() {
  acctOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderAccount();
}
function closeAccount() {
  acctOverlay.classList.add("hidden");
  document.body.style.overflow = "";
}
document.getElementById("whoAmI").addEventListener("click", openAccount);
acctOverlay.querySelector("#acctClose").addEventListener("click", closeAccount);
acctOverlay.addEventListener("click", (e) => { if (e.target === acctOverlay) closeAccount(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !acctOverlay.classList.contains("hidden")) closeAccount(); });

// A step inside the pane (setting up an authenticator, confirming a delete…), with a way back.
function acctStep(title, inner) {
  acctBody.innerHTML = `<button type="button" class="acct-back" data-acct-back data-nobusy>‹ Account</button>
    <h2 id="acctTitle">${escHtml(title)}</h2>${inner}`;
  acctBody.querySelector("[data-acct-back]").addEventListener("click", renderAccount);
  acctOverlay.scrollTop = 0;
}

async function verifiedTotp() {
  const { data } = await client.auth.mfa.listFactors();
  return ((data && data.totp) || []).filter((f) => f.status === "verified");
}

async function renderAccount() {
  acctBody.innerHTML = `<p class="empty">Loading…</p>`;
  const { data: { user } } = await client.auth.getUser();
  if (!user) { closeAccount(); return; }
  const [{ data: invite }, { data: prof }, { data: companies }, totp, { data: keys }, { data: codesLeft }] = await Promise.all([
    client.from("company_invites").select("full_name, phone").eq("email", user.email.toLowerCase()).maybeSingle(),
    client.from("profiles").select("terms_version, terms_accepted_at").eq("user_id", user.id).maybeSingle(),
    client.rpc("my_companies"),
    verifiedTotp(),
    client.from("passkeys").select("id, device_name, created_at, last_used_at").order("created_at"),
    client.rpc("recovery_codes_left"),
  ]);
  const det = (user.user_metadata && user.user_metadata.details) || {};
  const name = (invite && invite.full_name) || "";
  const demo = acctDemo();
  const demoNote = demo ? `<p class="acct-note">Turned off for demo accounts.</p>` : "";
  const field = (id, label, value, attrs) => `<div class="acct-field"><label for="${id}">${label}</label><input id="${id}" value="${escHtml(value || "")}" ${attrs || ""} /></div>`;

  const companyRows = (companies || []).map((c) => `<li>
      <span class="info"><span class="name">${escHtml(c.name)}</span><span class="email">${c.role === "admin" ? "Admin" : "Crew"}${c.active ? " · current" : ""}</span></span>
      <span class="actions">${c.active ? "" : `<button type="button" class="remove-link" data-acct-switch="${c.id}">Switch to</button>`}${demo ? "" : `<button type="button" class="remove-link" data-acct-leave="${c.id}" data-name="${escHtml(c.name)}">Leave</button>`}</span>
    </li>`).join("");

  const keyRows = (keys || []).map((k) => `<li>
      <span class="info"><span class="name">${escHtml(k.device_name || "Passkey")}</span><span class="email">Added ${acctFmtDate(k.created_at)}${k.last_used_at ? " · last used " + acctFmtDate(k.last_used_at) : ""}</span></span>
      <span class="actions">${demo ? "" : `<button type="button" class="remove-link" data-acct-rmkey="${k.id}">Remove</button>`}</span>
    </li>`).join("");

  acctBody.innerHTML = `
    <h2 id="acctTitle">${escHtml(name || user.email)}</h2>
    <p class="modal-sub">${escHtml(user.email)}</p>

    <h3>Your details</h3>
    <p class="acct-hint">Productions use these to fill in your deal memos and forms. Your email can't be changed.</p>
    <div class="acct-grid">
      ${field("acctName", "Full legal name", name, 'autocomplete="name" maxlength="120"')}
      ${field("acctPhone", "Phone", (invite && invite.phone) || det.phone, 'autocomplete="tel" maxlength="40"')}
      ${field("acctDob", "Date of birth", det.dob, 'type="date"')}
      ${field("acctAddress", "Street address", det.address, 'autocomplete="street-address"')}
      ${field("acctCity", "City", det.city, 'autocomplete="address-level2"')}
      ${field("acctProvince", "Province", det.province, 'autocomplete="address-level1"')}
      ${field("acctPostal", "Postal code", det.postal_code, 'autocomplete="postal-code"')}
    </div>
    <div class="acct-row"><button type="button" class="btn-secondary" id="acctSaveDetails">Save details</button><span id="acctDetailsMsg" class="acct-inline"></span></div>

    <h3>Productions</h3>
    ${companyRows ? `<ul class="file-list acct-list">${companyRows}</ul>` : `<p class="acct-hint">You're not part of a production yet.</p>`}
    <p class="acct-hint">Leaving a production removes your access. Everything you submitted to it stays with the production.</p>
    <div id="acctCompanyMsg"></div>

    <h3>Two-step sign-in</h3>
    ${totp.length
      ? `<p class="acct-status on">On · authenticator app${codesLeft != null ? ` · ${codesLeft} backup code${codesLeft === 1 ? "" : "s"} left` : ""}</p>
         <p class="acct-hint">Backup codes are only shown when they're made. If you've lost yours, make new ones (the old ones stop working).</p>
         ${demo ? demoNote : `<div class="acct-row"><button type="button" class="btn-secondary" id="acctReplaceTotp">Replace authenticator</button><button type="button" class="btn-secondary" id="acctNewCodes">New backup codes</button></div>`}`
      : `<p class="acct-status">Off</p>
         <p class="acct-hint">${demo ? "Demo accounts sign in without it." : isAdmin ? "Admins need it; you'll be asked to set it up next time you sign in." : "Optional for crew. Adds a 6-digit code from an authenticator app when you sign in."}</p>
         ${demo ? demoNote : `<div class="acct-row"><button type="button" class="btn-secondary" id="acctAddTotp">Turn on</button></div>`}`}

    <h3>Passkeys</h3>
    ${keyRows ? `<ul class="file-list acct-list">${keyRows}</ul>` : `<p class="acct-hint">No passkeys yet. A passkey signs you in with Face ID, Touch ID, Windows Hello or a security key instead of an emailed code.</p>`}
    ${demo ? demoNote : passkeySupported() ? `<div class="acct-row"><button type="button" class="btn-secondary" id="acctAddKey" data-nobusy>Add a passkey</button></div>` : `<p class="acct-hint">This browser doesn't support passkeys.</p>`}
    <div id="acctKeyMsg"></div>

    <h3>Sessions</h3>
    <p class="acct-hint">Signs you out on every device and browser, including this one.</p>
    <div class="acct-row"><button type="button" class="btn-secondary" id="acctSignOutAll">Sign out everywhere</button></div>

    <h3>Your data</h3>
    <p class="acct-hint">A .zip of everything you've submitted to each of your productions: documents, timesheets, invoices, paystubs and signed forms, plus your details.</p>
    <div class="acct-row"><button type="button" class="btn-secondary" id="acctExport">Download my data</button><span id="acctExportMsg" class="acct-inline"></span></div>

    <h3>Terms and privacy</h3>
    <p class="acct-hint">${prof && prof.terms_accepted_at ? `You accepted the version of ${escHtml(prof.terms_version || "")} on ${acctFmtDate(prof.terms_accepted_at)}.` : "You haven't accepted the Terms yet."}
      <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> · <a href="privacy.html" target="_blank" rel="noopener">Privacy Notice</a></p>

    <div class="acct-danger">
      <h3>Delete account</h3>
      <p class="acct-hint">Deletes your login and removes you from every production. Your productions keep the records you submitted to them, such as signed deal memos and timesheets, as payroll law requires.</p>
      ${demo ? demoNote : `<button type="button" class="btn-reject" id="acctDelete">Delete my account</button>`}
    </div>`;

  const on = (id, fn) => { const el = acctBody.querySelector("#" + id); if (el) el.addEventListener("click", fn); };
  on("acctSaveDetails", saveAccountDetails);
  on("acctAddTotp", () => setupAuthenticator(null));
  on("acctReplaceTotp", () => confirmWithAuthenticator("Replace authenticator", "Enter the code from your current authenticator app first.", () => setupAuthenticator(totp[0].id)));
  on("acctNewCodes", () => confirmWithAuthenticator("New backup codes", "Enter the code from your authenticator app. Your old backup codes will stop working.", () => showNewBackupCodes("Your old backup codes no longer work.")));
  on("acctAddKey", addAccountPasskey);
  on("acctSignOutAll", signOutAllDevices);
  on("acctExport", exportMyData);
  on("acctDelete", startAccountDelete);
  acctBody.querySelectorAll("[data-acct-switch]").forEach((b) => b.addEventListener("click", async () => {
    const { error } = await client.rpc("switch_company", { p_company: b.dataset.acctSwitch });
    if (error) { acctMsg(acctBody.querySelector("#acctCompanyMsg"), error.message); return; }
    location.reload();
  }));
  acctBody.querySelectorAll("[data-acct-leave]").forEach((b) => b.addEventListener("click", () => leaveProduction(b.dataset.acctLeave, b.dataset.name)));
  acctBody.querySelectorAll("[data-acct-rmkey]").forEach((b) => b.addEventListener("click", async () => {
    if (!window.confirm("Remove this passkey? You can still sign in with an emailed code.")) return;
    const { error } = await client.from("passkeys").delete().eq("id", b.dataset.acctRmkey);
    if (error) { acctMsg(acctBody.querySelector("#acctKeyMsg"), error.message); return; }
    renderAccount();
  }));
}

// ---------- Details ----------
async function saveAccountDetails() {
  const msg = acctBody.querySelector("#acctDetailsMsg");
  const v = (id) => acctBody.querySelector("#" + id).value.trim();
  if (!v("acctName")) { msg.textContent = "Enter your full name."; return; }
  const { error } = await client.rpc("update_my_contact", { p_full_name: v("acctName"), p_phone: v("acctPhone") });
  if (error) { msg.textContent = error.message; return; }
  const { data: { user } } = await client.auth.getUser();
  const details = { ...((user.user_metadata && user.user_metadata.details) || {}) };
  [["phone", "acctPhone"], ["dob", "acctDob"], ["address", "acctAddress"], ["city", "acctCity"], ["province", "acctProvince"], ["postal_code", "acctPostal"]]
    .forEach(([k, id]) => { if (v(id)) details[k] = v(id); else delete details[k]; });
  const { error: e2 } = await client.auth.updateUser({ data: { details } });
  if (e2) { msg.textContent = e2.message; return; }
  msg.textContent = "Saved.";
  acctBody.querySelector("#acctTitle").textContent = v("acctName");
  // The rest of the page reads the name and details from these.
  loadMyRequestedDocuments().then(loadMyDeals).catch(() => {});
}

// ---------- Productions ----------
async function leaveProduction(companyId, name) {
  const msg = acctBody.querySelector("#acctCompanyMsg");
  if (!window.confirm(`Leave ${name}?\n\nYou'll lose access to it. Everything you submitted stays with the production. To come back, they'll need to invite you again.`)) return;
  const wasActive = currentCompany && currentCompany.id === companyId;
  const { error } = await client.rpc("leave_company", { p_company: companyId });
  if (error) { acctMsg(msg, error.message); return; }
  if (wasActive) { location.reload(); return; }
  renderAccount();
  loadMyCompanies();
}

// ---------- Two-step sign-in ----------
function codeInput(id) {
  return `<input id="${id}" class="acct-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />`;
}

// Asks for a code from their current authenticator (giving a fresh two-step session), then runs next().
async function confirmWithAuthenticator(title, lead, next) {
  const [factor] = await verifiedTotp();
  if (!factor) { renderAccount(); return; }
  acctStep(title, `<p class="acct-hint">${escHtml(lead)}</p>${codeInput("acctCode")}<div id="acctStepMsg"></div>
    <div class="acct-row"><button type="button" class="btn-secondary" id="acctGo">Continue</button></div>`);
  const input = acctBody.querySelector("#acctCode"), msg = acctBody.querySelector("#acctStepMsg"), go = acctBody.querySelector("#acctGo");
  input.focus();
  const submit = async () => {
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) { acctMsg(msg, "Enter the 6-digit code."); return; }
    go.disabled = true;
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    go.disabled = false;
    if (error) { input.value = ""; input.focus(); acctMsg(msg, "That code didn't work. Try the next one."); return; }
    next();
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

// Sets up a new authenticator. With oldFactorId, the old one is removed once the new one works.
async function setupAuthenticator(oldFactorId) {
  const { data: fl } = await client.auth.mfa.listFactors();
  for (const f of ((fl && fl.all) || []).filter((x) => x.factor_type === "totp" && x.status !== "verified")) {
    try { await client.auth.mfa.unenroll({ factorId: f.id }); } catch (_) {}
  }
  const { data: en, error: e0 } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "HR Intake Portal " + Date.now().toString(36) });
  const title = oldFactorId ? "Replace authenticator" : "Turn on two-step sign-in";
  if (e0) { acctStep(title, `<div class="msg error">${escHtml(e0.message)}</div>`); return; }
  acctStep(title, `<p class="acct-hint">Scan this with your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
    <div class="mfa-qr"><img alt="QR code" id="acctQr" /></div>
    <p class="acct-hint">Can't scan? Type this key into the app: <code>${escHtml(en.totp.secret)}</code></p>
    ${codeInput("acctCode")}<div id="acctStepMsg"></div>
    <div class="acct-row"><button type="button" class="btn-secondary" id="acctGo">Turn on</button></div>`);
  // Set via the DOM (not markup): the SVG contains quotes that break an HTML attribute.
  let q = String(en.totp.qr_code || "");
  if (/^data:image\/svg\+xml/i.test(q) && !/;base64,/i.test(q)) q = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(q.replace(/^data:image\/svg\+xml[^,<]*,/i, ""));
  acctBody.querySelector("#acctQr").src = q;
  const input = acctBody.querySelector("#acctCode"), msg = acctBody.querySelector("#acctStepMsg"), go = acctBody.querySelector("#acctGo");
  const submit = async () => {
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) { acctMsg(msg, "Enter the 6-digit code."); return; }
    go.disabled = true;
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: en.id, code });
    if (error) { go.disabled = false; input.value = ""; acctMsg(msg, "That code didn't match. Try the next one."); return; }
    if (oldFactorId) await client.auth.mfa.unenroll({ factorId: oldFactorId });
    await client.auth.refreshSession();
    showNewBackupCodes(oldFactorId ? "Your new authenticator is set up, and the old one was removed." : "Two-step sign-in is on.");
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

// Makes a fresh set of backup codes (replacing any old ones) and shows them this one time.
async function showNewBackupCodes(intro) {
  const { data: codes, error } = await client.rpc("generate_recovery_codes");
  if (error || !codes || !codes.length) { acctStep("Backup codes", `<div class="msg error">${escHtml(error ? error.message : "Couldn't make backup codes.")}</div>`); return; }
  acctStep("Save your backup codes", `<p class="acct-hint">${escHtml(intro)} Each code works once. This is the only time they're shown, so save them now. If you lose your phone, sign in with your email and use one to set up a new authenticator.</p>
    <ol class="mfa-codes">${codes.map((c) => `<li><code>${escHtml(c)}</code></li>`).join("")}</ol>
    <div class="acct-row"><button type="button" class="btn-secondary" id="acctCopyCodes" data-nobusy>Copy</button><button type="button" class="btn-secondary" id="acctPdfCodes" data-nobusy>Download PDF</button></div>
    <label class="checkbox-label acct-ack"><input type="checkbox" id="acctAck" /> I've saved these somewhere safe</label>
    <div class="acct-row"><button type="button" class="btn-primary" id="acctDone" data-nobusy disabled>Done</button></div>`);
  // Leaving before saving them would lose them for good.
  acctBody.querySelector("[data-acct-back]").remove();
  const ack = acctBody.querySelector("#acctAck"), done = acctBody.querySelector("#acctDone");
  ack.addEventListener("change", () => { done.disabled = !ack.checked; });
  done.addEventListener("click", renderAccount);
  acctBody.querySelector("#acctCopyCodes").addEventListener("click", async (e) => {
    const text = `HR Intake Portal backup codes for ${currentUserEmail}\n\n` + codes.join("\n");
    try { await navigator.clipboard.writeText(text); e.target.textContent = "Copied!"; setTimeout(() => { e.target.textContent = "Copy"; }, 1600); }
    catch (_) { window.prompt("Copy your backup codes:", codes.join("  ")); }
  });
  acctBody.querySelector("#acctPdfCodes").addEventListener("click", () => downloadBackupCodesPdf(codes, currentUserEmail));
}

// ---------- Passkeys and sessions ----------
async function addAccountPasskey() {
  const msg = acctBody.querySelector("#acctKeyMsg"), btn = acctBody.querySelector("#acctAddKey");
  btn.disabled = true;
  try {
    if (await registerPasskey()) { markPasskeyOffered(); renderAccount(); return; }
  } catch (e) { acctMsg(msg, e.message || String(e)); }
  btn.disabled = false;
}

async function signOutAllDevices() {
  if (!window.confirm("Sign out on every device, including this one?")) return;
  await client.auth.signOut({ scope: "global" });
  forgetTheme();
  location.reload();
}

// ---------- Download my data ----------
let jsZipReady = null;
function ensureJsZip() {
  if (jsZipReady) return jsZipReady;
  jsZipReady = new Promise((resolve, reject) => {
    if (window.JSZip) { resolve(window.JSZip); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => { jsZipReady = null; reject(new Error("Couldn't load the zip helper. Check your connection.")); };
    document.head.appendChild(s);
  });
  return jsZipReady;
}

// Records are only readable in the production you're working in, so this visits each one in turn
// and puts you back where you were.
async function exportMyData() {
  const msg = acctBody.querySelector("#acctExportMsg"), btn = acctBody.querySelector("#acctExport");
  btn.disabled = true;
  const { data: { user } } = await client.auth.getUser();
  const { data: companies } = await client.rpc("my_companies");
  const start = (companies || []).find((c) => c.active);
  try {
    const JSZip = await ensureJsZip();
    const zip = new JSZip();
    const safe = (s) => String(s || "file").replace(/[\\/:*?"<>|]+/g, "_");
    const addFile = async (folder, bucket, path) => {
      if (!path) return;
      const { data } = await client.storage.from(bucket).download(path);
      if (data) folder.file(safe(path.split("/").pop()), data);
    };
    const { data: profile } = await client.from("profiles").select("email, terms_version, terms_accepted_at, created_at").eq("user_id", user.id).maybeSingle();
    const summary = { exported_at: new Date().toISOString(), email: user.email, profile, details: (user.user_metadata && user.user_metadata.details) || {}, productions: [] };
    for (const c of companies || []) {
      msg.textContent = `Collecting ${c.name}…`;
      if (!c.active) {
        const { error } = await client.rpc("switch_company", { p_company: c.id });
        if (error) throw error;
      }
      const mine = (t, cols) => client.from(t).select(cols || "*").eq("user_id", user.id);
      const [inv, docs, sheets, stubs, forms, notes] = await Promise.all([
        client.from("company_invites").select("full_name, phone, department, crew_role, start_date, end_date, kit_fee_enabled, kit_fee_rate, requested_documents").eq("email", user.email.toLowerCase()).eq("company_id", c.id).maybeSingle(),
        mine("documents"), mine("timesheets"), mine("paystubs"), mine("esign_records"),
        client.from("notifications").select("kind, title, body, created_at, read_at").eq("company_id", c.id),
      ]);
      const folder = zip.folder(safe(c.name));
      await Promise.all([
        ...(docs.data || []).map((r) => addFile(folder.folder("documents"), "documents", r.file_path)),
        ...(sheets.data || []).map((r) => addFile(folder.folder("timesheets and invoices"), "timesheets", r.file_path)),
        ...(stubs.data || []).map((r) => addFile(folder.folder("paystubs"), "paystubs", r.file_path)),
        ...(forms.data || []).map((r) => addFile(folder.folder("signed forms"), DEAL_BUCKET, r.final_pdf_path)),
      ]);
      summary.productions.push({
        production: c.name, role: c.role, crew_details: inv.data, documents: docs.data, timesheets_and_invoices: sheets.data,
        paystubs: stubs.data, deal_memos_and_forms: forms.data, notifications: notes.data,
      });
    }
    zip.file("my-data.json", JSON.stringify(summary, null, 2));
    zip.file("README.txt", `Your data from the HR Intake Portal, exported ${new Date().toLocaleString()}.\n\nmy-data.json has your details and every record you submitted, by production.\nEach production's folder has the files themselves.\n`);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hr-intake-my-data.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    msg.textContent = "Downloaded.";
  } catch (e) {
    msg.textContent = "Couldn't export: " + ((e && e.message) || String(e));
  } finally {
    if (start) await client.rpc("switch_company", { p_company: start.id });
    btn.disabled = false;
  }
}

// ---------- Delete account ----------
async function startAccountDelete() {
  const [factor] = await verifiedTotp();
  const intro = `<p class="acct-hint">This deletes your login and removes you from every production. Your productions keep what you submitted to them. You can't undo this, but you can sign up again later with the same email as a new account.</p>`;
  const finish = () => {
    acctStep("Delete account", `${intro}<p class="acct-hint">Type your email address to confirm.</p>
      <input id="acctConfirmEmail" autocomplete="off" spellcheck="false" placeholder="${escHtml(currentUserEmail)}" />
      <div id="acctStepMsg"></div>
      <div class="acct-row"><button type="button" class="btn-reject" id="acctGo" disabled>Delete my account</button></div>`);
    const input = acctBody.querySelector("#acctConfirmEmail"), go = acctBody.querySelector("#acctGo"), msg = acctBody.querySelector("#acctStepMsg");
    input.focus();
    input.addEventListener("input", () => { go.disabled = input.value.trim().toLowerCase() !== String(currentUserEmail).toLowerCase(); });
    go.addEventListener("click", async () => {
      go.disabled = true;
      const { data, error } = await client.functions.invoke("delete-user", { body: { action: "delete-self" } });
      let err = (data && data.error) || null;
      if (error) { err = error.message; try { const b = await error.context.json(); if (b && b.error) err = b.error; } catch (_) {} }
      if (err) { go.disabled = false; acctMsg(msg, err); return; }
      await client.auth.signOut({ scope: "local" });
      forgetTheme();
      try { sessionStorage.setItem("intake_account_deleted", "1"); } catch (_) {}
      location.reload();
    });
  };

  if (factor) {
    confirmWithAuthenticator("Delete account", "First, enter the code from your authenticator app.", finish);
    return;
  }
  // No authenticator: prove it with a code emailed to them.
  acctStep("Delete account", `${intro}<p class="acct-hint">First, we'll email a 6-digit code to <b>${escHtml(currentUserEmail)}</b>.</p>
    <div id="acctStepMsg"></div>
    <div class="acct-row"><button type="button" class="btn-secondary" id="acctSend">Email me a code</button></div>`);
  const msg = acctBody.querySelector("#acctStepMsg");
  acctBody.querySelector("#acctSend").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const { error } = await client.auth.signInWithOtp({ email: currentUserEmail, options: { shouldCreateUser: false } });
    if (error) { e.target.disabled = false; acctMsg(msg, error.message); return; }
    acctStep("Delete account", `<p class="acct-hint">Enter the code we emailed to <b>${escHtml(currentUserEmail)}</b>.</p>${codeInput("acctCode")}<div id="acctStepMsg"></div>
      <div class="acct-row"><button type="button" class="btn-secondary" id="acctGo">Continue</button></div>`);
    const input = acctBody.querySelector("#acctCode"), go = acctBody.querySelector("#acctGo"), m2 = acctBody.querySelector("#acctStepMsg");
    input.focus();
    const submit = async () => {
      const token = input.value.replace(/\D/g, "");
      if (token.length < 6) { acctMsg(m2, "Enter the code from the email."); return; }
      go.disabled = true;
      const { error: ve } = await client.auth.verifyOtp({ email: currentUserEmail, token, type: "email" });
      go.disabled = false;
      if (ve) { input.value = ""; acctMsg(m2, "That code didn't work or has expired."); return; }
      finish();
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
  });
}

// After deleting an account, the sign-in screen says so.
(function () {
  let gone = false;
  try { gone = sessionStorage.getItem("intake_account_deleted") === "1"; sessionStorage.removeItem("intake_account_deleted"); } catch (_) {}
  if (gone) authMsg.innerHTML = `<div class="msg ok">Your account was deleted.</div>`;
})();
