// ---- Double-click guard: action buttons ignore repeat clicks and show a spinner until the work settles ----
(function () {
  let inflight = 0, lastNet = Date.now();
  const realFetch = window.fetch.bind(window);
  window.fetch = function () {
    inflight++;
    const done = () => { inflight--; lastNet = Date.now(); };
    return realFetch.apply(null, arguments).then((r) => { done(); return r; }, (e) => { done(); throw e; });
  };
  const ACTION = "button.btn-primary, button.btn-secondary, button.secondary, button.remove-link, button.preview-link, button[data-sign-id], button[data-final-path]";
  const SKIP = "[data-tool], [data-bulk], [data-g], .adm-pill, .tab-btn, .pf-tool, .pf-pop, #pdfFieldList, #pfAllRequired, #pfAllOptional, #pfClearPdf, #tsTplCancel, #toggleModeBtn, #signOutBtn, [data-so], #previewCloseBtn, .modal-close, .acc-head";
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(ACTION);
    if (!b || b.matches(SKIP) || b.closest(SKIP) || b.disabled) return;
    if (b.dataset.busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    b.dataset.busy = "1"; b.classList.add("is-busy");
    const start = Date.now();
    const tick = () => {
      const quiet = inflight === 0 && Date.now() - lastNet > 900;
      if ((quiet && Date.now() - start > 2000) || Date.now() - start > 60000 || !document.body.contains(b)) {
        b.classList.remove("is-busy"); delete b.dataset.busy; return;
      }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  }, true);
})();
