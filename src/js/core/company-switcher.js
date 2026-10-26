// ---- Company switcher (people who belong to more than one company) ----
async function loadMyCompanies() {
  const sel = document.getElementById("companySwitcher");
  const { data } = await client.rpc("my_companies");
  const list = data || [];
  sel.innerHTML = "";
  sel.classList.toggle("hidden", list.length < 2);
  if (list.length < 2) return;
  list.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name + (c.role === "admin" ? " (admin)" : "");
    if (c.active) opt.selected = true;
    sel.appendChild(opt);
  });
}
document.getElementById("companySwitcher").addEventListener("change", async (e) => {
  const sel = e.target;
  sel.disabled = true;
  const { error } = await client.rpc("switch_company", { p_company: sel.value });
  if (error) { sel.disabled = false; window.alert("Couldn't switch company: " + error.message); return; }
  window.location.reload();
});
