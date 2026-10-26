// ---- Employee: my deals (sign deal memo / safety acknowledgment) ----
const dealCtx = {};
// Red "!" on the front page (tab and heading) while a deal memo is waiting for a signature.
function setDealsBadge(n) {
  const bang = (txt) => (n ? ` <span class="deal-bang" title="${n} waiting for your signature">${txt}</span>` : "");
  const h = document.querySelector("#myDealsPanel > h2");
  if (h) h.innerHTML = "My deals" + bang("!");
  const tb = document.getElementById("tabPortalBtn");
  if (tb) tb.innerHTML = "My Portal" + bang("!");
  const side = document.querySelector('#portalNav .pv-link[data-view="deals"] .pv-label');
  if (side) side.innerHTML = "Deal Memos" + bang("!");
}

async function loadMyDetails(user) {
  const d = user && user.user_metadata && user.user_metadata.details;
  myProfile = d && typeof d === "object" ? { ...d } : {};
}

const DM_IDENTITY = ["dob", "phone", "address", "city", "province", "postal_code"];
function dmChosenLang() { return myProfile && myProfile.lang || ""; }
// value for one box on a form, from the profile or a stored answer
function dmFieldValue(template, f) {
  const langs = dmLanguages([template]);
  const r = dmResolveTemplate(template, dmChosenLang() || (langs.length > 1 ? "" : langs[0] || "en")).get(f.id);
  if (!r || r.skip && r.key !== "today") return "";
  if (r.key === "today") return localIso(new Date());
  return r.bind ? bindValue(r.bind) : (myProfile[r.key] || "");
}

// One question per distinct thing the pending forms ask for, in the employee's language.
function buildQuestions(templates, lang) {
  const qs = new Map();
  templates.forEach((t) => {
    const res = dmResolveTemplate(t, lang);
    (t.fields || []).forEach((f) => {
      const r = res.get(f.id);
      if (!r || r.skip) return;
      const q = qs.get(r.key) || { key: r.key, bind: r.bind, label: (lang && r.label[lang]) || r.label.en || r.label.fr || "", type: r.type, optional: true };
      const ord = (f.page || 0) * 1000 + Math.round((f.y || 0) * 999);
      q.order = Math.min(q.order === undefined ? ord : q.order, ord);
      if (!r.mapped && !q.prev) q.prev = { tid: t.id, page: f.page || 0, x: f.x, y: f.y, w: f.w, h: f.h };
      if (f.alt && f.alt.g && !q.alt) q.alt = { g: f.alt.g, b: f.alt.b };
      if (f.type === "date") q.type = "date";
      if (!f.optional || DM_IDENTITY.includes(r.bind)) q.optional = false;
      qs.set(r.key, q);
    });
  });
  return [...qs.values()];
}

const DM_GROUPS = [
  { id: "you", en: "About you", fr: "À propos de vous", keys: ["full_name", "first_name", "last_name", "dob", "phone", "email"] },
  { id: "address", en: "Where you live", fr: "Où vous habitez", keys: ["address", "city", "province", "postal_code"] },
  { id: "status", en: "Citizenship and residency", fr: "Citoyenneté et résidence", keys: ["nat_date", "pr_date"] },
  { id: "work", en: "Your work on this production", fr: "Votre travail sur cette production", keys: ["position", "department", "company", "production", "start_date", "end_date", "loanout"] },
  { id: "id", en: "Identification", fr: "Pièces d'identité", keys: ["drivers"] },
  { id: "other", en: "A few other details these forms ask for", fr: "Autres renseignements demandés", keys: null },
];
const DM_UI = {
  en: { step: "Step 1: tell us a bit about you (asked once, fills every form)", yours: "Your details (used to fill forms)", save: "Save and fill my forms", change: "Save changes", opt: "(optional)", langShort: "Language", onfile: "Already on file:", lang: "Which language would you like to answer in?", cont: "Continue", next: "Next", back: "Back", skip: "Skip", of: "of", need: "Please answer this one to continue.", list: "Show all questions as a list", one: "Go one at a time", wait: "Your forms will appear here, filled in, as soon as you save this." },
  fr: { step: "Étape 1 : quelques renseignements sur vous (demandés une seule fois)", yours: "Vos renseignements (utilisés pour remplir les formulaires)", save: "Enregistrer et remplir mes formulaires", change: "Enregistrer", opt: "(facultatif)", langShort: "Langue", onfile: "Déjà au dossier :", lang: "Dans quelle langue souhaitez-vous répondre ?", cont: "Continuer", next: "Suivant", back: "Retour", skip: "Passer", of: "sur", need: "Veuillez répondre pour continuer.", list: "Tout afficher en liste", one: "Une question à la fois", wait: "Vos formulaires apparaîtront ici, remplis, dès que vous aurez enregistré." },
  es: { step: "Paso 1: cuéntenos un poco sobre usted (se pregunta una sola vez)", yours: "Sus datos (se usan para completar los formularios)", save: "Guardar y completar mis formularios", change: "Guardar cambios", opt: "(opcional)", langShort: "Idioma", onfile: "Ya registrado:", lang: "¿En qué idioma desea responder?", cont: "Continuar", next: "Siguiente", back: "Atrás", skip: "Omitir", of: "de", need: "Responda para continuar.", list: "Mostrar todo en lista", one: "Una pregunta a la vez", wait: "Sus formularios aparecerán aquí, completados, en cuanto guarde esto." },
};

