// ---- Admin: department heads ----
let deptHeadRows = [];

function populateDeptHeadForm() {
  const deptSel = document.getElementById("deptHeadDeptSelect");
  if (deptSel && !deptSel.dataset.filled) {
    Object.keys(DEPARTMENTS).forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d; opt.textContent = d;
      deptSel.appendChild(opt);
    });
    deptSel.dataset.filled = "1";
  }
  const userSel = document.getElementById("deptHeadUserSelect");
  if (userSel) {
    userSel.innerHTML = "";
    for (const [userId, email] of profileMap.entries()) {
      const opt = document.createElement("option");
      opt.value = userId; opt.textContent = email;
      userSel.appendChild(opt);
    }
  }
}

async function loadDepartmentHeads() {
  const listEl = document.getElementById("deptHeadsList");
  const emptyEl = document.getElementById("deptHeadsEmpty");
  const { data } = await client.from("department_heads").select("id, department, head_user_id").order("department");
  deptHeadRows = data || [];
  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", deptHeadRows.length > 0);
  deptHeadRows.forEach((row) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="info"><span class="name">${escHtml(profileMap.get(row.head_user_id) || row.head_user_id)}</span><span class="email">${escHtml(row.department)}</span></span>`;
    const right = document.createElement("span");
    right.className = "actions";
    const rm = document.createElement("button");
    rm.className = "remove-link";
    rm.textContent = "Remove";
    rm.addEventListener("click", async () => {
      const { error } = await client.from("department_heads").delete().eq("id", row.id);
      const msgEl = document.getElementById("deptHeadsMsg");
      msgEl.innerHTML = error ? `<div class="msg error">Couldn't remove: ${escHtml(error.message)}</div>` : "";
      loadDepartmentHeads();
    });
    right.appendChild(rm);
    li.appendChild(right);
    listEl.appendChild(li);
  });
}

document.getElementById("addDeptHeadBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("deptHeadsMsg");
  const department = document.getElementById("deptHeadDeptSelect").value;
  const head_user_id = document.getElementById("deptHeadUserSelect").value;
  if (!department || !head_user_id) {
    msgEl.innerHTML = `<div class="msg error">Pick a department and an employee.</div>`;
    return;
  }
  const { error } = await client.from("department_heads").insert({ company_id: currentCompany.id, department, head_user_id });
  if (error) {
    const dup = error.code === "23505";
    msgEl.innerHTML = `<div class="msg error">${dup ? "They're already a head of that department." : "Couldn't add: " + escHtml(error.message)}</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Department head added.</div>`;
  loadDepartmentHeads();
});
