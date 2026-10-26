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

  // Menu icons: inner SVG, drawn in the same stroke style as the My Portal menu.
  const ICON = {
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.5a4 4 0 0 1 0 9M22 21v-1a6 6 0 0 0-4-5.6"/>',
    star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/>',
    form: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    sliders: '<path d="M3 6h11M18 6h3M3 12h3M10 12h11M3 18h13M20 18h1"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    checks: '<path d="M10 6h11M10 12h11M10 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    userX: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M17 8l4 4M21 8l-4 4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  };

  // Groups of [section heading, menu label, hint, icon]; sections not listed go in a last "More" group.
  function build(tab, groups) {
    const byTitle = {};
    tab.querySelectorAll(":scope > section.panel").forEach((sec) => {
      const h = sec.querySelector(":scope > h2");
      if (h) byTitle[h.textContent.trim()] = sec;
    });
    const used = new Set();
    groups.forEach((g) => g.items.forEach(([t]) => used.add(t)));
    const extra = Object.keys(byTitle).filter((t) => !used.has(t));
    if (extra.length) groups = groups.concat([{ label: "More", items: extra.map((t) => [t, t, "", "doc"]) }]);
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
      items.forEach(([t, label, hint, icon]) => {
        const id = "s" + n++;
        html += `<button type="button" class="pv-link" data-view="${id}"${hint ? ` title="${escHtml(hint)}"` : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[icon] || ICON.doc}</svg><span class="pv-label">${escHtml(label)}</span></button>`;
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
      ["Documents — all submissions", "Documents", "Approve or reject uploaded documents", "doc"],
      ["Timesheets — all submissions", "Timesheets", "Approve timesheets, preview PDFs", "clock"],
      ["Deals — pending signature", "Countersign deals", "Countersign deal memos", "pen"],
    ]},
    { label: "People", items: [
      ["Invite crew", "Invite crew", "Invite someone and set their forms and documents", "userPlus"],
      ["Outstanding items", "Outstanding items", "Missing documents and unsigned memos, copy a reminder", "alert"],
      ["Employees", "Employees", "Everyone onboarded, send them forms", "users"],
      ["Department heads", "Department heads", "Who reviews which department", "star"],
    ]},
    { label: "Pay", items: [
      ["Payroll export", "Payroll export", "Days and hours per pay period, CSV", "download"],
      ["Issue a paystub", "Issue a paystub", "Upload a paystub for someone", "upload"],
      ["Paystubs — all issued", "Paystubs issued", "Everything issued so far", "cash"],
    ]},
    { label: "Forms", items: [
      ["Deal memos & safety forms", "Deal memo forms", "Templates, fields and page ranges", "form"],
      ["Timesheet forms", "Timesheet forms", "Union timesheet cards and their boxes", "calendar"],
    ]},
    { label: "Settings", items: [
      ["Company Settings", "Company settings", "Name, colours, logo, background", "sliders"],
      ["Approval chain", "Approval chain", "Who signs off documents, in order", "checks"],
    ]},
  ]);
  const showAdmin = wire(adminTab, "intake_admin_view", "s0");

  const superTab = document.getElementById("superTab");
  build(superTab, [
    { label: "Companies", items: [
      ["Companies", "Companies", "Every company and its admins", "building"],
      ["Create a company", "Create a company", "Set up a company and invite its first admin", "plus"],
    ]},
    { label: "Accounts", items: [
      ["Unassigned accounts", "Unassigned accounts", "Accounts that belong to no company", "userX"],
    ]},
    { label: "Activity", items: [
      ["Audit log", "Audit log", "Who changed what, and when", "history"],
    ]},
  ]);
  wire(superTab, "intake_super_view", "s0");

  // Bring an admin section into view, e.g. when a form editor opens inside it.
  window.expandPanelOf = (el) => {
    const view = el && el.closest && el.closest("#adminTab .pv-view");
    if (view) showAdmin(view.dataset.view, true);
  };
})();
