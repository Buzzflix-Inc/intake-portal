// Time boxes you can just type into ("9", "930", "5p", "17:30") or pick from the list, and nudge with the up/down keys.
function tsTimeInput(id, aria) {
  return `<input type="text" class="ts-time" data-for="${id}" inputmode="text" autocomplete="off" placeholder="9:00 AM" aria-label="${aria}" /><input type="hidden" id="${id}" />`;
}
function tsParseTimeX(t) {
  const m = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(t || ""));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] || 0);
  if (h > 24 || mi > 59 || (h === 24 && mi)) return null;
  return { h: h === 24 ? 0 : h, mi, suffix: m[3] ? m[3].toLowerCase() : "", explicit24: h > 12 || /^0\d/.test(m[1]) };
}
function tsTimeFrom(id, text) {
  const p = tsParseTimeX(text);
  if (!p) return "";
  let h = p.h;
  if (p.suffix) { if (p.suffix === "p" && h < 12) h += 12; else if (p.suffix === "a" && h === 12) h = 0; }
  else if (!p.explicit24 && h >= 1 && h <= 11 && !/^tsCall|^tsQCall/.test(id)) {
    // wrap and meal times typed without am/pm: assume the later one (after call)
    const day = id.replace(/\D/g, ""), callEl = document.getElementById((id.startsWith("tsQ") ? "tsQCall" : "tsCall" + day));
    const callMin = callEl && callEl.value ? toMinutes(callEl.value) : null;
    const cand = h * 60 + p.mi;
    if (callMin != null) { if (cand <= callMin) h += 12; } else if (h <= 6) h += 12;
  }
  return String(h).padStart(2, "0") + ":" + String(p.mi).padStart(2, "0");
}
function tsSyncTimes(root) {
  (root || document).querySelectorAll(".ts-time").forEach((v) => {
    if (document.activeElement === v) return;
    const h = document.getElementById(v.dataset.for);
    if (h && v.classList.contains("ts-time-bad") && !h.value) return;   // keep what they typed so they can fix it
    if (h) { v.value = h.value ? fmtTime(h.value) : ""; v.classList.remove("ts-time-bad"); }
  });
}
// One shared, lightweight time picker (replaces the slow native list)
const tsPick = { el: null, input: null, items: [], active: -1 };
function tsPickBuild() {
  if (tsPick.el) return;
  const el = document.createElement("div");
  el.className = "ts-pop"; el.setAttribute("role", "listbox");
  el.innerHTML = Array.from({ length: 96 }, (_, k) => { const m = k * 15; const v = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); return `<div class="ts-pop-i" role="option" data-v="${v}" data-m="${m}">${fmtTime(v)}</div>`; }).join("");
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => { const it = e.target.closest(".ts-pop-i"); if (it && tsPick.input) tsPickChoose(it.dataset.v); });
  document.body.appendChild(el);
  tsPick.el = el; tsPick.items = [...el.children];
}
function tsPickSet(idx, center) {
  const it = tsPick.items;
  if (tsPick.active >= 0 && it[tsPick.active]) it[tsPick.active].classList.remove("on");
  tsPick.active = Math.max(0, Math.min(it.length - 1, idx));
  const t = it[tsPick.active]; t.classList.add("on");
  const box = tsPick.el;
  if (center) box.scrollTop = t.offsetTop - box.clientHeight / 2 + t.offsetHeight / 2;
  else if (t.offsetTop < box.scrollTop) box.scrollTop = t.offsetTop;
  else if (t.offsetTop + t.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = t.offsetTop + t.offsetHeight - box.clientHeight;
}
function tsPickOpen(v) {
  tsPickBuild();
  tsPick.input = v; tsPick.t = Date.now();
  const h = document.getElementById(v.dataset.for);
  const cur = tsTimeFrom(v.dataset.for, v.value) || (h && h.value) || "";
  const isCall = /^tsCall|^tsQCall/.test(v.dataset.for);
  const m = cur ? toMinutes(cur) : (isCall ? 7 * 60 : /Wrap/i.test(v.dataset.for) ? 17 * 60 : 12 * 60);
  const r = v.getBoundingClientRect(), box = tsPick.el;
  box.style.display = "block"; box.style.minWidth = Math.max(r.width, 110) + "px";
  const hh = Math.min(240, box.scrollHeight);
  const below = window.innerHeight - r.bottom, up = below < hh + 12 && r.top > below;
  box.style.maxHeight = Math.max(120, Math.min(240, (up ? r.top : below) - 12)) + "px";
  box.style.left = Math.min(r.left, window.innerWidth - box.offsetWidth - 8) + "px";
  box.style.top = up ? Math.max(8, r.top - box.offsetHeight - 4) + "px" : r.bottom + 4 + "px";
  tsPickSet(Math.round(m / 15) % 96, true);
}
function tsPickClose() { if (tsPick.el) tsPick.el.style.display = "none"; tsPick.input = null; }
function tsPickChoose(val) {
  const v = tsPick.input; if (!v) return;
  v.value = fmtTime(val); v.classList.remove("ts-time-bad");
  v.dispatchEvent(new Event("change"));
  tsPickClose();
  const all = [...v.closest("#timesheetGrid, .ts-grid, body").querySelectorAll(".ts-time")], k = all.indexOf(v);
  if (all[k + 1]) all[k + 1].focus();
}
window.addEventListener("resize", () => tsPickClose());
document.addEventListener("scroll", (e) => { if (tsPick.el && e.target !== tsPick.el && Date.now() - tsPick.t > 400) tsPickClose(); }, true);
// Custom dropdown for every <select> (fast, styled, keyboard friendly)
const selPick = { el: null, sel: null, items: [], active: -1, t: 0 };
function selPickClose() { if (selPick.el) selPick.el.style.display = "none"; if (selPick.sel) selPick.sel.classList.remove("sel-open"); selPick.sel = null; }
function selPickSet(i, center) {
  const it = selPick.items; if (!it.length) return;
  if (it[selPick.active]) it[selPick.active].classList.remove("on");
  let k = Math.max(0, Math.min(it.length - 1, i));
  selPick.active = k; const t = it[k]; t.classList.add("on");
  const box = selPick.el;
  if (center) box.scrollTop = t.offsetTop - box.clientHeight / 2 + t.offsetHeight / 2;
  else if (t.offsetTop < box.scrollTop) box.scrollTop = t.offsetTop;
  else if (t.offsetTop + t.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = t.offsetTop + t.offsetHeight - box.clientHeight;
}
function selPickOpen(sel) {
  if (!selPick.el) {
    const el = document.createElement("div"); el.className = "ts-pop sel-pop"; el.setAttribute("role", "listbox");
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => { const it = e.target.closest(".ts-pop-i"); if (it && !it.classList.contains("dis")) selPickChoose(Number(it.dataset.i)); });
    document.body.appendChild(el); selPick.el = el;
  }
  selPickClose();
  const box = selPick.el; box.textContent = "";
  selPick.items = [...sel.options].map((o, i) => {
    const d = document.createElement("div");
    d.className = "ts-pop-i" + (o.disabled ? " dis" : "") + (i === sel.selectedIndex ? " cur" : "");
    d.dataset.i = i; d.textContent = o.textContent || "\u00a0"; d.setAttribute("role", "option");
    box.appendChild(d); return d;
  });
  selPick.sel = sel; selPick.t = Date.now(); sel.classList.add("sel-open");
  const r = sel.getBoundingClientRect();
  box.style.display = "block"; box.style.minWidth = r.width + "px"; box.style.maxWidth = Math.min(480, window.innerWidth - 16) + "px"; box.style.maxHeight = "none";
  const hh = Math.min(280, box.scrollHeight), below = window.innerHeight - r.bottom, up = below < hh + 12 && r.top > below;
  box.style.maxHeight = Math.max(120, Math.min(280, (up ? r.top : below) - 12)) + "px";
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + "px";
  box.style.top = up ? Math.max(8, r.top - box.offsetHeight - 4) + "px" : r.bottom + 4 + "px";
  selPickSet(Math.max(0, sel.selectedIndex), true);
}
function selPickChoose(i) {
  const sel = selPick.sel; if (!sel) return;
  selPickClose();
  if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); }
  sel.focus();
}
function selPickable(t) { return t && t.tagName === "SELECT" && !t.multiple && !(t.size > 1) && !t.disabled && !t.hasAttribute("data-native"); }
document.addEventListener("mousedown", (e) => {
  const t = e.target;
  if (selPickable(t)) { e.preventDefault(); t.focus(); if (selPick.sel === t) selPickClose(); else selPickOpen(t); }
  else if (selPick.sel && !(selPick.el && selPick.el.contains(t))) selPickClose();
}, true);
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (selPick.sel) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); let k = selPick.active + (e.key === "ArrowDown" ? 1 : -1); while (selPick.items[k] && selPick.items[k].classList.contains("dis")) k += e.key === "ArrowDown" ? 1 : -1; if (selPick.items[k]) selPickSet(k, false); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selPickChoose(selPick.active); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); selPickClose(); }
    else if (e.key === "Tab") selPickClose();
    return;
  }
  if (selPickable(t) && (e.key === "Enter" || e.key === " " || ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.altKey))) { e.preventDefault(); selPickOpen(t); }
}, true);
window.addEventListener("resize", selPickClose);
document.addEventListener("scroll", (e) => { if (selPick.sel && e.target !== selPick.el && Date.now() - selPick.t > 400) selPickClose(); }, true);
// Themed calendar for every <input type="date"> (replaces the browser's own popup; typing into the box still works)
const dpPick = { el: null, input: null, view: null, focus: null, t: 0 };
const DP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dpParse(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
function dpBounds(inp) { return { min: dpParse(inp.min), max: dpParse(inp.max) }; }
function dpAllowed(d, b) { return (!b.min || d >= b.min) && (!b.max || d <= b.max); }
function dpPickable(t) { return t && t.tagName === "INPUT" && t.type === "date" && !t.disabled && !t.readOnly && !t.hasAttribute("data-native") && !matchMedia("(pointer: coarse)").matches; }
function dpBuild() {
  if (dpPick.el) return;
  const el = document.createElement("div");
  el.className = "dp-pop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Choose a date");
  el.innerHTML = `<div class="dp-head"><button type="button" class="dp-nav" data-step="-1" aria-label="Previous month">&#8249;</button>
    <div class="dp-title"><select class="dp-month" aria-label="Month">${DP_MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("")}</select><select class="dp-year" aria-label="Year"></select></div>
    <button type="button" class="dp-nav" data-step="1" aria-label="Next month">&#8250;</button></div>
    <div class="dp-dow">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="dp-grid" role="grid"></div>
    <div class="dp-foot"><button type="button" class="dp-clear">Clear</button><button type="button" class="dp-today">Today</button></div>`;
  el.addEventListener("mousedown", (e) => { if (!e.target.closest("select")) e.preventDefault(); });
  el.addEventListener("click", (e) => {
    const nav = e.target.closest(".dp-nav"), day = e.target.closest(".dp-day");
    if (nav) { const v = dpPick.view; dpPick.view = new Date(v.getFullYear(), v.getMonth() + Number(nav.dataset.step), 1); dpRender(); }
    else if (day && !day.disabled) dpChoose(day.dataset.v);
    else if (e.target.closest(".dp-today")) dpChoose(ymd(new Date()));
    else if (e.target.closest(".dp-clear")) dpChoose("");
  });
  el.querySelector(".dp-month").addEventListener("change", (e) => { dpPick.view = new Date(dpPick.view.getFullYear(), Number(e.target.value), 1); dpRender(); dpPick.input && dpPick.input.focus(); });
  el.querySelector(".dp-year").addEventListener("change", (e) => { dpPick.view = new Date(Number(e.target.value), dpPick.view.getMonth(), 1); dpRender(); dpPick.input && dpPick.input.focus(); });
  document.body.appendChild(el);
  dpPick.el = el;
}
function dpRender() {
  const inp = dpPick.input, v = dpPick.view, b = dpBounds(inp), el = dpPick.el;
  const sel = inp.value, today = ymd(new Date()), focus = dpPick.focus ? ymd(dpPick.focus) : "";
  const y0 = b.min ? b.min.getFullYear() : Math.min(1920, v.getFullYear()), y1 = b.max ? b.max.getFullYear() : Math.max(new Date().getFullYear() + 10, v.getFullYear());
  const ys = el.querySelector(".dp-year");
  ys.innerHTML = Array.from({ length: y1 - y0 + 1 }, (_, k) => `<option>${y1 - k}</option>`).join("");
  ys.value = String(v.getFullYear()); el.querySelector(".dp-month").value = String(v.getMonth());
  const first = new Date(v.getFullYear(), v.getMonth(), 1), start = new Date(first); start.setDate(1 - first.getDay());
  let html = "";
  for (let k = 0; k < 42; k++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k), s = ymd(d);
    const cls = ["dp-day", d.getMonth() !== v.getMonth() ? "out" : "", s === today ? "today" : "", s === sel ? "sel" : "", s === focus ? "focus" : ""].filter(Boolean).join(" ");
    html += `<button type="button" class="${cls}" data-v="${s}" tabindex="-1"${dpAllowed(d, b) ? "" : " disabled"}${s === sel ? ' aria-selected="true"' : ""}>${d.getDate()}</button>`;
  }
  el.querySelector(".dp-grid").innerHTML = html;
  const prevEnd = new Date(v.getFullYear(), v.getMonth(), 0), nextStart = new Date(v.getFullYear(), v.getMonth() + 1, 1);
  el.querySelector('.dp-nav[data-step="-1"]').disabled = !!(b.min && prevEnd < b.min);
  el.querySelector('.dp-nav[data-step="1"]').disabled = !!(b.max && nextStart > b.max);
  el.querySelector(".dp-today").disabled = !dpAllowed(dpParse(today), b);
}
function dpPlace() {
  const r = dpPick.input.getBoundingClientRect(), box = dpPick.el;
  const below = window.innerHeight - r.bottom, up = below < box.offsetHeight + 12 && r.top > below;
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + "px";
  box.style.top = up ? Math.max(8, r.top - box.offsetHeight - 6) + "px" : r.bottom + 6 + "px";
}
function dpOpen(inp) {
  dpBuild();
  if (typeof selPickClose === "function") selPickClose();
  const b = dpBounds(inp);
  let base = dpParse(inp.value) || (b.min && b.min > new Date() ? b.min : null) || (b.max && b.max < new Date() ? b.max : null) || new Date();
  dpPick.input = inp; dpPick.t = Date.now(); dpPick.focus = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  dpPick.view = new Date(base.getFullYear(), base.getMonth(), 1);
  inp.classList.add("dp-open");
  dpPick.el.style.display = "block";
  dpRender(); dpPlace();
}
function dpClose() { if (dpPick.el) dpPick.el.style.display = "none"; if (dpPick.input) dpPick.input.classList.remove("dp-open"); dpPick.input = null; }
function dpChoose(val) {
  const inp = dpPick.input; if (!inp) return;
  dpClose();
  if (inp.value !== val) { inp.value = val; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); }
  inp.focus();
}
function dpMove(days, months) {
  const f = dpPick.focus, n = months ? new Date(f.getFullYear(), f.getMonth() + months, Math.min(f.getDate(), 28)) : new Date(f.getFullYear(), f.getMonth(), f.getDate() + days);
  dpPick.focus = n; dpPick.view = new Date(n.getFullYear(), n.getMonth(), 1); dpRender();
}
document.addEventListener("mousedown", (e) => {
  const t = e.target;
  if (dpPick.el && dpPick.el.contains(t)) return;
  if (typeof selPick !== "undefined" && selPick.el && selPick.el.contains(t) && dpPick.input) return;   // month/year dropdowns
  if (dpPickable(t)) {
    // the calendar icon area would open the browser's popup, so take it over; the date parts stay typeable
    const r = t.getBoundingClientRect();
    if (e.clientX > r.right - 34) { e.preventDefault(); t.focus(); }
    if (dpPick.input === t) dpClose(); else dpOpen(t);
  } else if (dpPick.input) dpClose();
}, true);
document.addEventListener("click", (e) => { if (dpPickable(e.target)) e.preventDefault(); }, true);   // Firefox opens its popup on click
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (dpPick.input && t === dpPick.input) {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); dpClose(); return; }
    if (k === "Tab") { dpClose(); return; }
    if (e.altKey && k === "ArrowUp") { e.preventDefault(); dpClose(); return; }
    // arrows walk the calendar only when they aren't editing the typed date
    if (e.ctrlKey || e.metaKey) {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k];
      if (step) { e.preventDefault(); dpMove(step); return; }
    }
    if (k === "PageUp" || k === "PageDown") { e.preventDefault(); dpMove(0, (k === "PageUp" ? -1 : 1) * (e.shiftKey ? 12 : 1)); return; }
    if (k === "Enter") { e.preventDefault(); if (dpAllowed(dpPick.focus, dpBounds(t))) dpChoose(ymd(dpPick.focus)); return; }
  } else if (dpPickable(t) && ((e.altKey && e.key === "ArrowDown") || e.key === "F4" || (e.key === " " && !e.target.value))) { e.preventDefault(); dpOpen(t); }
}, true);
// typing a date moves the open calendar along with it
document.addEventListener("input", (e) => { if (dpPick.input && e.target === dpPick.input) { const d = dpParse(e.target.value); if (d) { dpPick.focus = d; dpPick.view = new Date(d.getFullYear(), d.getMonth(), 1); dpRender(); } } }, true);
window.addEventListener("resize", dpClose);
document.addEventListener("scroll", (e) => {
  if (!dpPick.input || Date.now() - dpPick.t < 400) return;
  if (dpPick.el.contains(e.target) || (typeof selPick !== "undefined" && selPick.el && selPick.el.contains(e.target))) return;
  dpClose();
}, true);
