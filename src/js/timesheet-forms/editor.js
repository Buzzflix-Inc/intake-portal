// ----- Admin: timesheet form editor -----
let allTsTemplates = [];
let tsTpl = { bytes: null, pages: [], fields: [], editingId: null };

function tsTplReset() {
  tsTpl = { bytes: null, pages: [], fields: [], editingId: null };
  document.getElementById("tsTplPdf").value = "";
  document.getElementById("tsTplPages").innerHTML = "";
  document.getElementById("tsTplFieldList").innerHTML = "";
  document.getElementById("tsTplEditorWrap").classList.add("hidden");
  document.getElementById("tsTplSave").textContent = "Save timesheet form";
  document.getElementById("tsTplName").value = "";
  document.getElementById("tsTplUnion").value = "";
}

async function tsTplOpen(bytes, fields, extra) {
  const pdfjs = await ensurePdfJs();
  const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  if (pdf.numPages > 6) throw new Error("A timesheet form shouldn't be more than 6 pages.");
  document.getElementById("tsTplEditorWrap").classList.remove("hidden");
  const pages = await renderPdfPages(document.getElementById("tsTplPages"), pdf, { hideFormValues: true });
  const x = extra || {};
  tsTpl = { bytes, pages, fields: fields || [], editingId: x.editingId || null, pdf };
  if (!fields) tsTpl.fields = await tsDetectFields(pdf, bytes);
  document.getElementById("tsTplDetails").open = tsTpl.fields.length <= 14;
  pages.forEach((page, idx) => {
    page.el.addEventListener("click", (e) => {
      if (e.target.closest(".pdf-field")) return;
      const rect = page.el.getBoundingClientRect();
      if (e.target.closest(".pf-pop")) return;
      const kind = tsTool;
      const w = kind === "free_check" ? 0.016 : kind === "signature" ? 0.24 : 0.16, h = kind === "free_check" ? 0.012 : kind === "signature" ? 0.04 : 0.022;
      const nf = {
        id: "t" + Math.random().toString(36).slice(2, 8), bind: kind, type: tsFieldType(kind), page: idx,
        label: kind === "free_check" ? "Tick if it applies" : kind === "signature" ? "Employee signature" : kind === "fixed" ? "Field" : "Details",
        x: clamp((e.clientX - rect.left) / rect.width, 0, 1 - w), y: clamp((e.clientY - rect.top) / rect.height - h / 2, 0, 1 - h), w, h,
      };
      tsTpl.fields.push(nf);
      tsTplDraw();
      tsOpenPop(nf.id, true);
    });
  });
  tsTplDraw();
}

