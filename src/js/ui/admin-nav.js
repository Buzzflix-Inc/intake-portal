// ---- Collapsible admin sections, grouped under a sub-menu ----
(function () {
  const KEY = "intake_open_panels", GKEY = "intake_admin_group";
  let open = {};
  try { open = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(open)); } catch (_) {} };
  // Admin sections by group, in the order they appear; "sub" is the one-line hint under each title.
  const GROUPS = [
    { id: "review", label: "Review", items: [
      ["Documents — all submissions", "Approve or reject uploaded documents"],
      ["Timesheets — all submissions", "Approve timesheets, preview PDFs"],
      ["Deals — pending signature", "Countersign deal memos"],
    ]},
    { id: "people", label: "People", items: [
      ["Invite crew", "Invite someone and set their forms and documents"],
      ["Outstanding items", "Missing documents and unsigned memos, copy a reminder"],
      ["Employees", "Everyone onboarded, send them forms"],
      ["Department heads", "Who reviews which department"],
    ]},
    { id: "pay", label: "Pay", items: [
      ["Payroll export", "Days and hours per pay period, CSV"],
      ["Issue a paystub", "Upload a paystub for someone"],
      ["Paystubs — all issued", "Everything issued so far"],
    ]},
    { id: "forms", label: "Forms", items: [
      ["Deal memos & safety forms", "Templates, fields and page ranges"],
      ["Timesheet forms", "Union timesheet cards and their boxes"],
    ]},
    { id: "settings", label: "Settings", items: [
      ["Company Settings", "Name, colours, logo, background"],
      ["Approval chain", "Who signs off documents, in order"],
    ]},
  ];
  const groupOf = {}, firstOf = {};
  GROUPS.forEach((g) => g.items.forEach(([t, sub], i) => { groupOf[t] = { g: g.id, sub }; if (i === 0) firstOf[t] = true; }));

  document.querySelectorAll("#adminTab > section.panel, #superTab > section.panel, #deptTab > section.panel").forEach((sec) => {
    const h = sec.querySelector(":scope > h2");
    if (!h) return;
    const key = h.textContent.trim();
    const body = document.createElement("div");
    body.className = "acc-body";
    while (h.nextSibling) body.appendChild(h.nextSibling);
    sec.appendChild(body);
    sec.classList.add("acc");
    h.classList.add("acc-h");
    h.tabIndex = 0; h.setAttribute("role", "button");
    const meta = groupOf[key] && sec.parentElement.id === "adminTab" ? groupOf[key] : null;
    if (meta) {
      sec.dataset.group = meta.g; sec.dataset.key = key;
      const sub = document.createElement("span");
      sub.className = "acc-sub"; sub.textContent = meta.sub;
      const label = document.createElement("span");
      label.innerHTML = h.innerHTML;
      h.innerHTML = ""; label.appendChild(sub); h.appendChild(label);
    }
    const set = (v, persist) => { sec.classList.toggle("open", v); h.setAttribute("aria-expanded", String(v)); if (persist) { open[key] = v; save(); } };
    // First time ever: the first section of each group starts open.
    set(key in open ? !!open[key] : !!(meta && firstOf[key]), false);
    const toggle = () => set(!sec.classList.contains("open"), true);
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });

  // Sub-menu for the admin tab
  const adminTab = document.getElementById("adminTab");
  let current = "review";
  try { current = localStorage.getItem(GKEY) || "review"; } catch (_) {}
  if (!GROUPS.some((g) => g.id === current)) current = "review";
  const nav = document.createElement("div");
  nav.className = "adm-nav";
  nav.innerHTML = `<div class="adm-pills" role="tablist">${GROUPS.map((g) => `<button type="button" class="adm-pill" role="tab" data-g="${g.id}">${g.label}</button>`).join("")}</div>
    <div class="adm-bulk"><button type="button" data-bulk="open">Open all</button><button type="button" data-bulk="close">Close all</button></div>`;
  adminTab.insertBefore(nav, adminTab.firstChild);
  const showGroup = (id, persist) => {
    current = id;
    nav.querySelectorAll(".adm-pill").forEach((b) => { const on = b.dataset.g === id; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
    adminTab.querySelectorAll("section.panel.acc[data-group]").forEach((sec) => sec.classList.toggle("adm-off", sec.dataset.group !== id));
    if (persist) { try { localStorage.setItem(GKEY, id); } catch (_) {} }
  };
  nav.querySelectorAll(".adm-pill").forEach((b) => b.addEventListener("click", () => showGroup(b.dataset.g, true)));
  nav.querySelectorAll("[data-bulk]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.bulk === "open";
    adminTab.querySelectorAll(`section.panel.acc[data-group="${current}"]`).forEach((sec) => {
      sec.classList.toggle("open", v);
      sec.querySelector(":scope > h2").setAttribute("aria-expanded", String(v));
      open[sec.dataset.key] = v;
    });
    save();
  }));
  showGroup(current, false);

  window.expandPanelOf = (el) => {
    const sec = el && el.closest && el.closest("section.panel.acc");
    if (!sec) return;
    sec.classList.add("open");
    if (sec.dataset.group && sec.dataset.group !== current) showGroup(sec.dataset.group, true);
  };
})();
