// ---- Admin: review lists for documents/timesheets ----
async function loadAdminList(bucket, table) {
  if (bucket === "documents") return loadAdminDocuments();
  const listEl = document.getElementById(`admin${capitalize(bucket)}List`);
  const emptyEl = document.getElementById(`admin${capitalize(bucket)}Empty`);
  listEl.innerHTML = "";

  const cols = bucket === "documents"
    ? "id, user_id, status, file_path, created_at, approval_step"
    : bucket === "timesheets"
      ? "*"
      : "id, user_id, status, file_path, created_at";

  const { data: rows, error } = await client
    .from(table)
    .select(cols)
    .order("created_at", { ascending: false });

  if (error || !rows || rows.length === 0) {
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");

  for (const row of rows) {
    const li = document.createElement("li");
    const name = row.file_path.split("/").pop();
    const email = profileMap.get(row.user_id) || row.user_id;

    const chainStep = (bucket === "documents" && row.status === "pending" && approvalChainSteps.length)
      ? approvalChainSteps[(row.approval_step || 1) - 1]
      : null;
    const chainBit = chainStep
      ? `<span class="chain-badge">Step ${row.approval_step || 1}/${approvalChainSteps.length}: ${chainStep.label || chainStep.approver_email}</span>`
      : "";

    // Timesheets go to the department head first, then admin.
    const deptHeads = bucket === "timesheets" && row.week_start
      ? deptHeadRows.filter((h) => h.department === row.department)
      : [];
    let deptBit = "";
    if (bucket === "timesheets" && (row.week_start || invoiceOf(row))) {
      const deptLabel = escHtml(row.department || "No department");
      deptBit = deptHeads.length
        ? `<span class="status-badge status-${row.dept_status}">${deptLabel} head: ${row.dept_status}</span>`
        : `<span class="chain-badge">${deptLabel}: no head assigned</span>`;
    }
    const invR = bucket === "timesheets" ? invoiceOf(row) : null;
    const title = invR ? `Invoice ${escHtml(invR.number)}` : bucket === "timesheets" && row.week_start ? `Week of ${periodLabel(row.week_start)}` : name;
    const hoursBit = invR ? ` · ${money(invR.total)} · ${escHtml(invR.date)}` : bucket === "timesheets" && row.total_hours != null
      ? ` · ${Number(row.total_hours).toFixed(2)} hrs${Number(row.kit_days) > 0 ? ` · kit $${Number(row.kit_total || 0).toFixed(2)} (${row.kit_days} day${row.kit_days === 1 ? "" : "s"})` : ""}`
      : "";

    const left = document.createElement("span");
    left.className = "info";
    left.innerHTML = `<span class="name">${title}</span><span class="email">${email}${hoursBit}</span>${chainBit ? `<span style="margin-top:4px;">${chainBit}</span>` : ""}${deptBit ? `<span style="margin-top:4px;">${deptBit}</span>` : ""}`;

    const right = document.createElement("span");
    right.className = "actions";

    const select = document.createElement("select");
    ["pending", "approved", "rejected"].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      if (s === row.status) opt.selected = true;
      if (bucket === "documents" && s === "approved" && chainStep && chainStep.approver_email !== currentUserEmail) {
        opt.disabled = true;
        opt.textContent = `approved (waiting on ${chainStep.label || chainStep.approver_email})`;
      }
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      if (bucket === "documents") { advanceDocumentApproval(row, select.value); return; }
      if (bucket === "timesheets" && select.value === "approved" && deptHeads.length && row.dept_status !== "approved") {
        if (!window.confirm("The department head hasn't approved this timesheet yet. Approve it anyway?")) {
          select.value = row.status;
          return;
        }
      }
      updateStatus(table, row.id, select.value, bucket);
    });

    const dataPdf = bucket === "timesheets" && row.week_start && Array.isArray(row.entries);
    let signed = null;
    if (!dataPdf) ({ data: signed } = await client.storage.from(bucket).createSignedUrl(row.file_path, 60 * 5));

    const previewBtn = document.createElement("button");
    previewBtn.className = "preview-link";
    previewBtn.textContent = "Preview";
    previewBtn.addEventListener("click", () =>
      dataPdf ? previewTimesheetRow(row) : openPreview(signed ? signed.signedUrl : "#", name)
    );

    const a = document.createElement("a");
    a.textContent = "Download";
    if (dataPdf) {
      a.href = "#";
      a.addEventListener("click", (e) => { e.preventDefault(); downloadTimesheetRow(row); });
    } else {
      a.href = signed ? signed.signedUrl : "#";
      a.target = "_blank";
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "remove-link";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteAdminRecord(bucket, table, row.id, row.file_path));

    right.appendChild(select);
    right.appendChild(previewBtn);
    right.appendChild(a);
    right.appendChild(deleteBtn);
    li.appendChild(left);
    li.appendChild(right);
    listEl.appendChild(li);
  }
}

async function deleteAdminRecord(bucket, table, id, filePath) {
  const msgEl = document.getElementById(`admin${capitalize(bucket)}Msg`);
  await client.storage.from(bucket).remove([filePath]);
  const { error } = await client.from(table).delete().eq("id", id);
  if (error) {
    msgEl.innerHTML = `<div class="msg error">Couldn't delete: ${escHtml(error.message)}</div>`;
    return;
  }
  loadAdminList(bucket, table);
}

async function updateStatus(table, id, newStatus, bucket) {
  const msgEl = document.getElementById(`admin${capitalize(bucket)}Msg`);
  const { error } = await client.from(table).update({ status: newStatus }).eq("id", id);
  if (error) {
    msgEl.innerHTML = `<div class="msg error">Update failed: ${error.message}</div>`;
  } else {
    msgEl.innerHTML = `<div class="msg ok">Status updated.</div>`;
  }
}
