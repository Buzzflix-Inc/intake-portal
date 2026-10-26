// ---- Admin: countersign pending deals ----
async function loadPendingCountersignatures() {
  const listEl = document.getElementById("countersignList");
  const emptyEl = document.getElementById("countersignEmpty");
  listEl.innerHTML = "";

  const { data: rows } = await client
    .from("esign_records")
    .select("id, user_id, type, employee_signature, employee_signed_at, template_id")
    .eq("status", "awaiting_countersignature")
    .order("employee_signed_at", { ascending: true });

  if (!rows || rows.length === 0) { emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");

  for (const row of rows) {
    const template = allTemplates.find((t) => t.id === row.template_id);
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.className = "info";
    const kind = template ? template.name : (row.type === "deal_memo" ? "Deal memo" : "Safety acknowledgment");
    left.innerHTML = `<span class="name">${profileMap.get(row.user_id) || row.user_id}</span><span class="email">${kind} · signed <span class="signature-rendered" style="font-size:15px;">${row.employee_signature}</span> on ${new Date(row.employee_signed_at).toLocaleDateString()}</span>`;
    const right = document.createElement("span");
    right.className = "actions";
    if (template && template.source_pdf_path) {
      const view = document.createElement("button");
      view.className = "remove-link"; view.style.marginRight = "8px"; view.textContent = "View form";
      view.addEventListener("click", () => viewDealPdf(row.id));
      right.appendChild(view);
    }
    const btn = document.createElement("button");
    btn.className = "btn-secondary";
    btn.textContent = "Countersign";
    btn.addEventListener("click", () => countersignDeal(row.id));
    right.appendChild(btn);
    const rej = document.createElement("button");
    rej.className = "btn-reject"; rej.style.marginLeft = "8px"; rej.textContent = "Reject";
    rej.addEventListener("click", () => rejectCountersign(row.id));
    right.appendChild(rej);
    li.appendChild(left); li.appendChild(right);
    listEl.appendChild(li);
  }
}

// Sends a signed memo back to the employee (signature cleared) with the reason shown to them.
async function rejectCountersign(recordId) {
  const reason = window.prompt("Why is this being sent back? The employee will see this and be asked to sign again:");
  if (reason === null) return;
  if (!reason.trim()) { window.alert("Please give a short reason so the employee knows what to fix."); return; }
  const { error } = await client.rpc("admin_reject_countersign", { p_id: recordId, p_reason: reason.trim() });
  if (error) {
    window.alert(/admin_reject_countersign|function/i.test(error.message)
      ? "Rejecting isn't set up yet. Run add-reject-countersign.sql in Supabase, then try again."
      : "Couldn't reject: " + error.message);
    return;
  }
  loadPendingCountersignatures();
}

async function countersignDeal(recordId) {
  const { data: { user } } = await client.auth.getUser();
  const adminName = window.prompt("Type your full name to countersign:");
  if (!adminName || !adminName.trim()) return;
  const update = {
    admin_signature: adminName.trim(),
    admin_signed_at: new Date().toISOString(),
    admin_id: user.id,
    status: "countersigned",
  };
  try {
    const { data: rec } = await client.from("esign_records").select("template_id, company_id").eq("id", recordId).single();
    const template = rec && allTemplates.find((t) => t.id === rec.template_id);
    if (template && template.source_pdf_path) {
      const { out } = await buildRecordPdf(recordId, adminName.trim());
      const finalPath = `${rec.company_id}/final/${recordId}.pdf`;
      const up = await client.storage.from(DEAL_BUCKET).upload(finalPath, new Blob([out], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
      if (up.error) throw up.error;
      update.final_pdf_path = finalPath;
    }
  } catch (err) {
    window.alert("Couldn't create the signed PDF, so nothing was countersigned: " + (err.message || err));
    return;
  }
  const { error } = await client.from("esign_records").update(update).eq("id", recordId);
  if (error) { window.alert("Couldn't countersign: " + error.message); return; }
  loadPendingCountersignatures();
}
