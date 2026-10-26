async function savePdfTemplate(type, name, msgEl) {
  if (!tplPdf.fields.length) {
    msgEl.innerHTML = `<div class="msg error">Click on the page to place at least one field.</div>`; return;
  }
  if (!tplPdf.fields.some((f) => f.type === "signature")) {
    msgEl.innerHTML = `<div class="msg error">Add an Employee signature field so people can sign.</div>`; return;
  }
  const btn = document.getElementById("saveTemplateBtn");
  btn.disabled = true;
  msgEl.innerHTML = `<div class="msg ok">Saving…</div>`;
  if (tplPdf.editingId) {
    const fieldsOut = tplPdf.fields.map((f) => ({ ...f, label: (f.label || "").trim() || FIELD_KINDS[f.type].label }));
    const patch = { name, type, fields: fieldsOut };
    let newPath = null;
    if (tplPdf.changed) {
      newPath = `${currentCompany.id}/templates/${crypto.randomUUID()}.pdf`;
      const up2 = await client.storage.from(DEAL_BUCKET).upload(newPath, new Blob([tplPdf.bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
      if (up2.error) { btn.disabled = false; msgEl.innerHTML = `<div class="msg error">${escHtml(up2.error.message)}</div>`; return; }
      patch.source_pdf_path = newPath;
    }
    const { error: upErr } = await client.from("esign_templates").update(patch).eq("id", tplPdf.editingId);
    btn.disabled = false;
    if (upErr) {
      if (newPath) { try { await client.storage.from(DEAL_BUCKET).remove([newPath]); } catch (_) {} }
      msgEl.innerHTML = `<div class="msg error">${escHtml(upErr.message)}</div>`; return;
    }
    if (newPath && tplPdf.oldPath) { try { await client.storage.from(DEAL_BUCKET).remove([tplPdf.oldPath]); } catch (_) {} }
    try { await client.rpc("admin_notify_template", { p_template: tplPdf.editingId }); } catch (_) {}
    msgEl.innerHTML = `<div class="msg ok">Changes saved. Anyone who hasn't signed it yet sees it flagged as updated.</div>`;
    document.getElementById("templateNameInput").value = "";
    clearTemplatePdf();
    loadTemplates();
    return;
  }
  const path = `${currentCompany.id}/templates/${crypto.randomUUID()}.pdf`;
  const fields = tplPdf.fields.map((f) => ({ ...f, label: (f.label || "").trim() || FIELD_KINDS[f.type].label }));
  const up = await client.storage.from(DEAL_BUCKET).upload(path, new Blob([tplPdf.bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (up.error) { btn.disabled = false; msgEl.innerHTML = `<div class="msg error">${escHtml(up.error.message)}</div>`; return; }
  const { error } = await client.from("esign_templates").insert({
    company_id: currentCompany.id, type, name, deal_points: [], terms_text: "",
    source_pdf_path: path, fields,
  });
  btn.disabled = false;
  if (error) {
    try { await client.storage.from(DEAL_BUCKET).remove([path]); } catch (_) {}
    msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return;
  }
  document.getElementById("templateNameInput").value = "";
  loadTemplates();
  // Splitting a packet: put the full PDF back so the next memo's pages can be picked.
  const orig = tplPdf.original;
  if (orig && tplPdf.keep.length !== (await (await ensurePdfLib()).PDFDocument.load(orig)).getPageCount()) {
    document.getElementById("pfPagesInput").value = "";
    await showEditorPdf(new Uint8Array(orig), [], {});
    msgEl.innerHTML = `<div class="msg ok">Template saved. The full PDF is back: pick the pages for the next memo, or press Remove PDF to finish.</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Template saved.</div>`;
  clearTemplatePdf();
}

// ----- Rendering a template for the employee (fill) or anyone (view) -----
async function loadTemplatePdfBytes(path) {
  const { data, error } = await client.storage.from(DEAL_BUCKET).download(path);
  if (error) throw error;
  return await data.arrayBuffer();
}

function localIso(d) { const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function bindValue(bind) {
  const inv = myInvite || {}, pr = myProfile || {};
  const full = (myFullName || "").trim();
  switch (bind) {
    case "full_name": return full;
    case "company": return (currentCompany && currentCompany.name) || "";
    case "first_name": return full.split(/\s+/)[0] || "";
    case "last_name": return full.split(/\s+/).slice(1).join(" ");
    case "email": return myEmail || "";
    case "phone": return pr.phone || inv.phone || "";
    case "dob": return pr.dob || "";
    case "address": return pr.address || "";
    case "city": return pr.city || "";
    case "province": return pr.province || "";
    case "postal_code": return pr.postal_code || "";
    case "position": return myCrewRole || "";
    case "department": return myDepartment || "";
    case "start_date": return inv.start_date || "";
    case "end_date": return inv.end_date || "";
    case "today": return localIso(new Date());
  }
  return "";
}

async function renderPdfForm(container, template, opts) {
  const bytes = await loadTemplatePdfBytes(template.source_pdf_path);
  const pdfjs = await ensurePdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  container.innerHTML = "";
  const box = document.createElement("div");
  container.appendChild(box);
  const pages = await renderPdfPages(box, pdf);
  const values = opts.values || {};
  (template.fields || []).forEach((f) => {
    const page = pages[f.page];
    if (!page) return;
    const el = baseFieldEl(f, page);
    const v = values[f.id];
    if (f.type === "signature" || f.type === "countersignature") {
      const s = document.createElement("span");
      s.className = "pf-sig"; s.dataset.kind = f.type; s.dataset.ph = f.label;
      s.textContent = (f.type === "signature" ? opts.employeeSig : opts.adminSig) || "";
      el.appendChild(s);
    } else if (opts.mode === "fill") {
      const inp = document.createElement("input");
      inp.className = "pf-input"; inp.dataset.fieldId = f.id; inp.setAttribute("aria-label", f.label);
      if (f.type === "checkbox") inp.type = "checkbox";
      else {
        inp.type = f.type === "date" ? "date" : "text"; inp.placeholder = f.label + (f.optional ? " (optional)" : "");
        const pre = dmFieldValue(template, f);
        if (pre) { inp.value = f.type === "date" ? String(pre).slice(0, 10) : pre; inp.classList.add("pf-auto"); inp.title = "Filled in for you. Edit it if it's wrong."; inp.addEventListener("input", () => inp.classList.remove("pf-auto")); }
      }
      el.appendChild(inp);
    } else {
      const s = document.createElement("span");
      s.className = "pf-val";
      s.textContent = f.type === "checkbox" ? (v ? "✕" : "") : (v || "");
      el.appendChild(s);
    }
    page.el.appendChild(el);
  });
  if (opts.mode === "fill") dmAltSetup(container, template);
}

// Wires up either/or boxes: answering one branch dims and clears the others, and they stop being required.
function dmAltSetup(container, template) {
  const fields = (template.fields || []).filter((f) => f.alt && f.alt.g);
  if (!fields.length) return;
  const groups = new Map();
  fields.forEach((f) => { if (!groups.has(f.alt.g)) groups.set(f.alt.g, []); groups.get(f.alt.g).push(f); });
  const inp = (f) => container.querySelector(`input[data-field-id="${f.id}"]`);
  const filled = (f) => { const i = inp(f); return !!i && (f.type === "checkbox" ? i.checked : !!i.value.trim()); };
  const state = new Map();
  const apply = (changed) => {
    groups.forEach((fs, g) => {
      const branches = [...new Set(fs.map((f) => f.alt.b))];
      let active = state.get(g);
      if (changed && changed.alt.g === g && filled(changed)) active = changed.alt.b;
      else if (!active || !fs.some((f) => f.alt.b === active && filled(f))) active = branches.find((b) => fs.some((f) => f.alt.b === b && filled(f))) || null;
      state.set(g, active);
      fs.forEach((f) => {
        const i = inp(f); if (!i) return;
        const na = !!active && f.alt.b !== active;
        if (na && filled(f)) { if (f.type === "checkbox") i.checked = false; else i.value = ""; }
        i.classList.toggle("pf-na", na);
        const wrap = i.closest(".pdf-field"); if (wrap) wrap.classList.toggle("pf-na", na);
        i.dataset.na = na ? "1" : "";
        if (na) i.classList.remove("pf-missing");
        if (f.type !== "checkbox") i.placeholder = na ? "Not needed" : f.label + (f.optional ? " (optional)" : "");
      });
    });
  };
  const handler = (e) => { const id = e.target && e.target.dataset && e.target.dataset.fieldId; const f = fields.find((x) => x.id === id); if (f) apply(f); };
  container.addEventListener("input", handler);
  container.addEventListener("change", handler);
  apply(null);
}

function collectPdfValues(container, template) {
  const values = {}, missing = [];
  const altSeen = new Map();   // group -> { any: bool, ask: label }
  (template.fields || []).forEach((f) => {
    const inp = container.querySelector(`input[data-field-id="${f.id}"]`);
    if (!inp) return;
    const na = inp.dataset.na === "1";
    const val = f.type === "checkbox" ? inp.checked : inp.value.trim();
    if (f.alt && f.alt.g) {
      const a = altSeen.get(f.alt.g) || { any: false, ask: "" };
      if (val && !na) a.any = true;
      if (!a.ask && !f.optional && f.type !== "checkbox") a.ask = f.label;
      altSeen.set(f.alt.g, a);
    }
    if (f.type === "checkbox") { values[f.id] = na ? false : inp.checked; return; }
    values[f.id] = na ? "" : val;
    const needed = !val && !f.optional && !na && !(f.alt && f.alt.g);
    inp.classList.toggle("pf-missing", needed);
    if (needed) missing.push(f.label);
  });
  altSeen.forEach((a, g) => {
    if (a.any || !a.ask) return;
    missing.push(a.ask + " (or its alternative)");
    (template.fields || []).filter((f) => f.alt && f.alt.g === g && !f.optional).forEach((f) => { const i = container.querySelector(`input[data-field-id="${f.id}"]`); if (i && f.type !== "checkbox") i.classList.add("pf-missing"); });
  });
  return { values, missing };
}

// ----- Stamping the filled form onto the original PDF -----
async function signaturePng(name) {
  try { await document.fonts.load('96px "Great Vibes"', name); } catch (_) {}
  const size = 96;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `${size}px "Great Vibes", cursive`;
  c.width = Math.ceil(ctx.measureText(name).width) + 30;
  c.height = Math.ceil(size * 1.6);
  ctx.font = `${size}px "Great Vibes", cursive`;
  ctx.fillStyle = "#1d2433";
  ctx.fillText(name, 12, size * 1.1);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
}

async function buildDealPdf(template, bytes, values, employeeSig, adminSig) {
  const PDFLib = await ensurePdfLib();
  const doc = await PDFLib.PDFDocument.load(bytes);
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const pages = doc.getPages();
  const ink = PDFLib.rgb(0.114, 0.141, 0.2);
  for (const f of template.fields || []) {
    const pg = pages[f.page];
    if (!pg) continue;
    const { width: W, height: H } = pg.getSize();
    const bx = f.x * W, bw = f.w * W, bh = f.h * H, by = H - f.y * H - bh;
    if (f.type === "text" || f.type === "date") {
      const raw = values[f.id];
      if (!raw) continue;
      const text = String(raw)
        .replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
      let size = bh * 0.6;
      while (size > 5 && font.widthOfTextAtSize(text, size) > bw - 4) size -= 0.5;
      pg.drawText(text, { x: bx + 2, y: by + (bh - size) / 2 + size * 0.2, size, font, color: ink });
    } else if (f.type === "checkbox") {
      if (!values[f.id]) continue;
      const m = Math.min(bw, bh) * 0.2;
      const opt = { thickness: 1.5, color: ink };
      pg.drawLine({ start: { x: bx + m, y: by + m }, end: { x: bx + bw - m, y: by + bh - m }, ...opt });
      pg.drawLine({ start: { x: bx + m, y: by + bh - m }, end: { x: bx + bw - m, y: by + m }, ...opt });
    } else if (f.type === "signature" || f.type === "countersignature") {
      const who = f.type === "signature" ? employeeSig : adminSig;
      if (!who) continue;
      const png = await signaturePng(who);
      const img = await doc.embedPng(png.bytes);
      const k = Math.min(bw / png.w, bh / png.h);
      pg.drawImage(img, { x: bx + 2, y: by + (bh - png.h * k) / 2, width: png.w * k, height: png.h * k });
    }
  }
  return await doc.save();
}

async function buildRecordPdf(recordId, adminName) {
  const { data: rec, error } = await client.from("esign_records").select("*").eq("id", recordId).single();
  if (error) throw error;
  const template = allTemplates.find((t) => t.id === rec.template_id);
  if (!template || !template.source_pdf_path) throw new Error("No PDF template on this record.");
  const bytes = await loadTemplatePdfBytes(template.source_pdf_path);
  const out = await buildDealPdf(template, bytes, rec.field_values || {}, rec.employee_signature, adminName);
  return { rec, template, out };
}

async function viewDealPdf(recordId) {
  const w = window.open("", "_blank");
  try {
    const { out } = await buildRecordPdf(recordId, null);
    const url = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
    if (w) w.location = url; else window.open(url, "_blank");
  } catch (err) {
    if (w) w.close();
    window.alert("Couldn't open that form: " + (err.message || err));
  }
}

async function openStoragePdf(path) {
  const w = window.open("", "_blank");
  const { data, error } = await client.storage.from(DEAL_BUCKET).createSignedUrl(path, 120);
  if (error || !data) { if (w) w.close(); window.alert("Couldn't open the signed PDF."); return; }
  if (w) w.location = data.signedUrl; else window.open(data.signedUrl, "_blank");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-final-path]");
  if (b) openStoragePdf(b.dataset.finalPath);
});