// Shorter, plainer wording for the question shown big; the full wording stays as a small hint.
function dmShortLabel(label) {
  let t = String(label || "").trim().replace(/\s+/g, " ");
  t = t.replace(/[:.\s]+$/, "");
  t = t.replace(/^(please\s+)?(enter|provide|print|type|write|indicate|state)\s+(in\s+)?(your|the)?\s*/i, "");
  t = t.replace(/\s*[\(\[]([^)\]]{18,})[\)\]]/g, "");   // long bracketed explanations become the hint
  t = t.replace(/\s+(as (shown|it appears|appearing|stated)[^,.;]*|if applicable)$/i, "");
  t = t.trim();
  if (t.length > 64) t = t.slice(0, 61).replace(/\s+\S*$/, "") + "…";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : String(label || "");
}
const DM_AUTOC = { full_name: "name", first_name: "given-name", last_name: "family-name", dob: "bday", phone: "tel", email: "email", address: "street-address", city: "address-level2", province: "address-level1", postal_code: "postal-code" };

function myDetailsCardHtml(templates) {
  const langs = dmLanguages(templates);
  let lang = dmChosenLang();
  if (lang && !langs.includes(lang)) lang = "";
  if (langs.length > 1 && !lang) {
    const html = `<details class="my-details" open>
      <summary><span class="deal-bang">!</span> ${escHtml(DM_UI.en.lang)}</summary>
      <div class="my-details-grid"><label>Language<select data-det="lang">${langs.map((l) => `<option value="${l}">${DM_LANG_NAMES[l]}</option>`).join("")}</select></label></div>
      <button type="button" id="saveMyDetails" class="secondary">${DM_UI.en.cont}</button>
      <span id="saveMyDetailsMsg" class="muted"></span>
    </details>`;
    return { html, blocking: true, wait: "" };
  }
  if (!lang) lang = langs[0] || "en";
  const ui = DM_UI[lang] || DM_UI.en;
  const qs = buildQuestions(templates, lang);
  if (!qs.length) return { html: "", blocking: false };
  const known = (q) => q.bind ? bindValue(q.bind) : (myProfile[q.key] || "");
  const altDone = (q) => q.alt && qs.some((o) => o !== q && o.alt && o.alt.g === q.alt.g && o.alt.b !== q.alt.b && known(o));
  const unanswered = qs.filter((q) => !q.optional && !known(q) && !altDone(q));
  const onFile = qs.filter((q) => q.bind && !DM_IDENTITY.includes(q.bind) && bindValue(q.bind));
  const stored = qs.filter((q) => !onFile.includes(q));
  const input = (q) => `<label class="${q.prev ? "q-wide" : ""}"${q.alt ? ` data-altg="${escHtml(q.alt.g)}" data-altb="${escHtml(q.alt.b)}"` : ""}><span class="q">${escHtml(dmShortLabel(q.label))}${q.optional ? ` <span class="muted">${ui.opt}</span>` : ""}</span>${dmShortLabel(q.label) !== q.label && q.label.length <= 160 ? `<span class="q-hint">${escHtml(q.label)}</span>` : ""}${q.prev ? `<span class="q-prev" data-prev="${escHtml(JSON.stringify(q.prev))}">…</span>` : ""}<input data-det="${escHtml(q.key)}" type="${q.type === "date" ? "date" : "text"}"${DM_AUTOC[q.key] ? ` autocomplete="${DM_AUTOC[q.key]}"` : ""}${q.key === "phone" ? ` inputmode="tel"` : q.key === "email" ? ` inputmode="email"` : q.key === "postal_code" ? ` autocapitalize="characters"` : ""} value="${escHtml(String(known(q) || "").slice(0, q.type === "date" ? 10 : 200))}" /></label>`;
  const blocking = unanswered.length > 0;
  const langPick = langs.length > 1 ? `<div class="qlang"><label><span class="q">${escHtml(ui.langShort)}</span><select data-det="lang">${langs.map((l) => `<option value="${l}"${l === lang ? " selected" : ""}>${DM_LANG_NAMES[l]}</option>`).join("")}</select></label></div>` : "";
  // Standard order: about you, address, status, work, ID, then anything specific to these forms in page order.
  const used = new Set();
  const groupsHtml = DM_GROUPS.map((g) => {
    const items = (g.keys ? g.keys.map((k) => stored.find((q) => q.key === k)).filter(Boolean) : stored.filter((q) => !DM_GROUPS.some((x) => x.keys && x.keys.includes(q.key))).sort((a, b) => (a.order || 0) - (b.order || 0)));
    items.forEach((q) => used.add(q.key));
    if (!items.length) return "";
    return `<section class="qgroup"><h4>${escHtml(g[lang] || g.en)}</h4><div class="qgrid">${items.map(input).join("")}</div></section>`;
  }).join("");
  const chips = onFile.length ? `<div class="qonfile"><span>${escHtml(ui.onfile)}</span>${onFile.map((q) => `<em>${escHtml(q.label)}: ${escHtml(String(bindValue(q.bind)).slice(0, 40))}</em>`).join("")}</div>` : "";
  const total = stored.filter((q) => !q.optional).length, done = stored.filter((q) => !q.optional && known(q)).length;
  const prog = total ? `<span class="qprog">${done}/${total}</span>` : "";
  const html = `<details class="my-details"${blocking ? " open" : ""}>
    <summary>${blocking ? `<span class="deal-bang">!</span> ${escHtml(ui.step)}` : escHtml(ui.yours)}${prog}</summary>
    ${langPick}${chips}${groupsHtml}
    <div class="qactions"><button type="button" id="saveMyDetails" class="secondary">${blocking ? ui.save : ui.change}</button>
    <span id="saveMyDetailsMsg" class="muted"></span></div>
  </details>`;
  return { html, blocking, wait: ui.wait };
}

