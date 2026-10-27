// ---- Admin: everyone's files, sorted, filtered by date and downloaded as a .zip ----
// Documents, timesheets, invoices, paystubs and signed forms, newest first. Used on its own in the
// Employees panel (everyone) and inside a person's overview (just them). Signed forms built from a
// typed template have no stored PDF, so one is made on the spot.
const FILE_KINDS = [
  { key: "document", label: "Documents" },
  { key: "timesheet", label: "Timesheets" },
  { key: "invoice", label: "Invoices" },
  { key: "paystub", label: "Paystubs" },
  { key: "form", label: "Signed forms" },
];
const fileKindLabel = (k) => ({ document: "Document", timesheet: "Timesheet", invoice: "Invoice", paystub: "Paystub", form: "Signed form" }[k]);
const safeName = (s) => String(s || "file").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();

// Every file at the active production, or one person's, newest first.
async function gatherFiles(userId) {
  const q = (t, cols) => { const b = client.from(t).select(cols); return userId ? b.eq("user_id", userId) : b; };
  const [docs, sheets, stubs, forms, invites] = await Promise.all([
    q("documents", "id, user_id, doc_type, status, file_path, created_at"),
    q("timesheets", "id, user_id, status, file_path, created_at, week_start, entries, total_hours"),
    q("paystubs", "id, user_id, file_path, created_at"),
    q("esign_records", "id, user_id, template_id, type, status, field_values, employee_signature, employee_signed_at, admin_signature, admin_signed_at, final_pdf_path")
      .in("status", ["awaiting_countersignature", "countersigned"]),
    client.from("company_invites").select("email, full_name"),
  ]);
  const nameByEmail = new Map((invites.data || []).map((i) => [i.email, i.full_name]));
  const who = (uid) => { const em = profileMap.get(uid) || ""; return nameByEmail.get(String(em).toLowerCase()) || em || uid; };
  const day = (iso) => (iso ? String(iso).slice(0, 10) : "");
  const items = [];
  for (const r of docs.data || []) {
    items.push({ kind: "document", userId: r.user_id, person: who(r.user_id), date: day(r.created_at), status: r.status,
      title: r.doc_type || r.file_path.split("/").pop(), bucket: "documents", path: r.file_path });
  }
  for (const r of sheets.data || []) {
    const inv = invoiceOf(r);
    items.push({ kind: inv ? "invoice" : "timesheet", userId: r.user_id, person: who(r.user_id), date: inv ? inv.date || day(r.created_at) : r.week_start || day(r.created_at), status: r.status,
      title: inv ? `Invoice ${inv.number}` : r.week_start ? `Timesheet, week of ${periodLabel(r.week_start)}` : r.file_path.split("/").pop(), bucket: "timesheets", path: r.file_path });
  }
  for (const r of stubs.data || []) {
    items.push({ kind: "paystub", userId: r.user_id, person: who(r.user_id), date: day(r.created_at), status: "issued",
      title: ((n) => (/^paystub/i.test(n) ? n : `Paystub, ${n}`))(r.file_path.split("/").pop().replace(/^\d+-/, "").replace(/\.\w+$/, "")), bucket: "paystubs", path: r.file_path });
  }
  for (const r of forms.data || []) {
    const t = allTemplates.find((x) => x.id === r.template_id);
    items.push({ kind: "form", userId: r.user_id, person: who(r.user_id), date: day(r.admin_signed_at || r.employee_signed_at),
      status: r.status === "countersigned" ? "countersigned" : "awaiting countersignature",
      title: t ? t.name : r.type === "safety" ? "Safety acknowledgment" : "Deal memo",
      bucket: r.final_pdf_path ? DEAL_BUCKET : null, path: r.final_pdf_path, record: r, template: t });
  }
  items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.person.localeCompare(b.person));
  return items;
}

const filterFiles = (items, { from, to, kind }) =>
  items.filter((f) => (!kind || f.kind === kind) && (!from || f.date >= from) && (!to || f.date <= to));

// A plain PDF of a signed typed-template form: its points, terms and both signatures.
async function typedFormPdf(item) {
  const JsPDF = await ensureJsPdf();
  const doc = new JsPDF({ unit: "pt", format: "letter" });
  const r = item.record, t = item.template || {};
  let y = 64;
  const line = (text, opts) => {
    const o = opts || {};
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size || 11);
    for (const l of doc.splitTextToSize(String(text), 504)) { if (y > 740) { doc.addPage(); y = 64; } doc.text(l, 54, y); y += (o.size || 11) + 5; }
    y += o.gap || 0;
  };
  line(item.title, { bold: true, size: 17, gap: 4 });
  line(`${(currentCompany && currentCompany.name) || ""} · ${item.person}`, { gap: 12 });
  for (const dp of t.deal_points || []) line(`${dp.label}: ${dp.value}`);
  if (t.terms_text) { y += 8; line(t.terms_text, { gap: 12 }); }
  line(`Signed by ${r.employee_signature || ""} on ${r.employee_signed_at ? new Date(r.employee_signed_at).toLocaleDateString() : ""}`, { bold: true });
  if (r.admin_signature) line(`Countersigned by ${r.admin_signature} on ${new Date(r.admin_signed_at).toLocaleDateString()}`, { bold: true });
  else line("Not countersigned yet.");
  return doc.output("blob");
}

