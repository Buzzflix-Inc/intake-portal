// ---- Admin: issue paystub ----
document.getElementById("adminPaystubUploadBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("adminPaystubMsg");
  const employeeId = document.getElementById("paystubEmployeeSelect").value;
  const file = document.getElementById("adminPaystubFile").files[0];
  if (!employeeId || !file) {
    msgEl.innerHTML = `<div class="msg error">Select an employee and a file.</div>`;
    return;
  }
  const path = `${employeeId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await client.storage.from("paystubs").upload(path, file);
  if (uploadError) {
    msgEl.innerHTML = `<div class="msg error">Upload failed: ${uploadError.message}</div>`;
    return;
  }
  const { error: insertError } = await client
    .from("paystubs")
    .insert({ user_id: employeeId, status: "issued", file_path: path });
  if (insertError) {
    msgEl.innerHTML = `<div class="msg error">File uploaded but record failed: ${insertError.message}</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="msg ok">Paystub issued.</div>`;
  document.getElementById("adminPaystubFile").value = "";
  loadAdminPaystubs();
});

async function loadAdminPaystubs() {
  const listEl = document.getElementById("adminPaystubsList");
  const emptyEl = document.getElementById("adminPaystubsEmpty");
  listEl.innerHTML = "";

  const { data: rows, error } = await client
    .from("paystubs")
    .select("id, user_id, file_path, created_at")
    .order("created_at", { ascending: false });

  if (error || !rows || rows.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  for (const row of rows) {
    const li = document.createElement("li");
    const name = row.file_path.split("/").pop();
    const email = profileMap.get(row.user_id) || row.user_id;

    const left = document.createElement("span");
    left.className = "info";
    left.innerHTML = `<span class="name">${name}</span><span class="email">${email}</span>`;

    const { data: signed } = await client.storage.from("paystubs").createSignedUrl(row.file_path, 60 * 5);
    const a = document.createElement("a");
    a.href = signed ? signed.signedUrl : "#";
    a.textContent = "Download";
    a.target = "_blank";

    const right = document.createElement("span");
    right.className = "actions";
    right.appendChild(a);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "remove-link";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteAdminPaystub(row.id, row.file_path));
    right.appendChild(deleteBtn);

    li.appendChild(left);
    li.appendChild(right);
    listEl.appendChild(li);
  }
}

async function deleteAdminPaystub(id, filePath) {
  await client.storage.from("paystubs").remove([filePath]);
  const { error } = await client.from("paystubs").delete().eq("id", id);
  if (!error) loadAdminPaystubs();
}
