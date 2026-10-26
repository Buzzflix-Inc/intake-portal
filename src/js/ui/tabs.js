// ---- Tabs ----
const tabPortalBtn = document.getElementById("tabPortalBtn");
const tabAdminBtn = document.getElementById("tabAdminBtn");
const portalTab = document.getElementById("portalTab");
const adminTab = document.getElementById("adminTab");

const tabDeptBtn = document.getElementById("tabDeptBtn");
const deptTab = document.getElementById("deptTab");
const tabSuperBtn = document.getElementById("tabSuperBtn");
const superTab = document.getElementById("superTab");

function switchTab(which) {
  [[tabPortalBtn, portalTab, "portal"], [tabDeptBtn, deptTab, "dept"], [tabAdminBtn, adminTab, "admin"], [tabSuperBtn, superTab, "super"]]
    .forEach(([btn, panel, key]) => {
      btn.classList.toggle("active", key === which);
      panel.classList.toggle("hidden", key !== which);
    });
  const bar = document.getElementById("tabs"), on = bar.querySelector(".tab-btn.active");
  if (on && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - bar.offsetLeft - 12;
}
tabPortalBtn.addEventListener("click", () => switchTab("portal"));
tabAdminBtn.addEventListener("click", () => switchTab("admin"));
tabDeptBtn.addEventListener("click", () => { switchTab("dept"); loadDeptTimesheets(); });
tabSuperBtn.addEventListener("click", () => { switchTab("super"); loadSuperOverview(); loadAuditLog(); });
