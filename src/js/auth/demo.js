// ---- Demo mode: the Silver Harbour demo production (supabase/functions/demo) ----
// @demo.example.com addresses sign in straight away, without email or two-step sign-in. While
// signed in as one, a bar along the bottom switches between the demo crew and resets the demo.
const DEMO_DOMAIN = "demo.example.com";
const DEMO_ADMIN_EMAIL = "demo@" + DEMO_DOMAIN;
const isDemoEmail = (email) => String(email || "").toLowerCase().endsWith("@" + DEMO_DOMAIN);
let demoPeople = null;

async function demoCall(action, extra) {
  const { data, error } = await client.functions.invoke("demo", { body: { action, termsVersion: TERMS_VERSION, ...(extra || {}) } });
  if (error) {
    let msg = error.message;
    try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {}
    return { error: { message: msg } };
  }
  return { data };
}

async function demoLogin(email) {
  const { data, error } = await demoCall("login", { email });
  if (error) return { error };
  return client.auth.verifyOtp({ token_hash: data.tokenHash, type: "email" });
}

function demoOverlay(text) {
  let o = document.getElementById("demoOverlay");
  if (!text) { if (o) o.remove(); return; }
  if (!o) { o = document.createElement("div"); o.id = "demoOverlay"; document.body.appendChild(o); }
  o.innerHTML = `<div class="demo-overlay-card"><span class="ob-pulse"></span>${escHtml(text)}</div>`;
}

// Sign in as someone else in the demo, then start the page fresh as them.
async function demoSwitchTo(email, label) {
  demoOverlay(`Signing in as ${label}…`);
  const { error } = await demoLogin(email);
  if (error) { demoOverlay(null); window.alert("Couldn't switch: " + error.message); return; }
  location.reload();
}

async function demoReset() {
  if (!window.confirm("Reset the demo?\n\nEverything done in the demo is undone, and the crew go back to where they started. You'll be signed in as the production admin.")) return;
  demoOverlay("Resetting the demo. This takes about 20 seconds…");
  const { error } = await demoCall("reset");
  if (error) { demoOverlay(null); window.alert("Couldn't reset the demo: " + error.message); return; }
  await demoSwitchTo(DEMO_ADMIN_EMAIL, "the production admin");
}

async function renderDemoBar() {
  if (!isDemoEmail(currentUserEmail) || document.getElementById("demoBar")) return;
  const bar = document.createElement("div");
  bar.id = "demoBar";
  bar.innerHTML = `<span class="demo-tag">Demo</span>
    <button type="button" class="demo-who" id="demoWhoBtn" data-nobusy aria-haspopup="true" aria-expanded="false"><span>Viewing as</span> <b id="demoWhoName">${escHtml(currentUserEmail)}</b> <i aria-hidden="true">▴</i></button>
    <button type="button" class="demo-reset" id="demoResetBtn" data-nobusy>Reset demo</button>
    <div class="demo-menu hidden" id="demoMenu" role="menu"></div>`;
  document.body.appendChild(bar);
  document.body.classList.add("has-demo-bar");
  const menu = bar.querySelector("#demoMenu"), who = bar.querySelector("#demoWhoBtn");
  const close = () => { menu.classList.add("hidden"); who.setAttribute("aria-expanded", "false"); };
  who.addEventListener("click", () => {
    const open = menu.classList.toggle("hidden") === false;
    who.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => { if (!bar.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  bar.querySelector("#demoResetBtn").addEventListener("click", demoReset);

  if (!demoPeople) {
    const { data } = await demoCall("people");
    demoPeople = (data && data.people) || [];
  }
  const me = demoPeople.find((p) => p.email === String(currentUserEmail).toLowerCase());
  if (me) bar.querySelector("#demoWhoName").textContent = `${me.name} · ${me.admin ? "Admin" : me.role}`;
  menu.innerHTML = `<p class="demo-menu-head">Switch to someone else in the demo</p>` + demoPeople.map((p, i) => `
    <button type="button" role="menuitem" class="demo-person${me && p.email === me.email ? " current" : ""}" data-demo-i="${i}" data-nobusy>
      <b>${escHtml(p.name)}${p.admin ? ' <span class="demo-pill">Admin</span>' : ""}</b>
      <span>${escHtml(p.admin ? "Production Manager · sees everyone's progress" : p.role + " · " + p.dept)}</span>
      <span class="demo-stage">${escHtml(p.stage)}</span>
    </button>`).join("");
  menu.querySelectorAll("[data-demo-i]").forEach((b) => b.addEventListener("click", () => {
    const p = demoPeople[Number(b.dataset.demoI)];
    if (me && p.email === me.email) { close(); return; }
    demoSwitchTo(p.email, p.name);
  }));
}
