// ---- Onboarding: Terms, create or join a production, first-time production setup ----
// showApp() (main.js) calls these in order: requireTerms → (no production yet) showCreateOrJoin
// → requireMfa → (own production not set up yet) runSetupWizard → offerPasskeyOnce → the portal.
const TERMS_VERSION = "2026-10-27";
const onboardView = document.getElementById("onboardView");

function obRender(inner) {
  authView.classList.add("hidden");
  appView.classList.add("hidden");
  onboardView.classList.remove("hidden");
  onboardView.innerHTML = `<div class="ob-wrap"><div class="auth-mark">HR</div>${inner}
    <p class="ob-who">Signed in as <b>${escHtml(currentUserEmail || "")}</b> · <button type="button" class="ob-link" data-ob-account>Account</button> · <button type="button" class="ob-link" data-ob-signout>Sign out</button></p></div>`;
  onboardView.querySelector("[data-ob-signout]").addEventListener("click", signOutEverywhere);
  onboardView.querySelector("[data-ob-account]").addEventListener("click", () => openAccount());
  window.scrollTo({ top: 0 });
}
function obHide() {
  onboardView.classList.add("hidden");
  onboardView.innerHTML = "";
}
const obMsg = (text, kind) => { const m = onboardView.querySelector("#obMsg"); if (m) m.innerHTML = text ? `<div class="msg ${kind || "error"}">${escHtml(text)}</div>` : ""; };

// ---------- Terms and Privacy ----------
async function requireTerms(user) {
  const { data: prof } = await client.from("profiles").select("terms_version").eq("user_id", user.id).maybeSingle();
  if (prof && prof.terms_version === TERMS_VERSION) return;
  await new Promise((resolve) => {
    obRender(`<div class="ob-card">
      <h2>Before you continue</h2>
      <p class="sub">This portal holds onboarding paperwork for film and TV crews, including ID, banking and tax documents. Here's the short version:</p>
      <ul class="ob-points">
        <li>Your production decides what it collects, and who on the production can see it.</li>
        <li>Files are stored privately and are never public.</li>
        <li>We don't sell your information or use it for advertising.</li>
      </ul>
      <label class="checkbox-label ob-check"><input type="checkbox" id="obTermsChk" /> <span>I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> and have read the <a href="privacy.html" target="_blank" rel="noopener">Privacy Notice</a>.</span></label>
      <div id="obMsg"></div>
      <button class="btn-primary" id="obTermsGo" data-nobusy disabled>Continue</button>
    </div>`);
    const chk = onboardView.querySelector("#obTermsChk"), go = onboardView.querySelector("#obTermsGo");
    chk.addEventListener("change", () => { go.disabled = !chk.checked; });
    go.addEventListener("click", async () => {
      go.disabled = true;
      const { error } = await client.rpc("accept_terms", { p_version: TERMS_VERSION });
      if (error) { go.disabled = false; obMsg(error.message); return; }
      resolve();
    });
  });
}

// ---------- No production yet: create one, or wait for an invite ----------
const OB_ICON = {
  create: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 6l2-3M13 6l2-3M12 13v4M10 15h4"/></svg>',
  join: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 11h6M19 8l3 3-3 3"/></svg>',
};
let obJoinPoll = null;

function showCreateOrJoin() {
  clearInterval(obJoinPoll);
  obRender(`<div class="ob-card ob-wide">
    <h2>Welcome! What would you like to do?</h2>
    <p class="sub">If a production invited you, it'll appear here automatically once they do.</p>
    <div class="ob-choices">
      <button type="button" class="ob-choice" data-ob="create">${OB_ICON.create}<b>Create a production</b><span>Set up your production, then invite crew to sign paperwork, submit timesheets and get paystubs.</span></button>
      <button type="button" class="ob-choice" data-ob="join">${OB_ICON.join}<b>Join a production</b><span>You're crew on a production that uses this portal.</span></button>
    </div>
  </div>`);
  onboardView.querySelector('[data-ob="create"]').addEventListener("click", () => runSetupWizard(null));
  onboardView.querySelector('[data-ob="join"]').addEventListener("click", showJoinWaiting);
}