// ---- Edit a timesheet box right where it sits ----
let tsTool = "free", tsActive = null;
document.querySelectorAll("#tsTplToolbar [data-tstool]").forEach((b) => b.addEventListener("click", () => {
  tsTool = b.dataset.tstool;
  document.querySelectorAll("#tsTplToolbar [data-tstool]").forEach((x) => x.classList.toggle("active", x === b));
}));
function tsClosePop() {
  document.querySelectorAll("#tsTplPages .pf-pop").forEach((n) => n.remove());
  document.querySelectorAll("#tsTplPages .pdf-field.pf-active").forEach((n) => n.classList.remove("pf-active"));
}
function tsOrdered() { return tsTpl.fields.slice().sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x); }
function tsPosPop() {
  const pop = document.querySelector("#tsTplPages .pf-pop");
  const f = tsTpl.fields.find((x) => x.id === tsActive);
  if (!pop || !f) return;
  pop.style.left = `min(${(f.x * 100).toFixed(3)}%, calc(100% - 278px))`;
  if (f.y > 0.72) { pop.style.top = ""; pop.style.bottom = `calc(${((1 - f.y) * 100).toFixed(3)}% + 6px)`; }
  else { pop.style.bottom = ""; pop.style.top = `calc(${((f.y + f.h) * 100).toFixed(3)}% + 6px)`; }
}
function tsOpenPop(id, focusName, keepScroll) {
  const f = tsTpl.fields.find((x) => x.id === id);
  const page = f && tsTpl.pages[f.page];
  if (!f || !page) return;
  tsActive = id;
  tsClosePop();
  const fe = page.el.querySelector(`.pdf-field[data-field-id="${id}"]`);
  if (fe) fe.classList.add("pf-active");
  const order = tsOrdered(), pos = order.findIndex((x) => x.id === id);
  const named = f.bind === "free" || f.bind === "free_check" || f.bind === "fixed";
  const guess = f.bind === "free" ? dmGuessBind(f.label, "text") : "";
  const pop = document.createElement("div");
  pop.className = "pf-pop";
  pop.innerHTML = `
    <div class="pf-pop-head">
      <select class="pf-pop-bindsel" style="max-width:190px;">${tsBindOptionsHtml(f.bind)}</select>
      <span class="pf-pop-pos">${pos + 1} of ${order.length}</span>
      <button type="button" class="pf-pop-x" aria-label="Close">×</button>
    </div>
    ${named ? `<input type="text" class="pf-pop-name" placeholder="What is this box? (shown to the employee)" />` : `<div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px;">Filled in automatically from the timesheet.</div>`}
    ${f.bind === "fixed" ? `<input type="text" class="pf-pop-val" placeholder="Text to print (e.g. production title)" />` : ""}
    ${f.bind === "free" ? `<label class="pf-pop-opt"><input type="checkbox" class="pf-pop-optbox"${f.optional ? " checked" : ""} /> Optional (employee can leave it blank)</label>` : ""}
    ${guess ? `<div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px;">Pre-filled from the employee's details (they can still change it).</div>` : ""}
    <div class="pf-pop-actions">
      <button type="button" class="pf-pop-prev" title="Previous box">&#9664;</button>
      <button type="button" class="pf-pop-next" title="Next box (Enter)">Next &#9654;</button>
      <button type="button" class="pf-pop-rm">Remove</button>
    </div>`;
  page.el.appendChild(pop);
  ["pointerdown", "click"].forEach((ev) => pop.addEventListener(ev, (e) => e.stopPropagation()));
  const go = (delta) => {
    const o = tsOrdered(); const i = o.findIndex((x) => x.id === id);
    const n = o[(i + delta + o.length) % o.length];
    if (n) tsOpenPop(n.id, true);
  };
  const name = pop.querySelector(".pf-pop-name");
  if (name) {
    name.value = f.label || "";
    name.addEventListener("input", () => {
      f.label = name.value;
      if (fe && f.bind !== "fixed") { fe.title = tsBindCaption(f); const lb = fe.querySelector(".pf-label"); if (lb && f.type !== "checkbox") lb.textContent = tsBindCaption(f); }
      tsTplFieldList();
    });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { tsActive = null; tsClosePop(); }
    });
  }
  const val = pop.querySelector(".pf-pop-val");
  if (val) {
    val.value = f.value || "";
    val.addEventListener("input", () => { f.value = val.value; if (fe) { const lb = fe.querySelector(".pf-label"); if (lb) lb.textContent = tsBindCaption(f); } tsTplFieldList(); });
    val.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); } });
  }
  const ob = pop.querySelector(".pf-pop-optbox");
  if (ob) ob.addEventListener("change", () => { f.optional = ob.checked; tsTplDraw(); tsOpenPop(id, false, true); });
  pop.querySelector(".pf-pop-bindsel").addEventListener("change", (e) => {
    f.bind = e.target.value;
    if ((f.bind === "free" || f.bind === "fixed" || f.bind === "free_check") && !f.label) f.label = f.bind === "free_check" ? "Tick if it applies" : "Field";
    tsTplDraw(); tsOpenPop(id, true, true);
  });
  pop.querySelector(".pf-pop-next").addEventListener("click", () => go(1));
  pop.querySelector(".pf-pop-prev").addEventListener("click", () => go(-1));
  pop.querySelector(".pf-pop-x").addEventListener("click", () => { tsActive = null; tsClosePop(); });
  pop.querySelector(".pf-pop-rm").addEventListener("click", () => {
    const o = tsOrdered(); const i = o.findIndex((x) => x.id === id);
    const nxt = o[i + 1] || o[i - 1] || null;
    tsTpl.fields = tsTpl.fields.filter((x) => x.id !== id);
    tsActive = nxt ? nxt.id : null;
    tsTplDraw();
    if (tsActive) tsOpenPop(tsActive, true);
  });
  tsPosPop();
  if (focusName && name) { name.focus(); name.select(); }
  if (!keepScroll && fe) fe.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
}

function tsTplDraw() {
  tsClosePop();
  tsTpl.pages.forEach((p) => p.el.querySelectorAll(".pdf-field").forEach((n) => n.remove()));
  tsTpl.fields.forEach((f) => {
    const page = tsTpl.pages[f.page];
    if (!page) return;
    f.type = tsFieldType(f.bind);
    const el = baseFieldEl(f, page);
    el.classList.add("pf-edit", "ts-" + (f.bind === "free" || f.bind === "free_check" ? "free" : f.bind === "fixed" ? "fixed" : "bound"));
    el.innerHTML = `<span class="pf-label"></span><span class="pf-handle"></span>`;
    el.querySelector(".pf-label").textContent = f.type === "checkbox" ? "" : tsBindCaption(f);
    el.title = tsBindCaption(f);
    attachFieldDrag(el, f, page);
    el.addEventListener("pointerdown", (e) => { el._sx = e.clientX; el._sy = e.clientY; });
    el.addEventListener("click", (e) => {
      if (Math.hypot(e.clientX - (el._sx || 0), e.clientY - (el._sy || 0)) > 4) return;   // that was a drag
      tsOpenPop(f.id, false);
    });
    el.addEventListener("pointerup", () => { if (tsActive === f.id) setTimeout(() => tsPosPop(), 0); });
    if (f.optional) el.classList.add("pf-opt");
    page.el.appendChild(el);
  });
  tsTplFieldList();
  const n = tsTpl.fields.length;
  const free = tsTpl.fields.filter((f) => f.bind === "free" || f.bind === "free_check").length;
  document.getElementById("tsTplSummary").textContent =
    n ? `${n} box${n === 1 ? "" : "es"} found: ${n - free} linked to the timesheet${free ? `, ${free} for the employee to fill in` : ""}. Check the links below and fix any that are wrong.`
      : "No boxes were found automatically. Click on the form to add one, then choose what it links to.";
}

function tsTplFieldList() {
  const ul = document.getElementById("tsTplFieldList");
  ul.innerHTML = "";
  const order = [...tsTpl.fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  order.forEach((f) => {
    const li = document.createElement("li");
    li.dataset.fid = f.id;
    const sel = document.createElement("select");
    sel.innerHTML = tsBindOptionsHtml(f.bind);
    sel.addEventListener("change", () => {
      f.bind = sel.value;
      if ((f.bind === "free" || f.bind === "fixed") && !f.label) f.label = "Field";
      tsTplDraw();
    });
    li.appendChild(sel);
    if (f.bind === "free" || f.bind === "fixed" || f.bind === "free_check") {
      const lab = document.createElement("input");
      lab.type = "text"; lab.value = f.label || ""; lab.placeholder = "Label shown to the employee";
      lab.addEventListener("input", () => { f.label = lab.value; const e = document.querySelector(`#tsTplPages .pdf-field[data-field-id="${f.id}"] .pf-label`); if (e && f.bind !== "fixed") e.textContent = tsBindCaption(f); });
      li.appendChild(lab);
    }
    if (f.bind === "fixed") {
      const val = document.createElement("input");
      val.type = "text"; val.value = f.value || ""; val.placeholder = "Text to print (e.g. production title)";
      val.addEventListener("input", () => { f.value = val.value; const e = document.querySelector(`#tsTplPages .pdf-field[data-field-id="${f.id}"] .pf-label`); if (e) e.textContent = tsBindCaption(f); });
      li.appendChild(val);
    }
    const pg = document.createElement("span");
    pg.style.cssText = "font-size:11.5px;color:var(--ink-faint);white-space:nowrap;";
    pg.textContent = "p. " + (f.page + 1);
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "remove-link"; rm.textContent = "Remove";
    rm.addEventListener("click", () => { tsTpl.fields = tsTpl.fields.filter((x) => x !== f); tsTplDraw(); });
    li.append(pg, rm);
    ul.appendChild(li);
  });
}