// Full-page view of where a question's box is (click anywhere or press Esc to close).
function showPagePreview(cv, d) {
  const old = document.getElementById("pagePreviewOverlay"); if (old) old.remove();
  const ov = document.createElement("div");
  ov.id = "pagePreviewOverlay";
  ov.innerHTML = `<div class="ppv-bar"><span>Where this box is on the form (outlined in red)</span><button type="button" class="ppv-x" aria-label="Close">&times;</button></div><div class="ppv-scroll"><img alt="Form page" /></div>`;
  const img = ov.querySelector("img");
  img.src = cv.toDataURL("image/jpeg", 0.85);
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest(".ppv-x") || e.target === img) close(); });
  img.addEventListener("load", () => {
    const sc = ov.querySelector(".ppv-scroll");
    sc.scrollTop = Math.max(0, (d.y + d.h / 2) * img.clientHeight - sc.clientHeight / 2);
  });
}

// Shows the part of the form a vague question is about, with the box outlined.
async function renderQuestionPreviews(root, byId) {
  const els = [...root.querySelectorAll(".q-prev")];
  if (!els.length) return;
  const pdfjs = await ensurePdfJs();
  const docs = new Map();
  for (const el of els) {
    try {
      const d = JSON.parse(el.dataset.prev);
      const t = byId.get(d.tid);
      if (!t || !t.source_pdf_path) throw new Error("no pdf");
      let pdf = docs.get(d.tid);
      if (!pdf) { const bytes = await loadTemplatePdfBytes(t.source_pdf_path); pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise; docs.set(d.tid, pdf); }
      const page = await pdf.getPage(d.page + 1);
      const vp = page.getViewport({ scale: 2.4 });
      const cv = document.createElement("canvas");
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 3;
      ctx.strokeRect(d.x * cv.width - 3, d.y * cv.height - 3, d.w * cv.width + 6, d.h * cv.height + 6);
      const cw = Math.round(cv.width * 0.5), ch = Math.round(cv.height * 0.085);
      const sx = Math.max(0, Math.min(cv.width - cw, (d.x + d.w / 2) * cv.width - cw / 2));
      const sy = Math.max(0, Math.min(cv.height - ch, (d.y + d.h / 2) * cv.height - ch / 2));
      const out = document.createElement("canvas");
      out.width = cw; out.height = ch; out.className = "q-prev-img";
      out.getContext("2d").drawImage(cv, sx, sy, cw, ch, 0, 0, cw, ch);
      out.title = "Click to see the whole page";
      const cap = document.createElement("span"); cap.className = "q-prev-cap"; cap.textContent = "Tap the picture to see the whole page"; out.style.cursor = "zoom-in";
      out.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); showPagePreview(cv, d); });
      el.textContent = ""; el.appendChild(out); el.appendChild(cap);
    } catch (_) { el.remove(); }
  }
}


