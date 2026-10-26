// ---- PDF deal memos: upload a blank PDF, place fillable fields ----
const DEAL_BUCKET = "deal-memos";
const FIELD_KINDS = {
  text:             { label: "Text",               w: 0.32,  h: 0.026 },
  date:             { label: "Date",               w: 0.16,  h: 0.026 },
  checkbox:         { label: "Checkbox",           w: 0.026, h: null  },
  signature:        { label: "Employee signature", w: 0.28,  h: 0.05  },
  countersignature: { label: "Company signature",  w: 0.28,  h: 0.05  },
};
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

let pdfLibReady = null;
function ensurePdfLib() {
  if (pdfLibReady) return pdfLibReady;
  pdfLibReady = new Promise((resolve, reject) => {
    if (window.PDFLib) { resolve(window.PDFLib); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
    s.onload = () => resolve(window.PDFLib);
    s.onerror = () => { pdfLibReady = null; reject(new Error("Could not load the PDF tools. Check your connection and try again.")); };
    document.head.appendChild(s);
  });
  return pdfLibReady;
}

// Keeps each page's pixel width in a CSS variable so field text scales with the page.
const pageRO = new ResizeObserver((entries) => {
  entries.forEach((e) => e.target.style.setProperty("--pw", e.contentRect.width + "px"));
});

async function renderPdfPages(container, pdf, opts) {
  container.innerHTML = "";
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(1.6, 1100 / base.width) });
    const wrap = document.createElement("div");
    wrap.className = "pdf-page";
    wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, ...(opts && opts.hideFormValues ? { annotationMode: 0 } : {}) }).promise;
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    pageRO.observe(wrap);
    pages.push({ el: wrap, w: vp.width, h: vp.height });
  }
  return pages;
}

function applyFieldGeom(el, f, page) {
  el.style.left = (f.x * 100) + "%";
  el.style.top = (f.y * 100) + "%";
  el.style.width = (f.w * 100) + "%";
  el.style.height = (f.h * 100) + "%";
  const isSig = f.type === "signature" || f.type === "countersignature";
  const frac = f.h * (page.h / page.w) * (isSig ? 0.8 : 0.6);
  el.style.fontSize = `calc(var(--pw, 800px) * ${frac.toFixed(5)})`;
}
function baseFieldEl(f, page) {
  const el = document.createElement("div");
  el.className = "pdf-field pf-" + f.type;
  el.dataset.fieldId = f.id;
  applyFieldGeom(el, f, page);
  return el;
}

// ----- Admin editor -----
let tplPdf = { bytes: null, pages: [], fields: [] };
let pdfTool = "text";

function clearTemplatePdf() {
  tplPdf = { bytes: null, pages: [], fields: [] };
  document.getElementById("saveTemplateBtn").textContent = "Save template";
  document.getElementById("pfClearPdf").textContent = "Remove PDF";
  document.getElementById("templatePdfInput").value = "";
  document.getElementById("pfPagesInput").value = "";
  document.getElementById("pdfEditorPages").innerHTML = "";
  document.getElementById("pdfFieldList").innerHTML = "";
  document.getElementById("pdfEditorWrap").classList.add("hidden");
  document.getElementById("manualTemplateFields").classList.remove("hidden");
}