document.getElementById("tsTplPdf").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  const msgEl = document.getElementById("tsTplMsg");
  if (!file) { tsTplReset(); return; }
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { msgEl.innerHTML = `<div class="msg error">That isn't a PDF.</div>`; ev.target.value = ""; return; }
  if (file.size > 10 * 1024 * 1024) { msgEl.innerHTML = `<div class="msg error">That PDF is over 10 MB.</div>`; ev.target.value = ""; return; }
  msgEl.innerHTML = `<div class="msg ok">Reading the form…</div>`;
  try {
    const nameEl = document.getElementById("tsTplName");
    if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
    await tsTplOpen(new Uint8Array(await file.arrayBuffer()), null, {});
    msgEl.innerHTML = "";
  } catch (err) {
    tsTplReset();
    msgEl.innerHTML = `<div class="msg error">${escHtml(err.message || "Couldn't read that PDF.")}</div>`;
  }
});
document.getElementById("tsTplRedetect").addEventListener("click", async () => {
  if (!tsTpl.bytes) return;
  const msgEl = document.getElementById("tsTplMsg"), btn = document.getElementById("tsTplRedetect");
  btn.disabled = true;
  msgEl.innerHTML = `<div class="msg ok">Looking for more boxes (scanned pages take a little longer)…</div>`;
  try {
    const found = await tsDetectFields(tsTpl.pdf, tsTpl.bytes);
    let added = 0;
    found.forEach((g) => {
      const gx = g.x + g.w / 2, gy = g.y + g.h / 2;
      const clash = tsTpl.fields.some((f) => f.page === g.page && ((gx > f.x - 0.01 && gx < f.x + f.w + 0.01 && gy > f.y - 0.01 && gy < f.y + f.h + 0.01) || (f.x + f.w / 2 > g.x - 0.01 && f.x + f.w / 2 < g.x + g.w + 0.01 && f.y + f.h / 2 > g.y - 0.01 && f.y + f.h / 2 < g.y + g.h + 0.01)));
      if (!clash) { tsTpl.fields.push(g); added++; }
    });
    tsTplDraw();
    msgEl.innerHTML = `<div class="msg ok">${added ? `Added ${added} new box${added === 1 ? "" : "es"}. Your existing boxes were kept.` : "No new boxes found. Your existing boxes were kept."}</div>`;
  } catch (err) { msgEl.innerHTML = `<div class="msg error">${escHtml(err.message || "Detection failed.")}</div>`; }
  btn.disabled = false;
});
document.getElementById("tsTplClear").addEventListener("click", () => {
  if (!tsTpl.bytes || !tsTpl.fields.length) return;
  if (!window.confirm("Remove every box on this form? You can use Find boxes again to start over.")) return;
  tsTpl.fields = []; tsActive = null; tsTplDraw();
});
document.getElementById("tsTplCancel").addEventListener("click", () => { tsTplReset(); document.getElementById("tsTplMsg").innerHTML = ""; });

