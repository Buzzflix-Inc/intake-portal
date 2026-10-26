// ---- Department head: review timesheets ----
let myHeadDepartments = [];

async function loadMyHeadDepartments() {
  const { data } = await client.from("department_heads").select("department").eq("head_user_id", currentUserId);
  myHeadDepartments = [...new Set((data || []).map((r) => r.department))].sort();
  tabDeptBtn.classList.toggle("hidden", myHeadDepartments.length === 0);

  const sel = document.getElementById("deptFilterDept");
  const prev = sel.value;
  sel.innerHTML = "";
  if (myHeadDepartments.length > 1) {
    const all = document.createElement("option");
    all.value = "all"; all.textContent = "All my departments";
    sel.appendChild(all);
  }
  myHeadDepartments.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    sel.appendChild(opt);
  });
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  sel.parentElement.classList.toggle("hidden", myHeadDepartments.length <= 1);
}

async function loadDeptTimesheets() {
  const listEl = document.getElementById("deptTimesheetsList");
  const emptyEl = document.getElementById("deptTimesheetsEmpty");
  const msgEl = document.getElementById("deptTimesheetsMsg");
  if (!myHeadDepartments.length) return;

  const deptVal = document.getElementById("deptFilterDept").value;
  const depts = deptVal && deptVal !== "all" ? [deptVal] : myHeadDepartments;
  const needsOnly = document.getElementById("deptFilterStatus").value === "needs";

  let q = client
    .from("timesheets")
    .select("*")
    .in("department", depts)
    .neq("user_id", currentUserId)
    .order("week_start", { ascending: false })
    .order("created_at", { ascending: false });
  if (needsOnly) q = q.eq("status", "pending").eq("dept_status", "pending");

  const { data: rows, error } = await q;
  listEl.innerHTML = "";
  if (error) { msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
  emptyEl.classList.toggle("hidden", !!(rows && rows.length));
  if (!rows || !rows.length) return;

  for (const row of rows) {
    const li = document.createElement("li");
    const who = row.employee_name || row.employee_email || row.user_id;
    const fileName = row.file_path.split("/").pop();

    const detailRows = (Array.isArray(row.entries) ? row.entries : []).map((en) =>
      `<tr><td>${escHtml(en.day)}</td><td>${escHtml(en.date)}</td><td>${fmtTime(en.call)}</td><td>${fmtTime(en.wrap)}</td><td>${en.break_minutes ? en.break_minutes + " min" : "-"}</td><td>${fmtHours(en.minutes)}${en.kit ? " (kit)" : ""}</td></tr>`
    ).join("");
    const kitBit = Number(row.kit_days) > 0 ? ` · kit ${row.kit_days} day${row.kit_days === 1 ? "" : "s"} ($${Number(row.kit_total || 0).toFixed(2)})` : "";

    const left = document.createElement("span");
    left.className = "info";
    left.innerHTML = `
      <span class="name">${escHtml(who)}</span>
      <span class="email">${invoiceOf(row) ? `Invoice ${escHtml(invoiceOf(row).number)} · ${money(invoiceOf(row).total)} · ${escHtml(invoiceOf(row).date)}` : `${row.week_start ? periodLabel(row.week_start) : escHtml(fileName)} · ${Number(row.total_hours || 0).toFixed(2)} hrs${kitBit}`} · ${escHtml(row.department)}</span>
      ${detailRows ? `<details class="dept-details"><summary>View daily hours</summary><div class="tbl-wrap"><table><thead><tr><th>Day</th><th>Date</th><th>Call</th><th>Wrap</th><th>Break</th><th>Hrs</th></tr></thead><tbody>${detailRows}</tbody></table></div></details>` : ""}`;

    const right = document.createElement("span");
    right.className = "actions";

    const previewBtn = document.createElement("button");
    previewBtn.className = "preview-link";
    previewBtn.textContent = "Preview";
    if (row.week_start && Array.isArray(row.entries)) {
      previewBtn.addEventListener("click", () => previewTimesheetRow(row));
    } else {
      const { data: signed } = await client.storage.from("timesheets").createSignedUrl(row.file_path, 60 * 5);
      previewBtn.addEventListener("click", () => openPreview(signed ? signed.signedUrl : "#", fileName));
    }
    right.appendChild(previewBtn);

    if (row.status === "pending" && row.dept_status === "pending") {
      const approve = document.createElement("button");
      approve.className = "btn-approve";
      approve.textContent = "Approve";
      approve.addEventListener("click", () => deptReview(row.id, "approved", [approve, reject]));
      const reject = document.createElement("button");
      reject.className = "btn-reject";
      reject.textContent = "Reject";
      reject.addEventListener("click", () => deptReview(row.id, "rejected", [approve, reject]));
      right.appendChild(approve);
      right.appendChild(reject);
    } else {
      const badge = document.createElement("span");
      badge.className = `status-badge status-${row.status === "pending" ? "pending" : row.status}`;
      badge.textContent = row.status === "pending" ? "sent to admin" : row.status;
      right.appendChild(badge);
    }

    li.appendChild(left);
    li.appendChild(right);
    listEl.appendChild(li);
  }
}

async function deptReview(id, decision, buttons) {
  const msgEl = document.getElementById("deptTimesheetsMsg");
  if (decision === "rejected" && !window.confirm("Reject this timesheet? The employee will need to resubmit it.")) return;
  buttons.forEach((b) => { b.disabled = true; });
  const { error } = await client.rpc("dept_review_timesheet", { p_id: id, p_decision: decision });
  msgEl.innerHTML = error
    ? `<div class="msg error">${escHtml(error.message)}</div>`
    : `<div class="msg ok">Timesheet ${decision === "approved" ? "approved and sent to admin" : "rejected"}.</div>`;
  loadDeptTimesheets();
}
document.getElementById("deptFilterDept").addEventListener("change", loadDeptTimesheets);
document.getElementById("deptFilterStatus").addEventListener("change", loadDeptTimesheets);