document.getElementById("pfClearPdf").addEventListener("click", clearTemplatePdf);
[["pfAllRequired", false], ["pfAllOptional", true]].forEach(([id, v]) => document.getElementById(id).addEventListener("click", () => {
  tplPdf.fields.forEach((f) => { if (f.type === "text" || f.type === "date") f.optional = v; });
  drawEditorFields();
}));
document.getElementById("pfRewording").addEventListener("click", async () => {
  const btn = document.getElementById("pfRewording"), msg = document.getElementById("templateMsg");
  btn.disabled = true;
  msg.innerHTML = `<div class="msg ok">Reading the words around each box…</div>`;
  try {
    const n = await dmRefreshWording();
    drawEditorFields();
    msg.innerHTML = `<div class="msg ok">Reworded ${n} vague box${n === 1 ? "" : "es"} into clear questions${dmAltLinked ? ` and linked ${dmAltLinked} either/or box${dmAltLinked === 1 ? "" : "es"} (answering one removes the other)` : ""}. Check them, then save the template.</div>`;
  } catch (err) {
    msg.innerHTML = `<div class="msg error">Couldn't read the page (${escHtml(err.message || "unknown error")}). You can still rename boxes by clicking them.</div>`;
  }
  btn.disabled = false;
});
// Either/or answers: list each linked group with an Unlink button; "Find either/or answers" scans the PDF for them.
function renderAltList() {
  const box = document.getElementById("pfAltList");
  if (!box || typeof tplPdf === "undefined" || !tplPdf) return;
  const groups = new Map();
  (tplPdf.fields || []).forEach((f) => { if (f.alt && f.alt.g) { if (!groups.has(f.alt.g)) groups.set(f.alt.g, []); groups.get(f.alt.g).push(f); } });
  if (!groups.size) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const kindOf = (g) => /-yn\d/.test(g) ? "Yes / No" : /-or\d/.test(g) ? "A or B" : /-co\d/.test(g) ? "Check one" : /-sa\d/.test(g) ? "Same as above, or a different one" : "Either / or";
  const brLabel = (b) => ({ yes: "If yes", no: "If no", a: "First choice", b: "Second choice" }[b] || "Choice " + (String(b).replace(/\D/g, "") * 1 + 1));
  box.classList.remove("hidden");
  box.innerHTML = `<div style="font-size:12.5px;margin:2px 0 6px;"><b>Either/or answers</b> <span style="color:var(--ink-faint);">The employee only has to answer one side. Boxes outlined in purple are linked.</span></div>` +
    [...groups.entries()].map(([g, fs]) => {
      const byB = new Map(); fs.forEach((f) => { const k = f.alt.b; if (!byB.has(k)) byB.set(k, []); byB.get(k).push(f); });
      const lines = [...byB.entries()].map(([b, arr]) => `${escHtml(brLabel(b))}: ${arr.slice(0, 4).map((f) => escHtml((f.label || "box").slice(0, 38))).join(", ")}${arr.length > 4 ? ` +${arr.length - 4} more` : ""}`).join(" &nbsp;·&nbsp; ");
      return `<div class="pf-altrow"><div><span class="alt-kind">${kindOf(g)}</span> <span style="color:var(--ink-faint);">· page ${fs[0].page + 1}</span><div class="alt-members">${lines}</div></div><button type="button" class="remove-link" data-unlink="${escHtml(g)}">Unlink</button></div>`;
    }).join("");
  box.querySelectorAll("[data-unlink]").forEach((b) => b.addEventListener("click", () => {
    tplPdf.fields.forEach((f) => { if (f.alt && f.alt.g === b.dataset.unlink) delete f.alt; });
    drawEditorFields();
  }));
}
document.getElementById("pfAltFind").addEventListener("click", async () => {
  const btn = document.getElementById("pfAltFind"), msg = document.getElementById("templateMsg");
  btn.disabled = true;
  msg.innerHTML = `<div class="msg ok">Looking for either/or sections (Yes/No, "OR", "check one")…</div>`;
  try {
    const pdfjs = await ensurePdfJs();
    const pdf = await pdfjs.getDocument({ data: tplPdf.bytes.slice(0) }).promise;
    const found = await dmDetectFields(pdf, tplPdf.bytes);
    const before = new Set(tplPdf.fields.filter((f) => f.alt && f.alt.g).map((f) => f.id));
    tplPdf.fields.forEach((f) => {
      const c = found.find((g) => g.page === f.page && g.alt && g.type === f.type && Math.abs((g.x + g.w / 2) - (f.x + f.w / 2)) < 0.04 && Math.abs((g.y + g.h / 2) - (f.y + f.h / 2)) < 0.025);
      if (c) f.alt = { ...c.alt };
    });
    const linked = tplPdf.fields.filter((f) => f.alt && f.alt.g);
    const groups = new Set(linked.map((f) => f.alt.g)).size;
    drawEditorFields();
    msg.innerHTML = groups
      ? `<div class="msg ok">Found ${groups} either/or section${groups === 1 ? "" : "s"} (${linked.length} boxes). The employee only has to answer one side, and the other side disappears or becomes optional. Check the list below the buttons and Unlink any that are wrong, then save the template.</div>`
      : `<div class="msg ok">No either/or sections found. If a form has one (for example a Yes/No with follow-up boxes), tick Optional on the boxes that aren't always needed.</div>`;
    void before;
  } catch (err) {
    msg.innerHTML = `<div class="msg error">Couldn't scan the PDF (${escHtml(err.message || "unknown error")}).</div>`;
  }
  btn.disabled = false;
});
document.getElementById("pfAutoFind").addEventListener("click", async () => {
  const btn = document.getElementById("pfAutoFind");
  btn.disabled = true;
  await runAutoPlace(document.getElementById("templateMsg"));
  btn.disabled = false;
});
document.querySelectorAll("#pfToolbar .pf-tool").forEach((btn) => {
  btn.addEventListener("click", () => {
    pdfTool = btn.dataset.tool;
    document.querySelectorAll("#pfToolbar .pf-tool").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

// Loads PDF bytes into the editor. `keep` lists which pages of the original
// PDF are showing (so page choices can be changed and fields follow their page).
async function showEditorPdf(bytes, fields, extra) {
  const pdfjs = await ensurePdfJs();
  const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  if (pdf.numPages > 30) throw new Error("That PDF has more than 30 pages. Split it into smaller PDFs first.");
  document.getElementById("pdfEditorWrap").classList.remove("hidden");
  document.getElementById("manualTemplateFields").classList.add("hidden");
  const pages = await renderPdfPages(document.getElementById("pdfEditorPages"), pdf);
  const x = extra || {};
  tplPdf = {
    bytes, pages, fields,
    original: x.original || bytes,
    keep: x.keep || pages.map((_, i) => i),
    editingId: x.editingId || null,
    oldPath: x.oldPath || null,
    changed: !!x.changed,
  };
  bindEditorPages(pages);
  document.getElementById("pfPageCount").textContent = `(${pages.length} page${pages.length === 1 ? "" : "s"} showing)`;
  drawEditorFields();
}

// "1-2, 5, 8-10" -> [0,1,4,7,8,9] (zero-based, in the order typed, no repeats)
function parsePageList(text, total) {
  const out = [];
  for (const part of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`"${part}" isn't a page number or range.`);
    const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from || to > total) throw new Error(`Pages must be between 1 and ${total}.`);
    for (let n = from; n <= to; n++) if (!out.includes(n - 1)) out.push(n - 1);
  }
  return out;
}

async function subsetPdf(bytes, indices) {
  const L = await ensurePdfLib();
  const src = await L.PDFDocument.load(bytes);
  const out = await L.PDFDocument.create();
  (await out.copyPages(src, indices)).forEach((pg) => out.addPage(pg));
  return new Uint8Array(await out.save());
}

document.getElementById("pfApplyPages").addEventListener("click", async () => {
  const msgEl = document.getElementById("templateMsg");
  if (!tplPdf.original) return;
  const btn = document.getElementById("pfApplyPages");
  try {
    const L = await ensurePdfLib();
    const total = (await L.PDFDocument.load(tplPdf.original)).getPageCount();
    const text = document.getElementById("pfPagesInput").value.trim();
    const newKeepAll = text ? parsePageList(text, total) : Array.from({ length: total }, (_, i) => i);
    // The page numbers typed refer to the PDF as first loaded.
    const prevKeep = tplPdf.keep;
    const kept = []; let dropped = 0;
    const remapped = tplPdf.fields.map((f) => ({ ...f })).filter((f) => {
      const np = newKeepAll.indexOf(prevKeep[f.page]);
      if (np === -1) { dropped++; return false; }
      f.page = np; kept.push(f); return true;
    });
    btn.disabled = true;
    msgEl.innerHTML = `<div class="msg ok">Updating pages…</div>`;
    const same = newKeepAll.length === total;
    const bytes = same ? tplPdf.original : await subsetPdf(tplPdf.original, newKeepAll);
    await showEditorPdf(new Uint8Array(bytes), remapped, {
      original: tplPdf.original, keep: newKeepAll, editingId: tplPdf.editingId, oldPath: tplPdf.oldPath, changed: true,
    });
    msgEl.innerHTML = `<div class="msg ok">Now showing ${newKeepAll.length} of ${total} page${total === 1 ? "" : "s"}.${dropped ? ` ${dropped} field${dropped === 1 ? "" : "s"} on removed pages ${dropped === 1 ? "was" : "were"} dropped.` : ""}</div>`;
  } catch (err) {
    msgEl.innerHTML = `<div class="msg error">${escHtml(err.message || "Couldn't change the pages.")}</div>`;
  } finally { btn.disabled = false; }
});

document.getElementById("templatePdfInput").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  const msgEl = document.getElementById("templateMsg");
  if (!file) { clearTemplatePdf(); return; }
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    msgEl.innerHTML = `<div class="msg error">That isn't a PDF.</div>`; ev.target.value = ""; return;
  }
  if (file.size > 10 * 1024 * 1024) {
    msgEl.innerHTML = `<div class="msg error">That PDF is over 10 MB. Try a smaller copy.</div>`; ev.target.value = ""; return;
  }
  msgEl.innerHTML = `<div class="msg ok">Loading PDF…</div>`;
  try {
    document.getElementById("pfPagesInput").value = "";
    await showEditorPdf(new Uint8Array(await file.arrayBuffer()), [], {});
    await runAutoPlace(msgEl);
  } catch (err) {
    clearTemplatePdf();
    msgEl.innerHTML = `<div class="msg error">${escHtml(err.message || "Could not read that PDF.")}</div>`;
  }
});

