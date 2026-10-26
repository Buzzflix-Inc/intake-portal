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
