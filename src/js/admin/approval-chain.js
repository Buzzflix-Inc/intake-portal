// ---- Admin: approval chain ----
async function loadApprovalChain() {
  const { data } = await client
    .from("approval_chain")
    .select("*")
    .order("step_order", { ascending: true });
  approvalChainSteps = data || [];
  renderApprovalChain();
}

function renderApprovalChain() {
  const listEl = document.getElementById("chainList");
  const emptyEl = document.getElementById("chainEmpty");
  listEl.innerHTML = "";
  if (!approvalChainSteps.length) { emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");
  approvalChainSteps.forEach((step, idx) => {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.className = "info";
    left.innerHTML = `<span class="name">${idx + 1}. ${step.label || step.approver_email}</span><span class="email">${step.approver_email}</span>`;
    const right = document.createElement("span");
    right.className = "actions";
    if (idx > 0) {
      const up = document.createElement("button");
      up.className = "preview-link"; up.textContent = "↑ Move up";
      up.addEventListener("click", () => moveChainStep(idx, -1));
      right.appendChild(up);
    }
    if (idx < approvalChainSteps.length - 1) {
      const down = document.createElement("button");
      down.className = "preview-link"; down.textContent = "↓ Move down";
      down.addEventListener("click", () => moveChainStep(idx, 1));
      right.appendChild(down);
    }
    const del = document.createElement("button");
    del.className = "remove-link"; del.textContent = "Remove";
    del.addEventListener("click", () => removeChainStep(step.id));
    right.appendChild(del);
    li.appendChild(left); li.appendChild(right);
    listEl.appendChild(li);
  });
}

document.getElementById("addChainStepBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("chainMsg");
  const email = document.getElementById("chainApproverEmail").value.trim();
  const label = document.getElementById("chainApproverLabel").value.trim();
  if (!email) {
    msgEl.innerHTML = `<div class="msg error">Enter an approver email.</div>`;
    return;
  }
  const nextOrder = approvalChainSteps.length
    ? Math.max(...approvalChainSteps.map((s) => s.step_order)) + 1
    : 1;
  const { error } = await client.from("approval_chain").insert({
    company_id: currentCompany.id, step_order: nextOrder, approver_email: email, label,
  });
  if (error) {
    msgEl.innerHTML = `<div class="msg error">${error.message}</div>`;
    return;
  }
  document.getElementById("chainApproverEmail").value = "";
  document.getElementById("chainApproverLabel").value = "";
  msgEl.innerHTML = "";
  loadApprovalChain();
});

async function removeChainStep(id) {
  await client.from("approval_chain").delete().eq("id", id);
  loadApprovalChain();
}

async function moveChainStep(idx, dir) {
  const a = approvalChainSteps[idx];
  const b = approvalChainSteps[idx + dir];
  if (!a || !b) return;
  await Promise.all([
    client.from("approval_chain").update({ step_order: b.step_order }).eq("id", a.id),
    client.from("approval_chain").update({ step_order: a.step_order }).eq("id", b.id),
  ]);
  loadApprovalChain();
}

// Routes a document approval through the chain instead of approving it
// outright. Only used for the "documents" bucket — timesheets keep the
// simple pending/approved/rejected toggle.
async function advanceDocumentApproval(row, newStatus) {
  const msgEl = document.getElementById("adminDocumentsMsg");
  const { data: { user } } = await client.auth.getUser();

  if (newStatus === "pending") {
    await client.from("documents").update({ status: "pending" }).eq("id", row.id);
    loadAdminList("documents", "documents");
    return;
  }

  if (newStatus === "rejected") {
    await client.from("documents").update({ status: "rejected" }).eq("id", row.id);
    await client.from("document_approvals").insert({
      document_id: row.id, step_order: row.approval_step || 1, approver_id: user.id, decision: "rejected",
    });
    msgEl.innerHTML = `<div class="msg ok">Rejected.</div>`;
    loadAdminList("documents", "documents");
    return;
  }

  // newStatus === "approved"
  if (!approvalChainSteps.length) {
    await client.from("documents").update({ status: "approved" }).eq("id", row.id);
    await client.from("document_approvals").insert({
      document_id: row.id, step_order: 1, approver_id: user.id, decision: "approved",
    });
    msgEl.innerHTML = `<div class="msg ok">Approved.</div>`;
    loadAdminList("documents", "documents");
    return;
  }

  const currentStep = row.approval_step || 1;
  await client.from("document_approvals").insert({
    document_id: row.id, step_order: currentStep, approver_id: user.id, decision: "approved",
  });

  if (currentStep < approvalChainSteps.length) {
    await client.from("documents").update({ approval_step: currentStep + 1 }).eq("id", row.id);
    msgEl.innerHTML = `<div class="msg ok">Approved at step ${currentStep} of ${approvalChainSteps.length} — sent to the next approver.</div>`;
  } else {
    await client.from("documents").update({ status: "approved" }).eq("id", row.id);
    msgEl.innerHTML = `<div class="msg ok">Fully approved.</div>`;
  }
  loadAdminList("documents", "documents");
}