function bindEditorPages(pages) {
  pages.forEach((page, idx) => {
    page.el.addEventListener("click", (e) => {
      if (e.target.closest(".pdf-field") || e.target.closest(".pf-pop")) return;
      if (pfActive) { pfActive = null; closeFieldPop(); }
      const rect = page.el.getBoundingClientRect();
      const k = FIELD_KINDS[pdfTool];
      const w = k.w;
      const hgt = k.h != null ? k.h : w * (page.w / page.h);
      tplPdf.fields.push({
        id: "f" + Math.random().toString(36).slice(2, 8),
        type: pdfTool, label: k.label, page: idx,
        x: clamp((e.clientX - rect.left) / rect.width, 0, 1 - w),
        y: clamp((e.clientY - rect.top) / rect.height - hgt / 2, 0, 1 - hgt),
        w, h: hgt,
      });
      pfActive = tplPdf.fields[tplPdf.fields.length - 1].id;
      drawEditorFields();
      openFieldPop(pfActive, true);
    });
  });
}

// Re-open a saved PDF template to move, add or remove its fields.
async function editPdfTemplate(t) {
  const msgEl = document.getElementById("templateMsg");
  msgEl.innerHTML = `<div class="msg ok">Loading ${escHtml(t.name)}…</div>`;
  try {
    const bytes = new Uint8Array(await loadTemplatePdfBytes(t.source_pdf_path));
    document.getElementById("templatePdfInput").value = "";
    document.getElementById("pfPagesInput").value = "";
    await showEditorPdf(bytes, JSON.parse(JSON.stringify(t.fields || [])), { editingId: t.id, oldPath: t.source_pdf_path });
    document.getElementById("templateTypeSelect").value = t.type;
    document.getElementById("templateNameInput").value = t.name;
    document.getElementById("saveTemplateBtn").textContent = "Save changes";
    document.getElementById("pfClearPdf").textContent = "Cancel editing";
    msgEl.innerHTML = `<div class="msg ok">Editing "${escHtml(t.name)}". People who already signed keep their copy; anyone still waiting will see the updated version.</div>`;
    expandPanelOf(document.getElementById("pdfEditorWrap"));
    document.getElementById("pdfEditorWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    clearTemplatePdf();
    msgEl.innerHTML = `<div class="msg error">${escHtml(err.message || "Couldn't open that template.")}</div>`;
  }
}

// ---- Edit a box right where it sits: name, optional, type, remove, next/previous ----
let pfActive = null;
function closeFieldPop() {
  document.querySelectorAll("#pdfEditorPages .pf-pop").forEach((n) => n.remove());
  document.querySelectorAll("#pdfEditorPages .pdf-field.pf-active").forEach((n) => n.classList.remove("pf-active"));
}
function pfOrdered() {
  return tplPdf.fields.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}
function positionFieldPop() {
  const pop = document.querySelector("#pdfEditorPages .pf-pop");
  const f = tplPdf.fields.find((x) => x.id === pfActive);
  if (!pop || !f) return;
  pop.style.left = `min(${(f.x * 100).toFixed(3)}%, calc(100% - 278px))`;
  if (f.y > 0.72) { pop.style.top = ""; pop.style.bottom = `calc(${((1 - f.y) * 100).toFixed(3)}% + 6px)`; }
  else { pop.style.bottom = ""; pop.style.top = `calc(${((f.y + f.h) * 100).toFixed(3)}% + 6px)`; }
}
function openFieldPop(id, focusName, keepScroll) {
  const f = tplPdf.fields.find((x) => x.id === id);
  const page = f && tplPdf.pages[f.page];
  if (!f || !page) return;
  pfActive = id;
  closeFieldPop();
  const fe = page.el.querySelector(`.pdf-field[data-field-id="${id}"]`);
  if (fe) fe.classList.add("pf-active");
  const order = pfOrdered(), pos = order.findIndex((x) => x.id === id);
  const pop = document.createElement("div");
  pop.className = "pf-pop";
  const isCheck = f.type === "checkbox";
  pop.innerHTML = `
    <div class="pf-pop-head">
      ${isCheck ? `<strong>Checkbox</strong>` : `<select class="pf-pop-type">${["text", "date", "signature", "countersignature"].map((k) => `<option value="${k}"${k === f.type ? " selected" : ""}>${FIELD_KINDS[k].label}</option>`).join("")}</select>`}
      <span class="pf-pop-pos">${pos + 1} of ${order.length}</span>
      <button type="button" class="pf-pop-x" aria-label="Close">×</button>
    </div>
    <input type="text" class="pf-pop-name" placeholder="What is this field? (shown to the employee)" />
    ${f.type === "text" || f.type === "date" ? `<label class="pf-pop-opt"><input type="checkbox" class="pf-pop-optbox"${f.optional ? " checked" : ""} /> Optional (employee can leave it blank)</label>` : ""}
    ${f.type === "text" || f.type === "date" ? `<label class="pf-pop-opt">Autofill with <select class="pf-pop-bind"><option value="">Nothing (employee types it)</option>${Object.entries(DM_BINDS).map(([k, v]) => `<option value="${k}"${(f.bind === undefined ? dmGuessBind(f.label, f.type) : f.bind) === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>` : ""}
    <div class="pf-pop-actions">
      <button type="button" class="pf-pop-prev" title="Previous box">&#9664;</button>
      <button type="button" class="pf-pop-next" title="Next box (Enter)">Next &#9654;</button>
      <button type="button" class="pf-pop-rm">Remove</button>
    </div>`;
  page.el.appendChild(pop);
  ["pointerdown", "click"].forEach((ev) => pop.addEventListener(ev, (e) => e.stopPropagation()));
  const name = pop.querySelector(".pf-pop-name");
  name.value = f.label || "";
  name.addEventListener("input", () => {
    f.label = name.value;
    if (fe) { fe.title = f.label; const lb = fe.querySelector(".pf-label"); if (lb && f.type !== "checkbox") lb.textContent = f.label + (f.optional ? " (optional)" : ""); }
    const li = document.querySelector(`#pdfFieldList [data-fid="${f.id}"] input[type="text"]`);
    if (li) li.value = f.label;
  });
  const go = (delta) => {
    const o = pfOrdered(); const i = o.findIndex((x) => x.id === id);
    const n = o[(i + delta + o.length) % o.length];
    if (!n) return;
    openFieldPop(n.id, true);
  };
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { pfActive = null; closeFieldPop(); }
  });
  pop.querySelector(".pf-pop-next").addEventListener("click", () => go(1));
  pop.querySelector(".pf-pop-prev").addEventListener("click", () => go(-1));
  pop.querySelector(".pf-pop-x").addEventListener("click", () => { pfActive = null; closeFieldPop(); });
  pop.querySelector(".pf-pop-rm").addEventListener("click", () => {
    const o = pfOrdered(); const i = o.findIndex((x) => x.id === id);
    const nxt = o[i + 1] || o[i - 1] || null;
    tplPdf.fields = tplPdf.fields.filter((x) => x.id !== id);
    pfActive = nxt ? nxt.id : null;
    drawEditorFields();
    if (pfActive) openFieldPop(pfActive, true);
  });
  const ob = pop.querySelector(".pf-pop-optbox");
  if (ob) ob.addEventListener("change", () => { f.optional = ob.checked; drawEditorFields(); });
  const bs = pop.querySelector(".pf-pop-bind");
  if (bs) bs.addEventListener("change", () => { f.bind = bs.value; });
  const ty = pop.querySelector(".pf-pop-type");
  if (ty) ty.addEventListener("change", () => {
    const old = f.type; f.type = ty.value; if (f.type !== "text" && f.type !== "date") delete f.bind;
    if (f.type === "signature" || f.type === "countersignature") { f.optional = false; if (!f.label || f.label === FIELD_KINDS[old].label) f.label = FIELD_KINDS[f.type].label; }
    else if (!f.label || f.label === FIELD_KINDS[old].label) f.label = FIELD_KINDS[f.type].label;
    drawEditorFields();
  });
  positionFieldPop();
  if (focusName) { name.focus(); name.select(); }
  if (!keepScroll && fe) fe.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
}

