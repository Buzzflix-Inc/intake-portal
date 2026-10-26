// ---- My Portal side menu: Deal Memos / Timesheets / Paystubs ----
(function () {
  const KEY = "intake_portal_view";
  const nav = document.getElementById("portalNav");
  const views = document.querySelectorAll("#portalTab .pv-view");
  let current = "deals";
  try { current = localStorage.getItem(KEY) || "deals"; } catch (_) {}
  if (![...views].some((v) => v.dataset.view === current)) current = "deals";
  const show = (id, persist) => {
    current = id;
    nav.querySelectorAll(".pv-link").forEach((b) => {
      const on = b.dataset.view === id;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    views.forEach((v) => v.classList.toggle("hidden", v.dataset.view !== id));
    if (persist) { try { localStorage.setItem(KEY, id); } catch (_) {} }
  };
  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".pv-link");
    if (b) { show(b.dataset.view, true); window.scrollTo({ top: 0 }); }
  });
  show(current, false);
})();