document.getElementById("tsTplSave").addEventListener("click", async () => {
  const msgEl = document.getElementById("tsTplMsg");
  const name = document.getElementById("tsTplName").value.trim();
  const union_name = document.getElementById("tsTplUnion").value.trim() || null;
  if (!tsTpl.bytes) { msgEl.innerHTML = `<div class="msg error">Upload a blank timesheet first.</div>`; return; }
  if (!name) { msgEl.innerHTML = `<div class="msg error">Give this form a name.</div>`; return; }
  if (!tsTpl.fields.length) { msgEl.innerHTML = `<div class="msg error">Add at least one box.</div>`; return; }
  if (tsTpl.fields.some((f) => f.bind === "fixed" && !(f.value || "").trim())) { msgEl.innerHTML = `<div class="msg error">A "Fixed text" box has no text yet. Fill it in or remove the box.</div>`; return; }
  const fields = tsTpl.fields.map((f) => ({ ...f, type: tsFieldType(f.bind) }));
  const btn = document.getElementById("tsTplSave");
  btn.disabled = true;
  msgEl.innerHTML = `<div class="msg ok">Saving…</div>`;
  if (tsTpl.editingId) {
    const { error } = await client.from("timesheet_templates").update({ name, union_name, fields }).eq("id", tsTpl.editingId);
    btn.disabled = false;
    if (error) { msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
  } else {
    const path = `${currentCompany.id}/templates/${crypto.randomUUID()}.pdf`;
    const up = await client.storage.from(DEAL_BUCKET).upload(path, new Blob([tsTpl.bytes], { type: "application/pdf" }), { contentType: "application/pdf" });
    if (up.error) { btn.disabled = false; msgEl.innerHTML = `<div class="msg error">${escHtml(up.error.message)}</div>`; return; }
    const { error } = await client.from("timesheet_templates").insert({ company_id: currentCompany.id, name, union_name, source_pdf_path: path, fields });
    btn.disabled = false;
    if (error) {
      try { await client.storage.from(DEAL_BUCKET).remove([path]); } catch (_) {}
      msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return;
    }
  }
  msgEl.innerHTML = `<div class="msg ok">Timesheet form saved. Pick it on an invite to use it.</div>`;
  tsTplReset();
  loadTsTemplates();
});

async function loadTsTemplates() {
  const { data, error } = await client.from("timesheet_templates").select("*").order("created_at", { ascending: true });
  allTsTemplates = error ? [] : (data || []);
  const listEl = document.getElementById("tsTplList");
  const emptyEl = document.getElementById("tsTplEmpty");
  if (listEl) {
    listEl.innerHTML = "";
    emptyEl.classList.toggle("hidden", allTsTemplates.length > 0);
    allTsTemplates.forEach((t) => {
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.className = "info";
      const linked = (t.fields || []).filter((f) => f.bind !== "free" && f.bind !== "free_check").length;
      left.innerHTML = `<span class="name">${escHtml(t.name)}</span><span class="email">${t.union_name ? escHtml(t.union_name) + " · " : ""}${(t.fields || []).length} boxes (${linked} linked)</span>`;
      const right = document.createElement("span");
      right.className = "actions";
      const edit = document.createElement("button");
      edit.className = "remove-link"; edit.style.marginRight = "10px"; edit.textContent = "Edit";
      edit.addEventListener("click", async () => {
        const msgEl = document.getElementById("tsTplMsg");
        msgEl.innerHTML = `<div class="msg ok">Loading…</div>`;
        try {
          const bytes = new Uint8Array(await loadTemplatePdfBytes(t.source_pdf_path));
          document.getElementById("tsTplName").value = t.name;
          document.getElementById("tsTplUnion").value = t.union_name || "";
          await tsTplOpen(bytes, JSON.parse(JSON.stringify(t.fields || [])), { editingId: t.id });
          document.getElementById("tsTplSave").textContent = "Save changes";
          msgEl.innerHTML = "";
          expandPanelOf(document.getElementById("tsTplEditorWrap"));
          document.getElementById("tsTplEditorWrap").scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) { msgEl.innerHTML = `<div class="msg error">${escHtml(err.message || "Couldn't open it.")}</div>`; }
      });
      const del = document.createElement("button");
      del.className = "remove-link"; del.textContent = "Delete";
      del.addEventListener("click", async () => {
        if (!window.confirm("Delete this timesheet form? People assigned to it go back to the standard timesheet. Past submissions are kept.")) return;
        await client.from("timesheet_templates").delete().eq("id", t.id);
        try { await client.storage.from(DEAL_BUCKET).remove([t.source_pdf_path]); } catch (_) {}
        loadTsTemplates();
      });
      right.append(edit, del);
      li.append(left, right);
      listEl.appendChild(li);
    });
  }
  const sel = document.getElementById("inviteTimesheetSelect");
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">Standard portal timesheet</option>` + allTsTemplates.map((t) => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("");
    sel.value = cur || "";
  }
}