// One question at a time, with progress and slide animations. Falls back to the full list on request.
function dmWizard(root) {
  const card = root.querySelector("details.my-details");
  if (!card || !card.open) return;
  const labels = [...card.querySelectorAll(".qgrid label")];
  if (labels.length < 3 || card.querySelector(".qwiz")) return;
  const lang = dmChosenLang() || "en", ui = DM_UI[lang] || DM_UI.en;
  const inp = (l) => l.querySelector("[data-det]");
  const filled = (l) => !!inp(l).value.trim();
  const isOpt = (l) => /\((optional|facultatif|opcional)\)/.test(l.querySelector(".q").textContent);
  const skipped = (l) => l.classList.contains("q-na");
  let i = Math.max(0, labels.findIndex((l) => !filled(l) && !isOpt(l) && !skipped(l)));
  let dir = 1;
  const wiz = document.createElement("div");
  wiz.className = "qwiz";
  wiz.innerHTML = `<div class="qwiz-bar"><i></i></div><div class="qwiz-meta"><span class="qwiz-count"></span><button type="button" class="qwiz-link">${escHtml(ui.list)}</button></div>
    <div class="qwiz-msg" role="alert"></div>
    <div class="qwiz-nav"><button type="button" class="secondary qwiz-back">${escHtml(ui.back)}</button><button type="button" class="qwiz-skip">${escHtml(ui.skip)}</button><button type="button" class="qwiz-next">${escHtml(ui.next)}</button></div>`;
  const firstGroup = card.querySelector(".qgroup");
  firstGroup.parentNode.insertBefore(wiz, firstGroup);
  card.classList.add("qwiz-on");
  const bar = wiz.querySelector(".qwiz-bar i"), count = wiz.querySelector(".qwiz-count"), msg = wiz.querySelector(".qwiz-msg");
  const next = wiz.querySelector(".qwiz-next"), back = wiz.querySelector(".qwiz-back"), skip = wiz.querySelector(".qwiz-skip");
  const live = () => labels.filter((l) => !skipped(l));
  function show(focus) {
    labels.forEach((l) => { l.classList.remove("cur", "fwd", "bwd"); });
    card.querySelectorAll(".qgroup").forEach((g) => g.classList.remove("cur"));
    const l = labels[i];
    l.classList.add("cur", dir > 0 ? "fwd" : "bwd");
    l.closest(".qgroup").classList.add("cur");
    const seq = live(), pos = Math.max(0, seq.indexOf(l)) + 1;
    count.textContent = `${pos} ${ui.of} ${seq.length}`;
    bar.style.width = (pos / seq.length * 100) + "%";
    const last = pos === seq.length;
    next.textContent = last ? (card.querySelector("#saveMyDetails") ? card.querySelector("#saveMyDetails").textContent : ui.next) : ui.next;
    next.classList.toggle("final", last);
    back.disabled = pos === 1;
    skip.classList.toggle("hidden", !isOpt(l) || filled(l));
    msg.textContent = "";
    if (focus) setTimeout(() => { try { inp(l).focus({ preventScroll: true }); } catch (_) {} }, 60);
  }
  function move(d) {
    dir = d; let k = i + d;
    while (k >= 0 && k < labels.length && skipped(labels[k])) k += d;
    if (k < 0 || k >= labels.length) return false;
    i = k; show(true); return true;
  }
  function advance(isSkip) {
    const l = labels[i];
    if (!isSkip && !filled(l) && !isOpt(l)) {
      msg.textContent = ui.need; l.classList.remove("shake"); void l.offsetWidth; l.classList.add("shake"); inp(l).focus(); return;
    }
    if (!move(1)) { const b = card.querySelector("#saveMyDetails"); if (b) b.click(); }
  }
  next.addEventListener("click", () => advance(false));
  skip.addEventListener("click", () => advance(true));
  back.addEventListener("click", () => move(-1));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" && card.classList.contains("qwiz-on") && e.target.matches && e.target.matches(".qgrid [data-det]")) { e.preventDefault(); advance(false); } });
  card.addEventListener("input", (e) => { if (e.target.matches && e.target.matches(".qgrid [data-det]")) { msg.textContent = ""; skip.classList.toggle("hidden", !isOpt(labels[i]) || filled(labels[i])); const l = e.target.closest("label"); if (skipped(l) && labels[i] === l) {} } });
  const toggle = wiz.querySelector(".qwiz-link");
  toggle.addEventListener("click", () => {
    const on = card.classList.toggle("qwiz-on");
    toggle.textContent = on ? ui.list : ui.one;
    wiz.querySelectorAll(".qwiz-nav,.qwiz-bar,.qwiz-count,.qwiz-msg").forEach((n) => n.classList.toggle("hidden", !on));
    if (on) show(false);
  });
  show(false);
}