async function fileBlob(item) {
  if (!item.path) return typedFormPdf(item);
  const { data, error } = await client.storage.from(item.bucket).download(item.path);
  if (error) throw error;
  return data;
}
const fileNameOf = (item) => {
  const ext = item.path ? (item.path.split(".").pop() || "pdf") : "pdf";
  return safeName(`${item.date} ${item.title}`) + "." + ext;
};

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Zip of the given files: Person / Kind / date title.pdf (or Kind / … for one person).
async function downloadFilesZip(items, zipName, byPerson, onProgress) {
  const JSZip = await ensureJsZip();
  const zip = new JSZip();
  const used = new Set();
  let done = 0;
  for (const it of items) {
    const folder = (byPerson ? safeName(it.person) + "/" : "") + FILE_KINDS.find((k) => k.key === it.kind).label + "/";
    let name = folder + fileNameOf(it);
    for (let n = 2; used.has(name); n++) name = folder + fileNameOf(it).replace(/(\.\w+)$/, ` (${n})$1`);
    used.add(name);
    try { zip.file(name, await fileBlob(it)); } catch (_) { zip.file(name + ".missing.txt", "This file couldn't be read from storage."); }
    if (onProgress) onProgress(++done, items.length);
  }
  saveBlob(await zip.generateAsync({ type: "blob" }), zipName);
}

// The filter bar (type, from, to) plus a download button. Returns the controls.
function fileFilterBar(prefix, withList) {
  return `<div class="ef-bar">
    <div><label for="${prefix}Kind">Type</label><select id="${prefix}Kind"><option value="">All files</option>${FILE_KINDS.map((k) => `<option value="${k.key}">${k.label}</option>`).join("")}</select></div>
    <div><label for="${prefix}From">From</label><input type="date" id="${prefix}From" /></div>
    <div><label for="${prefix}To">To</label><input type="date" id="${prefix}To" /></div>
    <button type="button" class="btn-secondary" id="${prefix}Zip" data-nobusy>Download .zip</button>
  </div>
  <p class="ef-count" id="${prefix}Count"></p>
  ${withList ? `<ul class="file-list ef-list" id="${prefix}List"></ul>` : ""}`;
}

// Wires a filter bar to a set of files. render(list) is called whenever the filters change.
function wireFileFilters(root, prefix, getItems, opts) {
  const $ = (id) => root.querySelector("#" + prefix + id);
  const current = () => filterFiles(getItems(), { kind: $("Kind").value, from: $("From").value, to: $("To").value });
  const update = () => {
    const list = current();
    $("Count").textContent = `${list.length} file${list.length === 1 ? "" : "s"}${$("From").value || $("To").value ? " in this date range" : ""}`;
    $("Zip").disabled = !list.length;
    if (opts.render) opts.render(list);
  };
  ["Kind", "From", "To"].forEach((id) => $(id).addEventListener("change", update));
  $("Zip").addEventListener("click", async () => {
    const list = current(), btn = $("Zip");
    btn.disabled = true;
    try {
      await downloadFilesZip(list, opts.zipName({ from: $("From").value, to: $("To").value }), opts.byPerson,
        (n, total) => { btn.textContent = `Preparing ${n}/${total}…`; });
    } catch (e) { window.alert("Couldn't make the .zip: " + ((e && e.message) || e)); }
    btn.textContent = "Download .zip"; btn.disabled = false;
  });
  update();
  return update;
}

// One person's files, inside their overview.
function renderFileRows(listEl, items) {
  listEl.innerHTML = items.length ? "" : `<li class="ef-none">No files match.</li>`;
  items.forEach((it) => {
    const li = document.createElement("li");
    const st = it.status === "approved" || it.status === "countersigned" || it.status === "issued" ? "approved" : it.status === "rejected" ? "rejected" : "pending";
    li.innerHTML = `<span class="info"><span class="name">${escHtml(it.title)}</span><span class="email"><span class="ef-kind">${fileKindLabel(it.kind)}</span> · ${escHtml(it.date || "no date")}</span></span>
      <span class="actions"><button type="button" class="preview-link" data-ef="view">Preview</button><button type="button" class="preview-link" data-ef="get">Download</button><span class="status-badge status-${st}">${escHtml(it.status)}</span></span>`;
    li.querySelector('[data-ef="view"]').addEventListener("click", async () => {
      try { openPreview(URL.createObjectURL(await fileBlob(it)), fileNameOf(it)); } catch (e) { window.alert("Couldn't open it: " + (e.message || e)); }
    });
    li.querySelector('[data-ef="get"]').addEventListener("click", async () => {
      try { saveBlob(await fileBlob(it), fileNameOf(it)); } catch (e) { window.alert("Couldn't download it: " + (e.message || e)); }
    });
    listEl.appendChild(li);
  });
}

// Employees panel: everyone's files in a date range.
let allFilesCache = null;
async function setupAllFilesBar() {
  const box = document.getElementById("employeesFiles");
  if (!box) return;
  box.innerHTML = fileFilterBar("efAll", false);
  allFilesCache = [];
  const update = wireFileFilters(box, "efAll", () => allFilesCache, {
    byPerson: true,
    zipName: ({ from, to }) => safeName(`${(currentCompany && currentCompany.name) || "Crew"} files${from || to ? ` ${from || "start"} to ${to || "today"}` : ""}`) + ".zip",
  });
  allFilesCache = await gatherFiles(null);
  update();
}