function showJoinWaiting() {
  obRender(`<div class="ob-card">
    <h2>Join a production</h2>
    <p class="sub">Productions add crew by invitation. Ask your production office, or whoever handles crew paperwork, to invite this email address:</p>
    <div class="ob-email"><code>${escHtml(currentUserEmail)}</code><button type="button" class="btn-secondary" id="obCopyEmail" data-nobusy>Copy</button></div>
    <div class="ob-wait"><span class="ob-pulse"></span>Waiting for an invite. You'll go straight in once it arrives.</div>
    <div id="obMsg"></div>
    <div class="ob-actions">
      <button type="button" class="ob-link" id="obBack">Back</button>
      <button type="button" class="btn-secondary" id="obCheck" data-nobusy>Check now</button>
    </div>
  </div>`);
  const check = async (manual) => {
    const { data } = await client.rpc("my_companies");
    if ((data || []).length) { clearInterval(obJoinPoll); location.reload(); return; }
    if (manual) obMsg("No invite yet. Make sure they use exactly this email address.", "error");
  };
  onboardView.querySelector("#obCopyEmail").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(currentUserEmail); e.target.textContent = "Copied!"; setTimeout(() => { e.target.textContent = "Copy"; }, 1600); } catch (_) {}
  });
  onboardView.querySelector("#obCheck").addEventListener("click", () => check(true));
  onboardView.querySelector("#obBack").addEventListener("click", showCreateOrJoin);
  clearInterval(obJoinPoll);
  obJoinPoll = setInterval(() => check(false), 15000);
}

// ---------- Production setup wizard ----------
const PRODUCTION_TYPES = ["Feature film", "Series / episodic", "Commercial", "Music video", "Documentary", "Short film", "Other"];
const PROVINCES = ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia", "Nunavut", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Yukon", "Outside Canada"];
const SETUP_STEPS = [
  { id: "name", label: "Name" },
  { id: "security", label: "Security" },
  { id: "passkey", label: "Passkey" },
  { id: "theme", label: "Theme" },
  { id: "role", label: "Your role" },
  { id: "details", label: "Details" },
];
const setupKey = (cid) => "intake_setup_step_" + cid;
let obCompanyId = null;

function setupFrame(stepId, inner) {
  const i = SETUP_STEPS.findIndex((s) => s.id === stepId);
  const bar = SETUP_STEPS.map((s, k) => `<li class="${k < i ? "done" : k === i ? "cur" : ""}"><span>${k + 1}</span>${s.label}</li>`).join("");
  obRender(`<div class="ob-card ob-wide">
    <p class="ob-eyebrow">Set up your production · Step ${i + 1} of ${SETUP_STEPS.length}</p>
    <ol class="ob-steps">${bar}</ol>
    ${inner}
  </div>`);
}

async function runSetupWizard(companyId) {
  obCompanyId = companyId;
  let step = "name";
  if (companyId) {
    try { step = localStorage.getItem(setupKey(companyId)) || "passkey"; } catch (_) { step = "passkey"; }
    if (step === "name" || step === "security") step = "passkey";
  }
  goSetupStep(step);
}

function goSetupStep(id) {
  if (obCompanyId) { try { localStorage.setItem(setupKey(obCompanyId), id); } catch (_) {} }
  ({ name: setupName, security: setupSecurity, passkey: setupPasskey, theme: setupTheme, role: setupRole, details: setupDetails })[id]();
}