function drawEditorFields() {
  tplPdf.pages.forEach((p) => p.el.querySelectorAll(".pdf-field").forEach((n) => n.remove()));
  tplPdf.fields.forEach((f) => {
    const page = tplPdf.pages[f.page];
    if (!page) return;
    const el = baseFieldEl(f, page);
    el.classList.add("pf-edit");
    if (f.optional) el.classList.add("pf-opt");
    if (f.alt && f.alt.g) el.classList.add("pf-alt");
    el.innerHTML = `<span class="pf-label"></span><span class="pf-handle"></span>`;
    el.querySelector(".pf-label").textContent = f.type === "checkbox" ? "" : f.label + (f.optional ? " (optional)" : "");
    el.title = f.label;
    attachFieldDrag(el, f, page);
    el.addEventListener("pointerdown", (e) => { el._sx = e.clientX; el._sy = e.clientY; });
    el.addEventListener("click", (e) => {
      if (Math.hypot(e.clientX - (el._sx || 0), e.clientY - (el._sy || 0)) > 4) return;   // that was a drag
      openFieldPop(f.id, false);
    });
    el.addEventListener("pointerup", () => { if (pfActive === f.id) setTimeout(() => positionFieldPop(), 0); });
    page.el.appendChild(el);
  });
  renderFieldList();
  renderAltList();
  if (pfActive && tplPdf.fields.some((x) => x.id === pfActive)) openFieldPop(pfActive, false, true); else { pfActive = null; closeFieldPop(); }
}