// Either/or questions on the details card: answering one dims and clears the other.
function dmCardAlt(root) {
  const labels = [...root.querySelectorAll("label[data-altg]")];
  if (!labels.length) return;
  const val = (l) => { const i = l.querySelector("[data-det]"); return i ? i.value.trim() : ""; };
  const apply = (changed) => {
    const gs = new Set(labels.map((l) => l.dataset.altg));
    gs.forEach((g) => {
      const ls = labels.filter((l) => l.dataset.altg === g);
      let active = changed && changed.dataset.altg === g && val(changed) ? changed.dataset.altb : null;
      if (!active) { const f = ls.find((l) => val(l)); active = f ? f.dataset.altb : null; }
      ls.forEach((l) => {
        const na = !!active && l.dataset.altb !== active;
        l.classList.toggle("q-na", na);
        const i = l.querySelector("[data-det]");
        if (na && i && i.value) i.value = "";
        if (i) i.placeholder = na ? "Not needed" : "";
      });
    });
  };
  root.addEventListener("input", (e) => { const l = e.target.closest && e.target.closest("label[data-altg]"); if (l) apply(l); });
  apply(null);
}

async function saveMyDetails() {
  const msg = document.getElementById("saveMyDetailsMsg");
  const next = { ...myProfile };
  const empty = [...document.querySelectorAll("[data-det]")].filter((e) => !e.value.trim() && e.closest("label") && !e.closest("label.q-na") && !(e.closest("label").dataset.altg && [...document.querySelectorAll(`label[data-altg="${e.closest("label").dataset.altg}"] [data-det]`)].some((o) => o.value.trim())) && !/\((optional|facultatif|opcional)\)/.test(e.closest("label").textContent));
  if (empty.length) { empty[0].focus(); if (msg) msg.textContent = "Please fill in / Veuillez remplir : " + empty.map((e) => e.closest("label").firstChild.textContent.trim()).join(", "); return; }
  document.querySelectorAll("[data-det]").forEach((e) => { const v = e.value.trim(); if (v) next[e.dataset.det] = v; else delete next[e.dataset.det]; });
  const { error } = await client.auth.updateUser({ data: { details: next } });
  if (error) { if (msg) msg.textContent = "Couldn't save: " + error.message; return; }
  myProfile = next;
  loadMyDeals();
}

