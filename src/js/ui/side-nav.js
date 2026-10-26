// ---- Side menus: one section at a time, picked from a menu on the left ----
// My Portal's menu is in the markup; Admin Review and Super Admin build theirs here
// from the section headings, grouped as below.
(function () {
  function wire(tab, key, fallback) {
    const nav = tab.querySelector(":scope > .pv-nav");
    const views = [...tab.querySelectorAll(":scope > .pv-main > .pv-view")];
    let current = fallback;
    try { current = localStorage.getItem(key) || fallback; } catch (_) {}
    if (!views.some((v) => v.dataset.view === current)) current = views[0].dataset.view;
    const show = (id, persist) => {
      current = id;
      nav.querySelectorAll(".pv-link").forEach((b) => {
        const on = b.dataset.view === id;
        b.classList.toggle("active", on);
        if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
        // On narrow screens the menu is a sideways strip: keep the chosen item in view.
        if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = b.offsetLeft - nav.offsetLeft - 12;
      });
      views.forEach((v) => v.classList.toggle("hidden", v.dataset.view !== id));
      if (persist) { try { localStorage.setItem(key, id); } catch (_) {} }
    };
    nav.addEventListener("click", (e) => {
      const b = e.target.closest(".pv-link");
      if (b) { show(b.dataset.view, true); window.scrollTo({ top: 0 }); }
    });
    show(current, false);
    return show;
  }

  // Groups of [section heading, menu label, hint]; sections not listed go in a last "More" group.
  function build(tab, groups) {
    const byTitle = {};
    tab.querySelectorAll(":scope > section.panel").forEach((sec) => {
      const h = sec.querySelector(":scope > h2");
      if (h) byTitle[h.textContent.trim()] = sec;
    });
    const used = new Set();
    groups.forEach((g) => g.items.forEach(([t]) => used.add(t)));
    const extra = Object.keys(byTitle).filter((t) => !used.has(t));
    if (extra.length) groups = groups.concat([{ label: "More", items: extra.map((t) => [t, t, ""]) }]);
    const nav = document.createElement("nav");
    nav.className = "pv-nav pv-nav-many";
    nav.setAttribute("aria-label", "Sections");
    const main = document.createElement("div");
    main.className = "pv-main";
    let n = 0, html = "";
    groups.forEach((g) => {
      const items = g.items.filter(([t]) => byTitle[t]);
      if (!items.length) return;
      if (groups.length > 1) html += `<p class="pv-group">${escHtml(g.label)}</p>`;
      items.forEach(([t, label, hint]) => {
        const id = "s" + n++;
        html += `<button type="button" class="pv-link" data-view="${id}"${hint ? ` title="${escHtml(hint)}"` : ""}><span class="pv-label">${escHtml(label)}</span></button>`;
        const view = document.createElement("div");
        view.className = "pv-view";
        view.dataset.view = id;
        view.appendChild(byTitle[t]);
        main.appendChild(view);
      });
    });
    nav.innerHTML = html;
    tab.appendChild(nav);
    tab.appendChild(main);
    tab.classList.add("has-side");
  }

  wire(document.getElementById("portalTab"), "intake_portal_view", "deals");

  const adminTab = document.getElementById("adminTab");
  build(adminTab, [
    { label: "Review", items: [
      ["Documents — all submissions", "Documents", "Approve or reject uploaded documents"],
      ["Timesheets — all submissions", "Timesheets", "Approve timesheets, preview PDFs"],
      ["Deals — pending signature", "Countersign deals", "Countersign deal memos"],
    ]},
    { label: "People", items: [
      ["Invite crew", "Invite crew", "Invite someone and set their forms and documents"],
      ["Outstanding items", "Outstanding items", "Missing documents and unsigned memos, copy a reminder"],
      ["Employees", "Employees", "Everyone onboarded, send them forms"],
      ["Department heads", "Department heads", "Who reviews which department"],
    ]},
    { label: "Pay", items: [
      ["Payroll export", "Payroll export", "Days and hours per pay period, CSV"],
      ["Issue a paystub", "Issue a paystub", "Upload a paystub for someone"],
      ["Paystubs — all issued", "Paystubs issued", "Everything issued so far"],
    ]},
    { label: "Forms", items: [
      ["Deal memos & safety forms", "Deal memo forms", "Templates, fields and page ranges"],
      ["Timesheet forms", "Timesheet forms", "Union timesheet cards and their boxes"],
    ]},
    { label: "Settings", items: [
      ["Company Settings", "Company settings", "Name, colours, logo, background"],
      ["Approval chain", "Approval chain", "Who signs off documents, in order"],
    ]},
  ]);
  const showAdmin = wire(adminTab, "intake_admin_view", "s0");

  const superTab = document.getElementById("superTab");
  build(superTab, [
    { label: "Companies", items: [
      ["Companies", "Companies", "Every company and its admins"],
      ["Create a company", "Create a company", "Set up a company and invite its first admin"],
    ]},
    { label: "Accounts", items: [
      ["Unassigned accounts", "Unassigned accounts", "Accounts that belong to no company"],
    ]},
    { label: "Activity", items: [
      ["Audit log", "Audit log", "Who changed what, and when"],
    ]},
  ]);
  wire(superTab, "intake_super_view", "s0");

  // Bring an admin section into view, e.g. when a form editor opens inside it.
  window.expandPanelOf = (el) => {
    const view = el && el.closest && el.closest("#adminTab .pv-view");
    if (view) showAdmin(view.dataset.view, true);
  };
})();