function attachFieldDrag(el, f, page) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const resizing = e.target.classList.contains("pf-handle");
    const rect = page.el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, ox = f.x, oy = f.y, ow = f.w, oh = f.h;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
      if (resizing) {
        f.w = clamp(ow + dx, 0.015, 1 - f.x);
        f.h = f.type === "checkbox" ? f.w * (page.w / page.h) : clamp(oh + dy, 0.012, 1 - f.y);
      } else {
        f.x = clamp(ox + dx, 0, 1 - f.w);
        f.y = clamp(oy + dy, 0, 1 - f.h);
      }
      applyFieldGeom(el, f, page);
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
}

function renderFieldList() {
  const ul = document.getElementById("pdfFieldList");
  ul.innerHTML = "";
  tplPdf.fields.forEach((f) => {
    const li = document.createElement("li");
    li.dataset.fid = f.id;
    const kind = document.createElement("span");
    kind.className = "pf-kind"; kind.textContent = FIELD_KINDS[f.type].label;
    const input = document.createElement("input");
    input.type = "text"; input.value = f.label; input.placeholder = "What is this field? (shown to the employee)";
    input.addEventListener("input", () => {
      f.label = input.value;
      const fe = document.querySelector(`#pdfEditorPages .pdf-field[data-field-id="${f.id}"]`);
      if (fe) { fe.title = f.label; const lb = fe.querySelector(".pf-label"); if (lb && f.type !== "checkbox") lb.textContent = f.label; }
    });
    const pg = document.createElement("span");
    pg.style.cssText = "font-size:11.5px;color:var(--ink-faint);white-space:nowrap;";
    pg.textContent = "p. " + (f.page + 1);
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "remove-link"; rm.textContent = "Remove";
    rm.addEventListener("click", () => { tplPdf.fields = tplPdf.fields.filter((x) => x !== f); drawEditorFields(); });
    const canOpt = f.type === "text" || f.type === "date";
    const opt = document.createElement("label");
    opt.style.cssText = "display:" + (canOpt ? "inline-flex" : "none") + ";align-items:center;gap:5px;font-size:12px;color:var(--ink-soft);white-space:nowrap;cursor:pointer;";
    const optBox = document.createElement("input");
    optBox.type = "checkbox"; optBox.checked = !!f.optional; optBox.style.cssText = "width:auto;margin:0;";
    optBox.addEventListener("change", () => {
      f.optional = optBox.checked;
      drawEditorFields();
    });
    opt.append(optBox, document.createTextNode("Optional"));
    li.append(kind, input, opt, pg, rm);
    ul.appendChild(li);
  });
}