function setupName() {
  setupFrame("name", `<h2>Name your production</h2>
    <p class="sub">This is what your crew sees at the top of the portal. You can change it later.</p>
    <label for="obName">Production name</label>
    <input type="text" id="obName" maxlength="120" placeholder="e.g. The Long Night" />
    <label for="obTagline">Short description <span class="muted">(optional)</span></label>
    <input type="text" id="obTagline" maxlength="120" placeholder="e.g. Season 2 · Vancouver" />
    <div id="obMsg"></div>
    <div class="ob-actions"><button type="button" class="ob-link" id="obBack">Back</button><button class="btn-primary" id="obNext" data-nobusy>Continue</button></div>`);
  const name = onboardView.querySelector("#obName");
  name.focus();
  onboardView.querySelector("#obBack").addEventListener("click", showCreateOrJoin);
  const next = onboardView.querySelector("#obNext");
  const go = async () => {
    const nm = name.value.trim(), tag = onboardView.querySelector("#obTagline").value.trim();
    if (!nm) { obMsg("Enter a name for your production."); name.focus(); return; }
    next.disabled = true;
    const { data: cid, error } = await client.rpc("create_production", { p_name: nm });
    if (error) { next.disabled = false; obMsg(error.message); return; }
    obCompanyId = cid;
    if (tag) await client.from("companies").update({ tagline: tag }).eq("id", cid);
    goSetupStep("security");
  };
  next.addEventListener("click", go);
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

async function setupSecurity() {
  setupFrame("security", `<h2>Secure your account</h2>
    <p class="sub">Production admins can see crew ID, banking and tax documents, so admin accounts use two-step sign-in with an authenticator app. You'll also get backup codes in case you lose your phone.</p>`);
  const { data: { user } } = await client.auth.getUser();
  await requireMfa(user);
  goSetupStep("passkey");
}

function setupPasskey() {
  if (!passkeySupported()) { goSetupStep("theme"); return; }
  setupFrame("passkey", `<h2>Sign in faster with a passkey <span class="muted">(optional)</span></h2>
    <p class="sub">Use Face ID, Touch ID, Windows Hello or a security key to sign in, instead of waiting for an emailed code. You'll still enter your authenticator code after it.</p>
    <div id="obMsg"></div>
    <div class="ob-actions"><button type="button" class="ob-link" id="obSkip">Skip for now</button><button class="btn-primary" id="obNext" data-nobusy>Add a passkey</button></div>`);
  const next = onboardView.querySelector("#obNext");
  onboardView.querySelector("#obSkip").addEventListener("click", () => { markPasskeyOffered(); goSetupStep("theme"); });
  next.addEventListener("click", async () => {
    next.disabled = true;
    try {
      const saved = await registerPasskey();
      markPasskeyOffered();
      if (saved) { obMsg("Passkey added. Next time, choose “Sign in with a passkey”.", "ok"); setTimeout(() => goSetupStep("theme"), 1200); }
      else next.disabled = false;
    } catch (e) { next.disabled = false; obMsg(e.message || String(e)); }
  });
}

function setupTheme() {
  let chosen = { themeId: "classic", dark: false };
  setupFrame("theme", `<h2>Pick a theme</h2>
    <p class="sub">Sets the colours your crew sees, in light or dark. Change it, or add a logo and background photo, any time under Manage Crew › Company settings.</p>
    <div id="obThemePicker" class="theme-picker"></div>
    <div id="obMsg"></div>
    <div class="ob-actions"><button type="button" class="ob-link" id="obBack">Back</button><button class="btn-primary" id="obNext" data-nobusy>Continue</button></div>`);
  applyTheme(chosen.themeId, chosen.dark);
  renderThemePicker(onboardView.querySelector("#obThemePicker"), chosen, (st) => { chosen = st; applyTheme(st.themeId, st.dark); });
  onboardView.querySelector("#obBack").addEventListener("click", () => goSetupStep("passkey"));
  const next = onboardView.querySelector("#obNext");
  next.addEventListener("click", async () => {
    next.disabled = true;
    const t = THEME_PRESETS.find((x) => x.id === chosen.themeId);
    const { error } = await client.from("companies")
      .update({ theme: t.id, dark_mode: chosen.dark, primary_color: t.primary, accent_color: t.accent }).eq("id", obCompanyId);
    if (error) { next.disabled = false; obMsg(error.message); return; }
    applyTheme(t.id, chosen.dark, null, true);
    goSetupStep("role");
  });
}

async function setupRole() {
  const { data: { user } } = await client.auth.getUser();
  const details = (user && user.user_metadata && user.user_metadata.details) || {};
  const opts = (list) => list.map((v) => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join("");
  setupFrame("role", `<h2>Your role on the production</h2>
    <p class="sub">So your crew knows who you are, and your own timesheets and paperwork are filed correctly.</p>
    <label for="obFullName">Your full name</label>
    <input type="text" id="obFullName" maxlength="120" autocomplete="name" value="${escHtml(details.full_name || "")}" />
    <div class="ob-row">
      <div><label for="obDept">Department</label><select id="obDept">${opts(Object.keys(DEPARTMENTS))}</select></div>
      <div><label for="obCrewRole">Role</label><select id="obCrewRole"></select></div>
    </div>
    <div id="obMsg"></div>
    <div class="ob-actions"><button type="button" class="ob-link" id="obBack">Back</button><button class="btn-primary" id="obNext" data-nobusy>Continue</button></div>`);
  const dept = onboardView.querySelector("#obDept"), role = onboardView.querySelector("#obCrewRole");
  const fillRoles = () => { role.innerHTML = opts(DEPARTMENTS[dept.value] || []); };
  dept.addEventListener("change", fillRoles);
  fillRoles();
  onboardView.querySelector("#obFullName").focus();
  onboardView.querySelector("#obBack").addEventListener("click", () => goSetupStep("theme"));
  const next = onboardView.querySelector("#obNext");
  next.addEventListener("click", async () => {
    const full = onboardView.querySelector("#obFullName").value.trim();
    if (!full) { obMsg("Enter your name."); return; }
    next.disabled = true;
    const { error } = await client.rpc("set_my_crew_role", { p_full_name: full, p_department: dept.value, p_crew_role: role.value });
    if (error) { next.disabled = false; obMsg(error.message); return; }
    await client.auth.updateUser({ data: { details: { ...details, full_name: full } } });
    goSetupStep("details");
  });
}

function setupDetails() {
  const opts = (list) => `<option value="">Choose…</option>` + list.map((v) => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join("");
  setupFrame("details", `<h2>Production details <span class="muted">(optional)</span></h2>
    <p class="sub">Helps you and your crew keep track. You can skip this and fill it in later.</p>
    <div class="ob-row">
      <div><label for="obType">Type</label><select id="obType">${opts(PRODUCTION_TYPES)}</select></div>
      <div><label for="obUnion">Union status</label><select id="obUnion">${opts(["Union", "Non-union", "Mixed"])}</select></div>
    </div>
    <div class="ob-row">
      <div><label for="obStart">Start date</label><input type="date" id="obStart" /></div>
      <div><label for="obWrap">Wrap date</label><input type="date" id="obWrap" /></div>
    </div>
    <label for="obProvince">Province or territory</label>
    <select id="obProvince">${opts(PROVINCES)}</select>
    <div id="obMsg"></div>
    <div class="ob-actions"><button type="button" class="ob-link" id="obSkip">Skip</button><button class="btn-primary" id="obNext" data-nobusy>Finish setup</button></div>`);
  const v = (id) => onboardView.querySelector(id).value || null;
  const finish = async (withDetails) => {
    const patch = { setup_done: true };
    if (withDetails) {
      Object.assign(patch, { production_type: v("#obType"), union_status: v("#obUnion"), start_date: v("#obStart"), wrap_date: v("#obWrap"), province: v("#obProvince") });
      if (patch.start_date && patch.wrap_date && patch.wrap_date < patch.start_date) { obMsg("The wrap date is before the start date."); return; }
    }
    onboardView.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    const { error } = await client.from("companies").update(patch).eq("id", obCompanyId);
    if (error) { onboardView.querySelectorAll("button").forEach((b) => { b.disabled = false; }); obMsg(error.message); return; }
    try { localStorage.removeItem(setupKey(obCompanyId)); sessionStorage.setItem("intake_after_setup", "1"); } catch (_) {}
    location.reload();
  };
  const start = onboardView.querySelector("#obStart"), wrap = onboardView.querySelector("#obWrap");
  start.addEventListener("change", () => { wrap.min = start.value; });   // wrap calendar opens at the start month, earlier days greyed out
  onboardView.querySelector("#obSkip").addEventListener("click", () => finish(false));
  onboardView.querySelector("#obNext").addEventListener("click", () => finish(true));
}

// ---------- Passkey offer on first sign-in (everyone else) ----------
function markPasskeyOffered() {
  client.auth.updateUser({ data: { passkey_offered: true } }).catch(() => {});
}
async function offerPasskeyOnce(user) {
  if (!passkeySupported() || isDemoEmail(user.email) || (user.user_metadata && user.user_metadata.passkey_offered)) return;
  const { count } = await client.from("passkeys").select("id", { count: "exact", head: true });
  if (count) { markPasskeyOffered(); return; }
  await new Promise((resolve) => {
    obRender(`<div class="ob-card">
      <h2>Sign in faster next time?</h2>
      <p class="sub">Add a passkey to sign in with Face ID, Touch ID, Windows Hello or a security key, instead of waiting for an emailed code. It's optional.</p>
      <div id="obMsg"></div>
      <div class="ob-actions"><button type="button" class="ob-link" id="obSkip">Not now</button><button class="btn-primary" id="obNext" data-nobusy>Add a passkey</button></div>
    </div>`);
    const done = () => { markPasskeyOffered(); resolve(); };
    onboardView.querySelector("#obSkip").addEventListener("click", done);
    const next = onboardView.querySelector("#obNext");
    next.addEventListener("click", async () => {
      next.disabled = true;
      try {
        if (await registerPasskey()) { obMsg("Passkey added.", "ok"); setTimeout(done, 900); }
        else next.disabled = false;
      } catch (e) { next.disabled = false; obMsg(e.message || String(e)); }
    });
  });
}

// ---------- Getting-started checklist (admins, on My Portal) ----------
async function renderGettingStarted() {
  if (!isAdmin || !currentCompany) return;
  const hideKey = "intake_gs_hidden_" + currentCompany.id;
  try { if (localStorage.getItem(hideKey)) return; } catch (_) {}
  const head = (t, q) => { const b = client.from(t).select("id", { count: "exact", head: true }); return q ? q(b) : b; };
  const [deals, tsForms, chain, heads, invites] = await Promise.all([
    head("esign_templates"),
    head("timesheet_templates"),
    head("approval_chain"),
    head("department_heads"),
    head("company_invites", (b) => b.neq("email", (currentUserEmail || "").toLowerCase())),
  ]);
  const items = [
    { done: !!invites.count, label: "Invite your crew", act: () => openInviteModal() },
    { done: !!deals.count, label: "Add your deal memo and safety forms", act: () => gotoAdmin("pdfEditorWrap") },
    { done: !!chain.count, label: "Choose who approves documents", act: () => gotoAdmin("addChainStepBtn") },
    { done: !!heads.count, label: "Assign department heads to review timesheets", act: () => gotoAdmin("deptHeadsList") },
    { done: !!tsForms.count, label: "Add a union timesheet form (if you use one)", act: () => gotoAdmin("tsTplEditorWrap") },
    { done: !!currentCompany.logo_path, label: "Add your logo", act: () => gotoAdmin("companyNameInput") },
  ];
  const left = items.filter((i) => !i.done).length;
  if (!left) return;
  const box = document.createElement("section");
  box.className = "panel gs-card";
  box.id = "gettingStarted";
  box.innerHTML = `<div class="gs-head"><div><h2>Getting started</h2><p class="desc">${items.length - left} of ${items.length} done. Pick up where you left off.</p></div>
      <button type="button" class="ob-link" data-gs-hide>Hide</button></div>
    <div class="gs-bar"><i style="width:${Math.round(((items.length - left) / items.length) * 100)}%"></i></div>
    <ul class="gs-list">${items.map((it, i) => `<li class="${it.done ? "done" : ""}"><button type="button" data-gs="${i}" ${it.done ? "disabled" : ""}><span class="gs-tick"></span>${escHtml(it.label)}</button></li>`).join("")}</ul>`;
  box.querySelectorAll("[data-gs]").forEach((b) => b.addEventListener("click", () => items[Number(b.dataset.gs)].act()));
  box.querySelector("[data-gs-hide]").addEventListener("click", () => { try { localStorage.setItem(hideKey, "1"); } catch (_) {} box.remove(); });
  const old = document.getElementById("gettingStarted");
  if (old) old.remove();
  document.querySelector("#portalTab .pv-main").prepend(box);
}
function gotoAdmin(anchorId) {
  expandPanelOf(document.getElementById(anchorId));
  window.scrollTo({ top: 0 });
}
