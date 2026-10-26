// ---- Admin: deal memo / safety templates ----
function addDealPointRow(label, value) {
  const container = document.getElementById("dealPointRows");
  const row = document.createElement("div");
  row.className = "deal-point-row";
  const labelInput = document.createElement("input");
  labelInput.type = "text"; labelInput.className = "dp-label";
  labelInput.placeholder = "Label (e.g. Rate)"; labelInput.value = label || "";
  const valueInput = document.createElement("input");
  valueInput.type = "text"; valueInput.className = "dp-value";
  valueInput.placeholder = "Value (e.g. $500/day)"; valueInput.value = value || "";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button"; removeBtn.className = "remove-link";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => row.remove());
  row.appendChild(labelInput); row.appendChild(valueInput); row.appendChild(removeBtn);
  container.appendChild(row);
}
document.getElementById("addDealPointBtn").addEventListener("click", () => addDealPointRow());
addDealPointRow();

document.getElementById("saveTemplateBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("templateMsg");
  const type = document.getElementById("templateTypeSelect").value;
  const name = document.getElementById("templateNameInput").value.trim();
  const terms_text = document.getElementById("templateTermsInput").value.trim();
  const deal_points = Array.from(document.querySelectorAll("#dealPointRows .deal-point-row"))
    .map((row) => ({
      label: row.querySelector(".dp-label").value.trim(),
      value: row.querySelector(".dp-value").value.trim(),
    }))
    .filter((dp) => dp.label);

  if (!name) {
    msgEl.innerHTML = `<div class="msg error">Give this template a name.</div>`;
    return;
  }
  if (tplPdf.bytes) { await savePdfTemplate(type, name, msgEl); return; }

  const { error } = await client.from("esign_templates").insert({
    company_id: currentCompany.id, type, name, deal_points, terms_text,
  });
  if (error) {
    msgEl.innerHTML = `<div class="msg error">${error.message}</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Template saved.</div>`;
  document.getElementById("templateNameInput").value = "";
  document.getElementById("templateTermsInput").value = "";
  document.getElementById("dealPointRows").innerHTML = "";
  addDealPointRow();
  loadTemplates();
});

async function loadTemplates() {
  loadTsTemplates();
  const { data } = await client.from("esign_templates").select("*").order("created_at", { ascending: true });
  allTemplates = data || [];
  renderTemplateList();
  populateTemplateSelects();
}

function renderTemplateList() {
  const listEl = document.getElementById("templateList");
  const emptyEl = document.getElementById("templateEmpty");
  listEl.innerHTML = "";
  if (!allTemplates.length) { emptyEl.classList.remove("hidden"); return; }
  emptyEl.classList.add("hidden");
  allTemplates.forEach((t) => {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.className = "info";
    const count = (t.deal_points || []).length;
    const fcount = (t.fields || []).length;
    const detail = t.source_pdf_path ? `PDF · ${fcount} fillable field${fcount === 1 ? "" : "s"}` : `${count} deal point${count === 1 ? "" : "s"}`;
    left.innerHTML = `<span class="name">${escHtml(t.name)}</span><span class="email">${t.type === "deal_memo" ? "Deal memo" : "Safety acknowledgment"} · ${detail}</span>`;
    const right = document.createElement("span");
    right.className = "actions";
    if (t.source_pdf_path) {
      const edit = document.createElement("button");
      edit.className = "remove-link"; edit.style.marginRight = "10px"; edit.textContent = "Edit fields";
      edit.addEventListener("click", () => editPdfTemplate(t));
      right.appendChild(edit);
    }
    const del = document.createElement("button");
    del.className = "remove-link"; del.textContent = "Delete";
    del.addEventListener("click", () => deleteTemplate(t.id));
    right.appendChild(del);
    li.appendChild(left); li.appendChild(right);
    listEl.appendChild(li);
  });
}

async function deleteTemplate(id) {
  if (!window.confirm("Delete this template? Invites using it lose that assignment, and anyone sent it who hasn't signed yet loses that pending item. If someone has already signed it, it can't be deleted.")) return;
  const t = allTemplates.find((x) => x.id === id);
  const msgEl = document.getElementById("templateMsg");
  const { error } = await client.rpc("admin_delete_template", { p_template: id });
  if (error) {
    if (msgEl) msgEl.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`;
    else window.alert(error.message);
    return;
  }
  if (t && t.source_pdf_path) { try { await client.storage.from(DEAL_BUCKET).remove([t.source_pdf_path]); } catch (_) {} }
  if (msgEl) msgEl.innerHTML = `<div class="msg ok">Template deleted.</div>`;
  loadTemplates();
}

function populateTemplateSelects() {
  const dealSel = document.getElementById("inviteDealMemoSelect");
  const safetySel = document.getElementById("inviteSafetySelect");
  if (!dealSel || !safetySel) return;
  [[dealSel, "deal_memo"], [safetySel, "safety"]].forEach(([sel, type]) => {
    const current = sel.value;
    sel.innerHTML = `<option value="">None</option>`;
    allTemplates.filter((t) => t.type === type).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id; opt.textContent = t.name;
      sel.appendChild(opt);
    });
    sel.value = current || "";
  });
}
