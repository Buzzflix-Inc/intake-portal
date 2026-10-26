// ---- Employee upload handling ----
document.querySelectorAll("[data-bucket]").forEach((btn) => {
  btn.addEventListener("click", () => handleUpload(btn.dataset.bucket, btn.dataset.table));
});

async function handleUpload(bucket, table) {
  const fileInput = document.getElementById(`${bucket}File`);
  const msgEl = document.getElementById(`${bucket}Msg`);
  const file = fileInput.files[0];
  const kind = bucket === "timesheets" ? "timesheet" : "document";

  if (!file) {
    msgEl.innerHTML = `<div class="msg error">Choose a file first.</div>`;
    return;
  }
  if (file.size < MIN_UPLOAD_BYTES) {
    msgEl.innerHTML = `<div class="msg error">That file is empty or too small to be a real ${kind} — please check it and try again.</div>`;
    return;
  }

  msgEl.innerHTML = `<div class="msg">Checking file…</div>`;
  const likelyBlank = await checkLikelyBlank(file);
  if (likelyBlank) {
    msgEl.innerHTML = `<div class="msg error">This looks like a blank page. Please upload a completed ${kind} — if this is a mistake, try a clearer photo or scan.</div>`;
    fileInput.value = "";
    return;
  }

  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  const path = `${user.id}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await client.storage.from(bucket).upload(path, file);
  if (uploadError) {
    msgEl.innerHTML = `<div class="msg error">Upload failed: ${uploadError.message}</div>`;
    return;
  }

  const insertPayload = { user_id: user.id, status: "pending", file_path: path };
  if (bucket === "documents") {
    const typeSelect = document.getElementById("documentsTypeSelect");
    if (typeSelect && typeSelect.value) insertPayload.doc_type = typeSelect.value;
  }

  const { error: insertError } = await client
    .from(table)
    .insert(insertPayload);

  if (insertError) {
    msgEl.innerHTML = `<div class="msg error">File uploaded but record failed: ${insertError.message}</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Uploaded ${file.name}.</div>`;
  fileInput.value = "";
  loadList(bucket, table, bucket !== "paystubs");
}

// ---- Employee listing (own records only) ----
const CONTRACTOR_TAG = "__contractor__";
const realDocs = (arr) => (arr || []).filter((d) => d !== CONTRACTOR_TAG);
const isContractorInv = (inv) => !!(inv && (inv.requested_documents || []).includes(CONTRACTOR_TAG));
const invoiceOf = (row) => (row && row.entries && !Array.isArray(row.entries) && row.entries.invoice) || null;
const money = (n) => "$" + Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let myIsContractor = false;
let myRequestedDocs = [];
let myFullName = null;
let myDepartment = null;
let myKitEnabled = false;
let myKitRate = 0;
let myCrewRole = "";
let myInvite = null, myEmail = "", myProfile = {};
let myTsTemplate = null;   // the union form this person's timesheets are filled onto, if any

async function loadMyRequestedDocuments() {
  const { data: { user } } = await client.auth.getUser();
  if (!user || !user.email) { myRequestedDocs = []; return; }
  const { data } = await client
    .from("company_invites")
    .select("*")
    .eq("email", user.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  myInvite = data || null; myEmail = user.email;
  myRequestedDocs = realDocs(data && data.requested_documents);
  myIsContractor = isContractorInv(data);
  applyWorkerType();
  myFullName = (data && data.full_name) || null;
  { const w = document.getElementById("whoAmI"); const md = user.user_metadata || {}; const nm = myFullName || md.full_name || md.name || user.email; if (w) { w.textContent = nm; w.title = user.email; } }
  myDepartment = (data && data.department) || null;
  myKitEnabled = !!(data && data.kit_fee_enabled);
  myKitRate = myKitEnabled ? Number(data.kit_fee_rate || 0) : 0;
  myCrewRole = (data && data.crew_role) || "";
  myTsTemplate = null;
  if (data && data.timesheet_template_id) {
    const t = await getTsTemplateWithBytes(data.timesheet_template_id);
    myTsTemplate = t ? t.template : null;
  }
  renderTsExtras();
  tsGridWeek = null;   // redraw the grid with or without the kit column
  buildPeriodOptions();
}

function renderDocumentsChecklist(rows) {
  const ul = document.getElementById("documentsChecklist");
  if (!ul) return;
  if (!myRequestedDocs.length) { ul.classList.add("hidden"); ul.innerHTML = ""; return; }
  const submittedTypes = new Set(
    (rows || []).filter((r) => r.status !== "rejected" && r.doc_type).map((r) => r.doc_type)
  );
  ul.innerHTML = myRequestedDocs.map((item) => {
    const got = submittedTypes.has(item);
    return `<li class="${got ? "got" : "missing"}"><span class="mark">${got ? "✓" : "!"}</span><span class="label">${item}</span></li>`;
  }).join("");
  ul.classList.remove("hidden");
}

function populateDocumentsTypeSelect(rows) {
  const select = document.getElementById("documentsTypeSelect");
  if (!select) return;
  const submittedTypes = new Set(
    (rows || []).filter((r) => r.status !== "rejected" && r.doc_type).map((r) => r.doc_type)
  );
  const outstanding = myRequestedDocs.filter((d) => !submittedTypes.has(d));
  select.innerHTML = "";
  outstanding.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item; opt.textContent = item;
    select.appendChild(opt);
  });
  const otherOpt = document.createElement("option");
  otherOpt.value = "Other document";
  otherOpt.textContent = outstanding.length ? "Other document" : "General document";
  select.appendChild(otherOpt);
}

async function loadList(bucket, table, showDownload) {
  const listEl = document.getElementById(bucket === "timesheets" && myIsContractor ? "invoicesList" : `${bucket}List`);
  const emptyEl = document.getElementById(`${bucket}Empty`);
  listEl.innerHTML = "";

  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  const cols = bucket === "documents"
    ? "id, status, file_path, created_at, doc_type"
    : bucket === "timesheets"
      ? "*"
      : "id, status, file_path, created_at";

  let query = client.from(table).select(cols).order("created_at", { ascending: false });
  // Department heads and admins can read other people's timesheets too;
  // this list is only ever the signed-in person's own.
  if (bucket === "timesheets") query = query.eq("user_id", user.id);
  const { data: rows, error } = await query;

  if (bucket === "documents") {
    populateDocumentsTypeSelect(rows || []);
    renderDocumentsChecklist(rows || []);
  }
  if (bucket === "timesheets") {
    myTimesheetRows = rows || [];
    buildPeriodOptions();
  }

  if (error || !rows || rows.length === 0) {
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");

  for (const row of rows) {
    const li = document.createElement("li");
    const name = row.file_path.split("/").pop();

    const left = document.createElement("span");
    left.className = "info";
    const invo = invoiceOf(row);
    left.innerHTML = invo
      ? `<span class="name">Invoice ${escHtml(invo.number)}</span><span class="email">${money(invo.total)} · ${escHtml(invo.date)}</span>`
      : row.doc_type
      ? `<span class="name">${row.doc_type}</span><span class="email">${name}</span>`
      : row.week_start
        ? `<span class="name">Week of ${periodLabel(row.week_start)}</span><span class="email">${Number(row.total_hours || 0).toFixed(2)} hrs${Number(row.kit_days) > 0 ? ` · kit $${Number(row.kit_total || 0).toFixed(2)}` : ""} · ${name}</span>`
        : `<span class="name">${name}</span>`;

    const right = document.createElement("span");
    right.className = "actions";

    if (showDownload) {
      if (bucket === "timesheets" && row.status === "pending" && row.dept_status === "approved") {
        const chip = document.createElement("span");
        chip.className = "chain-badge";
        chip.textContent = "Dept head approved";
        right.appendChild(chip);
      }
      const status = document.createElement("span");
      status.className = `status-badge status-${row.status}`;
      status.textContent = row.status;
      right.appendChild(status);

      const canRemove = bucket === "timesheets" ? row.status !== "approved" : row.status === "rejected";
      if (canRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "remove-link";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
          if (bucket === "timesheets" && row.status === "pending" &&
              !window.confirm(invoiceOf(row) ? "Remove this invoice? Your supervisor will no longer see it." : "Remove this timesheet? Your supervisor will no longer see it, and you can submit the week again.")) return;
          deleteSubmission(bucket, table, row.id, row.file_path);
        });
        right.appendChild(removeBtn);
      }
    } else {
      const { data: signed } = await client.storage.from(bucket).createSignedUrl(row.file_path, 60 * 5);
      const a = document.createElement("a");
      a.href = signed ? signed.signedUrl : "#";
      a.textContent = "Download";
      a.target = "_blank";
      right.appendChild(a);
    }

    li.appendChild(left);
    li.appendChild(right);
    listEl.appendChild(li);
  }
}

async function deleteSubmission(bucket, table, id, filePath) {
  const msgEl = document.getElementById(`${bucket}Msg`);
  await client.storage.from(bucket).remove([filePath]);
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) {
    msgEl.innerHTML = `<div class="msg error">Couldn't remove: ${error.message}</div>`;
    return;
  }
  loadList(bucket, table, true);
}
