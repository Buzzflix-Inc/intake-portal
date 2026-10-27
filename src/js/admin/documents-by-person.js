// ---- Admin: documents grouped by person ----
// A searchable list of people (filter by department, sort) on the left; picking someone opens
// their own tab of documents on the right, with the same approve/reject, preview and delete
// as before. loadAdminList("documents", …) in review-lists.js hands over to loadAdminDocuments().

let dpPeople = [], dpSelected = null;
const DP_STATUS_ORDER = { pending: 0, rejected: 1, approved: 2 };

// Initials on a colour picked from the person's id, so everyone keeps the same icon.
function avatarHtml(name, seed, size) {
  const words = String(name || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const initials = ((words[0] || "?")[0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  let h = 0;
  for (const ch of String(seed || name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="avatar${size === "lg" ? " avatar-lg" : ""}" style="--av-h:${h}" aria-hidden="true">${escHtml(initials)}</span>`;
}

async function loadAdminDocuments() {
  const emptyEl = document.getElementById("adminDocumentsEmpty");
  const [{ data: docs, error }, { data: invites }] = await Promise.all([
    client.from("documents").select("id, user_id, status, file_path, created_at, approval_step, doc_type").order("created_at", { ascending: false }),
    client.from("company_invites").select("email, full_name, department, crew_role, requested_documents").eq("company_id", currentCompany.id),
  ]);
  if (error) { document.getElementById("adminDocumentsMsg").innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }

  const inviteByEmail = new Map((invites || []).map((i) => [String(i.email).toLowerCase(), i]));
  const byUser = new Map();
  (docs || []).forEach((d) => { (byUser.get(d.user_id) || byUser.set(d.user_id, []).get(d.user_id)).push(d); });
  const ids = new Set([...profileMap.keys(), ...byUser.keys()]);

  dpPeople = [...ids].map((uid) => {
    const email = profileMap.get(uid) || "";
    const inv = inviteByEmail.get(email.toLowerCase()) || {};
    const list = byUser.get(uid) || [];
    const requested = realDocs(inv.requested_documents);
    const have = new Set(list.filter((d) => d.status !== "rejected" && d.doc_type).map((d) => d.doc_type));
    return {
      uid, email, name: inv.full_name || email || "Former crew member",
      department: inv.department || "", role: inv.crew_role || "",
      docs: list, missing: requested.filter((r) => !have.has(r)),
      pending: list.filter((d) => d.status === "pending").length,
      rejected: list.filter((d) => d.status === "rejected").length,
    };
  }).filter((p) => p.docs.length || p.missing.length);

  emptyEl.classList.toggle("hidden", dpPeople.length > 0);
  document.getElementById("dpLayout").classList.toggle("hidden", !dpPeople.length);

  // Department filter: keep the choice if that department still exists.
  const deptSel = document.getElementById("dpDept"), keep = deptSel.value;
  const depts = [...new Set(dpPeople.map((p) => p.department).filter(Boolean))].sort();
  deptSel.innerHTML = `<option value="">All departments</option>${depts.map((d) => `<option>${escHtml(d)}</option>`).join("")}${dpPeople.some((p) => !p.department) ? `<option value="__none">No department</option>` : ""}`;
  deptSel.value = depts.includes(keep) || keep === "__none" ? keep : "";

  if (!dpPeople.some((p) => p.uid === dpSelected)) dpSelected = null;
  // Side by side, open the first person instead of an empty pane.
  if (!dpSelected && window.matchMedia("(min-width: 860px)").matches) dpSelected = (dpVisiblePeople()[0] || {}).uid || null;
  renderDpPeople();
  renderDpDocs();
}

function dpVisiblePeople() {
  const q = document.getElementById("dpSearch").value.trim().toLowerCase();
  const dept = document.getElementById("dpDept").value;
  const sort = document.getElementById("dpSort").value;
  const list = dpPeople.filter((p) =>
    (!q || [p.name, p.email, p.role, p.department].some((v) => String(v).toLowerCase().includes(q)))
    && (!dept || (dept === "__none" ? !p.department : p.department === dept)));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const byDept = (a, b) => (a.department || "~").localeCompare(b.department || "~");
  return list.sort(sort === "name" ? byName
    : sort === "department" ? (a, b) => byDept(a, b) || byName(a, b)
    : (a, b) => (b.pending - a.pending) || (b.missing.length - a.missing.length) || byName(a, b));
}

function renderDpPeople() {
  const listEl = document.getElementById("dpPeopleList");
  const people = dpVisiblePeople();
  const grouped = document.getElementById("dpSort").value === "department";
  let lastDept = null;
  listEl.innerHTML = people.map((p) => {
    const head = grouped && p.department !== lastDept ? `<li class="dp-group" role="presentation">${escHtml(p.department || "No department")}</li>` : "";
    lastDept = p.department;
    const badge = p.pending ? `<span class="dp-count" title="${p.pending} to review">${p.pending}</span>`
      : p.missing.length ? `<span class="dp-count dp-count-missing" title="${p.missing.length} still to upload">${p.missing.length}</span>` : "";
    return `${head}<li role="presentation"><button type="button" class="dp-person${p.uid === dpSelected ? " active" : ""}" role="tab" aria-selected="${p.uid === dpSelected}" data-uid="${escHtml(p.uid)}">
      ${avatarHtml(p.name, p.uid)}
      <span class="dp-person-text"><span class="dp-person-name">${escHtml(p.name)}</span><span class="dp-person-sub">${escHtml([p.role, p.department].filter(Boolean).join(" · ") || p.email)}</span></span>
      ${badge}</button></li>`;
  }).join("") || `<li class="empty" role="presentation">No one matches.</li>`;
}

async function renderDpDocs() {
  const box = document.getElementById("dpDocs");
  const p = dpPeople.find((x) => x.uid === dpSelected);
  if (!p) {
    const waiting = dpPeople.reduce((t, x) => t + x.pending, 0);
    box.innerHTML = `<p class="empty">${waiting ? `${waiting} document${waiting === 1 ? "" : "s"} waiting for review. ` : ""}Pick someone to see their documents.</p>`;
    return;
  }
  const docs = [...p.docs].sort((a, b) => (DP_STATUS_ORDER[a.status] - DP_STATUS_ORDER[b.status]) || String(b.created_at).localeCompare(String(a.created_at)));
  const { data: signed } = docs.length
    ? await client.storage.from("documents").createSignedUrls(docs.map((d) => d.file_path), 60 * 5)
    : { data: [] };
  if (dpSelected !== p.uid) return;  // picked someone else meanwhile
  const urlOf = new Map((signed || []).map((s) => [s.path, s.signedUrl]));

  const chips = [p.pending ? `${p.pending} to review` : "", p.rejected ? `${p.rejected} rejected` : "", `${p.docs.length} uploaded`].filter(Boolean);
  box.innerHTML = `
    <div class="dp-head">
      ${avatarHtml(p.name, p.uid, "lg")}
      <div><h3>${escHtml(p.name)}</h3><p class="dp-head-sub">${escHtml([p.role, p.department, p.email].filter(Boolean).join(" · "))}</p>
      <div class="summary-row">${chips.map((c) => `<span class="summary-chip">${escHtml(c)}</span>`).join("")}</div></div>
    </div>
    ${p.missing.length ? `<div class="dp-missing"><strong>Still to upload:</strong> ${p.missing.map(escHtml).join(", ")}</div>` : ""}
    ${docs.length ? `<ul class="file-list" id="dpDocList"></ul>` : `<p class="empty" style="text-align:left;">Nothing uploaded yet.</p>`}`;

  const listEl = box.querySelector("#dpDocList");
  docs.forEach((row) => listEl && listEl.appendChild(dpDocRow(row, urlOf.get(row.file_path))));
}

function dpDocRow(row, url) {
  const li = document.createElement("li");
  const fileName = row.file_path.split("/").pop();
  const shownName = fileName.replace(/^\d{10,}-/, "");  // uploads start with a timestamp
  const chainStep = row.status === "pending" && approvalChainSteps.length ? approvalChainSteps[(row.approval_step || 1) - 1] : null;
  const chainBit = chainStep ? `<span class="chain-badge">Step ${row.approval_step || 1}/${approvalChainSteps.length}: ${escHtml(chainStep.label || chainStep.approver_email)}</span>` : "";
  const left = document.createElement("span");
  left.className = "info";
  left.innerHTML = `<span class="name">${escHtml(row.doc_type || shownName)}</span><span class="email">${row.doc_type ? `${escHtml(shownName)} · ` : ""}uploaded ${new Date(row.created_at).toLocaleDateString()}</span>${chainBit ? `<span style="margin-top:4px;">${chainBit}</span>` : ""}`;

  const right = document.createElement("span");
  right.className = "actions";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Status");
  ["pending", "approved", "rejected"].forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    if (s === row.status) opt.selected = true;
    if (s === "approved" && chainStep && chainStep.approver_email !== currentUserEmail) {
      opt.disabled = true;
      opt.textContent = `approved (waiting on ${chainStep.label || chainStep.approver_email})`;
    }
    select.appendChild(opt);
  });
  select.addEventListener("change", () => advanceDocumentApproval(row, select.value));

  const previewBtn = document.createElement("button");
  previewBtn.className = "preview-link";
  previewBtn.textContent = "Preview";
  previewBtn.addEventListener("click", () => openPreview(url || "#", shownName));
  const a = document.createElement("a");
  a.textContent = "Download";
  a.href = url || "#";
  a.target = "_blank";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "remove-link";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => {
    if (window.confirm(`Delete ${row.doc_type || fileName}? This can't be undone.`)) deleteAdminRecord("documents", "documents", row.id, row.file_path);
  });

  right.append(select, previewBtn, a, deleteBtn);
  li.append(left, right);
  return li;
}

document.getElementById("dpPeopleList").addEventListener("click", (e) => {
  const btn = e.target.closest(".dp-person");
  if (!btn) return;
  dpSelected = btn.dataset.uid;
  renderDpPeople();
  renderDpDocs();
  // On narrow screens the documents are below the list.
  if (window.matchMedia("(max-width: 859px)").matches) document.getElementById("dpDocs").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("dpPeopleList").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const btns = [...document.querySelectorAll("#dpPeopleList .dp-person")];
  const i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
  next.focus();
});
["dpSearch", "dpDept", "dpSort"].forEach((id) => document.getElementById(id).addEventListener(id === "dpSearch" ? "input" : "change", renderDpPeople));