async function loadMyDeals() {
  const body = document.getElementById("myDealsBody");
  const { data: { user } } = await client.auth.getUser();
  if (!user || !user.email) return;

  await loadMyDetails(user);
  const { data: invite } = await client
    .from("company_invites")
    .select("deal_memo_template_id, safety_template_id")
    .eq("email", user.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Forms from the invite, plus anything an admin has sent since signing up.
  const { data: sentRecs } = await client.from("esign_records").select("template_id").eq("user_id", user.id);
  const templateIds = [...new Set([
    invite && invite.deal_memo_template_id,
    invite && invite.safety_template_id,
    ...((sentRecs || []).map((r) => r.template_id)),
  ].filter(Boolean))];

  if (!templateIds.length) {
    body.innerHTML = `<p class="empty">Nothing to sign right now.</p>`;
    setDealsBadge(0);
    return;
  }

  const { data: templates } = await client
    .from("esign_templates")
    .select("*")
    .in("id", templateIds);

  let cardsHtml = "";
  let waiting = 0;
  const pdfJobs = [];
  for (const template of templates || []) {
    const { data: recList } = await client
      .from("esign_records")
      .select("*")
      .eq("user_id", user.id)
      .eq("template_id", template.id)
      .order("created_at", { ascending: false });
    let record = (recList || []).find((r) => r.status !== "revoked") || null;
    if (!record && (recList || []).length) continue;   // revoked by an admin; nothing to sign unless they issue a new one

    if (!record) {
      const { data: inserted } = await client
        .from("esign_records")
        .insert({ user_id: user.id, template_id: template.id, type: template.type, status: "awaiting_signature" })
        .select()
        .single();
      record = inserted;
    }
    if (!record) continue;

    const isPdf = !!template.source_pdf_path;
    const pointsHtml = isPdf ? "" : (template.deal_points || []).length
      ? `<ul class="deal-point-list">${template.deal_points.map((dp) => `<li><span class="dp-label">${dp.label}</span><span class="dp-value">${dp.value}</span></li>`).join("")}</ul>`
      : "";
    const termsHtml = !isPdf && template.terms_text ? `<p class="deal-terms">${template.terms_text}</p>` : "";

    dealCtx[record.id] = { template, record };
    if (isPdf) pdfJobs.push({ template, record });

    let signBoxHtml;
    if (record.status === "countersigned") {
      signBoxHtml = `<p class="sign-status">✓ Fully executed — signed <span class="signature-rendered">${record.employee_signature}</span> on ${new Date(record.employee_signed_at).toLocaleDateString()}; countersigned <span class="signature-rendered">${record.admin_signature || ""}</span> on ${new Date(record.admin_signed_at).toLocaleDateString()}.</p>`
        + (record.final_pdf_path ? `<button class="btn-secondary" data-final-path="${escHtml(record.final_pdf_path)}">Download signed PDF</button>` : "");
    } else if (record.status === "awaiting_countersignature") {
      signBoxHtml = `<p class="sign-status waiting">You signed <span class="signature-rendered">${record.employee_signature}</span> on ${new Date(record.employee_signed_at).toLocaleDateString()} — awaiting company countersignature.</p>`;
    } else {
      signBoxHtml = (record.reject_reason ? `<p class="sign-status rejected-note">↩ Sent back for changes: ${escHtml(record.reject_reason)}</p>` : "") + `
        <div class="sign-box">
          <input type="text" id="sign-${record.id}" placeholder="Type your full legal name to sign" />
          <button class="btn-secondary" data-sign-id="${record.id}">Sign</button>
        </div>
        <div class="signature-preview-wrap">
          <div class="signature-preview" id="sign-preview-${record.id}"></div>
          <p class="signature-preview-hint">This is treated as your legal signature on this document.</p>
        </div>`;
    }

    const needsSig = record.status === "awaiting_signature";
    if (needsSig) waiting++;
    const updated = needsSig && record.notified_at && record.created_at && (new Date(record.notified_at) - new Date(record.created_at)) > 60000;
    cardsHtml += `
      <div class="deal-card${needsSig ? " deal-new" : ""}">
        <div class="deal-kind">${template.type === "deal_memo" ? "Deal memo" : "Safety acknowledgment"}${needsSig ? `<span class="deal-flag"><span class="deal-bang">!</span>${updated ? "Updated, needs your signature" : "Needs your signature"}</span>` : ""}</div>
        <h4>${escHtml(template.name)}</h4>
        ${isPdf && record.status !== "awaiting_signature"
          ? `${signBoxHtml}<details class="deal-fold"><summary>${record.status === "countersigned" ? "View the executed memo" : "View the memo you signed"}</summary><div class="pdf-form" data-record-id="${record.id}"><p class="pdf-form-loading">Loading form…</p></div></details>`
          : `${isPdf ? `<div class="pdf-form" data-record-id="${record.id}"><p class="pdf-form-loading">Loading form…</p></div>` : ""}
        ${pointsHtml}
        ${termsHtml}
        ${signBoxHtml}`}
      </div>`;
  }

  const det = myDetailsCardHtml(pdfJobs.filter((j) => j.record.status === "awaiting_signature").map((j) => j.template));
  if (det.blocking) { pdfJobs.length = 0; setDealsBadge(waiting); }
  body.innerHTML = cardsHtml ? det.html + (det.blocking ? `<p class="muted">${escHtml(det.wait || "Your forms will appear here, filled in, as soon as you save this.")}</p>` : cardsHtml) : `<p class="empty">Nothing to sign right now.</p>`;
  const sd = document.getElementById("saveMyDetails"); if (sd) sd.addEventListener("click", saveMyDetails);
  dmCardAlt(body);
  dmWizard(body);
  renderQuestionPreviews(body, new Map((templates || []).map((t) => [t.id, t]))).catch(() => {});
  setDealsBadge(waiting);
  pdfJobs.forEach(({ template, record }) => {
    const holder = body.querySelector(`.pdf-form[data-record-id="${record.id}"]`);
    if (!holder) return;
    renderPdfForm(holder, template, {
      mode: record.status === "awaiting_signature" ? "fill" : "view",
      values: record.field_values, employeeSig: record.employee_signature, adminSig: record.admin_signature,
    }).catch((err) => { holder.innerHTML = `<p class="empty" style="text-align:left;">Couldn't load this form: ${escHtml(err.message || String(err))}</p>`; });
  });
  body.querySelectorAll("button[data-sign-id]").forEach((btn) => {
    btn.addEventListener("click", () => signDeal(btn.dataset.signId));
  });
  body.querySelectorAll('input[id^="sign-"]').forEach((input) => {
    const preview = document.getElementById(`sign-preview-${input.id.replace("sign-", "")}`);
    if (!preview) return;
    const rid = input.id.replace("sign-", "");
    input.addEventListener("input", () => {
      preview.textContent = input.value;
      body.querySelectorAll(`.pdf-form[data-record-id="${rid}"] .pf-sig[data-kind="signature"]`).forEach((s) => { s.textContent = input.value; });
    });
  });
}

async function signDeal(recordId) {
  const nameInput = document.getElementById(`sign-${recordId}`);
  const name = nameInput.value.trim();
  if (!name) {
    window.alert("Type your full name to sign.");
    return;
  }
  const update = {
    employee_signature: name,
    employee_signed_at: new Date().toISOString(),
    status: "awaiting_countersignature",
  };
  const ctx = dealCtx[recordId];
  if (ctx && ctx.template.source_pdf_path) {
    const holder = document.querySelector(`.pdf-form[data-record-id="${recordId}"]`);
    const { values, missing } = collectPdfValues(holder, ctx.template);
    if (missing.length) {
      window.alert("Please fill in: " + missing.slice(0, 5).join(", ") + (missing.length > 5 ? "…" : ""));
      return;
    }
    update.field_values = values;
  }
  const { error } = await client.from("esign_records").update(update).eq("id", recordId);
  if (error) { window.alert("Couldn't save your signature: " + error.message); return; }
  loadMyDeals();
}
