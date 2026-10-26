// ---- Timesheets: weekly call/wrap entry ----
// Pay periods run Sunday to Saturday. The dropdown is rebuilt from today's
// date every time it loads (and when the tab regains focus), so it always
// shows this week plus the previous TS_WEEKS_BACK weeks.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TS_WEEKS_BACK = 8;
let myTimesheetRows = [];
let tsGridWeek = null;

// Minutes between call and wrap. A wrap earlier than call is treated as
// the next morning. Returns null if either is blank, NaN if they match.
function shiftMinutes(call, wrap) {
  const c = toMinutes(call), w = toMinutes(wrap);
  if (c == null || w == null) return null;
  if (c === w) return NaN;
  let diff = w - c;
  if (diff < 0) diff += 1440;
  return diff;
}

function buildPeriodOptions() {
  const sel = document.getElementById("tsPeriodSelect");
  if (!sel) return;
  const prev = sel.value;
  const submitted = new Set(myTimesheetRows.filter((r) => r.week_start && r.status !== "rejected").map((r) => r.week_start));
  const thisWeek = weekStartOf(new Date());
  sel.innerHTML = "";
  let firstOpen = null;
  for (let i = 0; i <= TS_WEEKS_BACK; i++) {
    const key = ymd(addDays(thisWeek, -7 * i));
    const done = submitted.has(key);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = periodLabel(key) + (i === 0 ? " (this week)" : i === 1 ? " (last week)" : "") + (done ? " — submitted" : "");
    opt.disabled = done;
    if (!done && !firstOpen) firstOpen = key;
    sel.appendChild(opt);
  }
  const keep = prev && [...sel.options].some((o) => o.value === prev && !o.disabled);
  sel.value = keep ? prev : (firstOpen || sel.options[0].value);
  if (sel.value !== tsGridWeek) renderTimesheetGrid();
}

function tsWireTimes(grid) {
  grid.querySelectorAll(".ts-time").forEach((v) => {
    const h = document.getElementById(v.dataset.for);
    const commit = () => {
      const txt = v.value.trim();
      if (!txt) { h.value = ""; v.classList.remove("ts-time-bad"); updateTimesheetTotals(); return; }
      const t = tsTimeFrom(v.dataset.for, txt);
      h.value = t; v.classList.toggle("ts-time-bad", !t);
      if (t) v.value = fmtTime(t);
      updateTimesheetTotals();
    };
    v.addEventListener("focus", () => { try { v.select(); } catch (_) {} tsPickOpen(v); });
    v.addEventListener("click", () => { if (tsPick.input !== v) tsPickOpen(v); });
    v.addEventListener("input", () => {
      const p = tsParseTimeX(v.value); if (!p || tsPick.input !== v) return;
      let hh = p.h; if (p.suffix === "p" && hh < 12) hh += 12; else if (p.suffix === "a" && hh === 12) hh = 0; else if (!p.suffix && hh >= 1 && hh <= 6) hh += 12;
      tsPickSet(Math.round((hh * 60 + p.mi) / 15) % 96, true);
    });
    v.addEventListener("change", commit);
    v.addEventListener("blur", () => { tsPickClose(); commit(); });
    v.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { tsPickClose(); return; }
      if (e.key === "Tab") { tsPickClose(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (tsPick.input === v && tsPick.active >= 0 && tsPick.el.style.display === "block" && v.value.trim() === "") { tsPickChoose(tsPick.items[tsPick.active].dataset.v); return; }
        commit(); tsPickClose(); const all = [...grid.querySelectorAll(".ts-time")], k = all.indexOf(v); if (all[k + 1]) all[k + 1].focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        if (tsPick.input !== v) tsPickOpen(v);
        tsPickSet(tsPick.active + (e.key === "ArrowUp" ? -1 : 1), false);
        const it = tsPick.items[tsPick.active];
        v.value = fmtTime(it.dataset.v); h.value = it.dataset.v; v.classList.remove("ts-time-bad");
        updateTimesheetTotals();
      }
    });
  });
}

function renderTimesheetGrid() {
  const sel = document.getElementById("tsPeriodSelect");
  const grid = document.getElementById("tsGrid");
  tsGridWeek = sel.value;
  if (!tsGridWeek) { grid.innerHTML = ""; return; }
  const start = parseYmd(tsGridWeek);
  grid.classList.toggle("has-kit", myKitEnabled);
  tsMeals = tsTemplateMeals();
  const tf = (lab, inner) => `<label class="ts-f"><span>${lab}</span>${inner}</label>`;
  let html = `<div class="ts-quick">
    <div class="ts-quick-h"><b>Quick fill</b><span>Same hours most days? Enter them once and apply.</span></div>
    <div class="ts-quick-b">
      ${tf("Call", `${tsTimeInput(`tsQCall`, `Call time for quick fill`)}`)}
      ${tf("Wrap", `${tsTimeInput(`tsQWrap`, `Wrap time for quick fill`)}`)}
      ${tsMeals.m1 ? tf("Meal out", `${tsTimeInput(`tsQM1o`, `Meal out for quick fill`)}`) + tf("Meal in", `${tsTimeInput(`tsQM1i`, `Meal in for quick fill`)}`) : tf("Break (min)", `<input type="number" id="tsQBrk" min="0" max="240" step="5" inputmode="numeric" placeholder="0" aria-label="Break minutes for quick fill" />`)}
      ${tf("Apply to", `<select id="tsQDays"><option value="weekdays">Mon – Fri</option><option value="all">Every day</option><option value="sunthu">Sun – Thu</option><option value="weekend">Sat &amp; Sun</option></select>`)}
      <button type="button" class="btn-secondary ts-quick-go" id="tsQGo">Fill days</button>
    </div>
    <div class="ts-quick-f"><span>You can also paste times from a spreadsheet into any <b>Call</b> box.</span><button type="button" class="remove-link" id="tsClearAll">Clear all days</button></div>
  </div>`;
  for (let i = 0; i < 7; i++) {
    html += `<div class="ts-card" id="tsCard${i}">
      <div class="ts-card-h">
        <div class="ts-day"><span class="ts-dname">${DAY_NAMES[i]}</span><small>${fmtShort(addDays(start, i))}</small></div>
        <div class="ts-hrs" id="tsHrs${i}">–</div>
        <select class="ts-copy" data-from="${i}" aria-label="Copy ${DAY_NAMES[i]} to other days"><option value="">Copy day…</option><option value="next">To next day</option><option value="weekdays">To Mon–Fri</option><option value="all">To every day</option></select>
      </div>
      <div class="ts-card-b">
        ${tf("Call", `${tsTimeInput(`tsCall${i}`, `Call time, ${DAY_NAMES[i]}`)}`)}
        ${tf("Wrap", `${tsTimeInput(`tsWrap${i}`, `Wrap time, ${DAY_NAMES[i]}`)}`)}
        ${tsMeals.m1 ? tf("Meal out", `${tsTimeInput(`tsM1o${i}`, `Meal out, ${DAY_NAMES[i]}`)}`) + tf("Meal in", `${tsTimeInput(`tsM1i${i}`, `Meal in, ${DAY_NAMES[i]}`)}`) : ""}
        ${tsMeals.m2 ? tf("2nd meal out", `${tsTimeInput(`tsM2o${i}`, `Second meal out, ${DAY_NAMES[i]}`)}`) + tf("2nd meal in", `${tsTimeInput(`tsM2i${i}`, `Second meal in, ${DAY_NAMES[i]}`)}`) : ""}
        <label class="ts-f ts-brk"><span>${tsMeals.m1 ? "Break (auto)" : "Break (min)"}</span><input type="number" id="tsBrk${i}" min="0" max="240" step="5" inputmode="numeric" placeholder="0" aria-label="Unpaid break in minutes, ${DAY_NAMES[i]}" /></label>
        ${myKitEnabled ? `<label class="ts-f ts-kit"><span>Kit fee</span><input type="checkbox" id="tsKit${i}" aria-label="Kit fee, ${DAY_NAMES[i]}" /></label>` : ""}
      </div>
    </div>`;
  }
  html += `<details class="ts-ot" id="tsOt"><summary>Add overtime <span class="muted">(only if you worked any)</span></summary>
    <p class="ts-note" style="margin:6px 0 8px;">Enter the hours you worked at each overtime rate (for example 2 or 1.5). They are part of that day's hours, not extra on top.</p>
    <div class="ts-ot-grid"><span></span><span>1.5X</span><span>2X</span><span>3X</span>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="ts-ot-day">${DAY_NAMES[i].slice(0, 3)}</span>${[["15", "1.5X"], ["2", "2X"], ["3", "3X"]].map(([k, lab]) => `<input type="number" min="0" max="20" step="0.25" inputmode="decimal" id="tsOt${k}_${i}" placeholder="0" aria-label="${lab} overtime hours, ${DAY_NAMES[i]}" />`).join("")}`).join("")}</div>
  </details>`;
  grid.innerHTML = html;
  if (tsMeals.m1) grid.querySelectorAll(".ts-brk input").forEach((inp) => { inp.readOnly = true; inp.tabIndex = -1; inp.placeholder = "auto"; });
  grid.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", updateTimesheetTotals);
    inp.addEventListener("change", updateTimesheetTotals);
  });
  tsWireCopy(grid);
  tsWireTimes(grid);
  updateTimesheetTotals();
}

// ---- Copy a day's hours to other days, and paste hours from a spreadsheet ----
function tsCopyDay(from, to) {
  const ids = ["tsCall", "tsWrap", "tsBrk", "tsM1o", "tsM1i", "tsM2o", "tsM2i"];
  ids.forEach((p) => {
    const a = document.getElementById(p + from), b = document.getElementById(p + to);
    if (a && b && !b.readOnly) b.value = a.value;
  });
  const ka = document.getElementById("tsKit" + from), kb = document.getElementById("tsKit" + to);
  if (ka && kb) kb.checked = ka.checked;
}
function tsParseTime(t) {
  const m = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(t || ""));
  if (!m) return "";
  let h = Number(m[1]); const mi = Number(m[2] || 0);
  if (m[3]) { const pm = m[3].toLowerCase() === "p"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || mi > 59) return "";
  return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
}
function tsWireCopy(grid) {
  grid.querySelectorAll(".ts-copy").forEach((sel) => sel.addEventListener("change", () => {
    const from = Number(sel.dataset.from), mode = sel.value;
    sel.value = "";
    if (!mode) return;
    if (!document.getElementById("tsCall" + from).value && !document.getElementById("tsWrap" + from).value) { const me = document.getElementById("timesheetsMsg"); if (me) me.innerHTML = `<div class="msg error">Fill in this day's call and wrap first, then copy it.</div>`; return; }
    const targets = mode === "next" ? (from < 6 ? [from + 1] : []) : mode === "weekdays" ? [1, 2, 3, 4, 5].filter((d) => d !== from) : [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== from);
    targets.forEach((t) => tsCopyDay(from, t));
    updateTimesheetTotals();
  }));
  const go = document.getElementById("tsQGo");
  if (go) go.addEventListener("click", () => {
    const v = (id) => (document.getElementById(id) || {}).value || "";
    if (!v("tsQCall") || !v("tsQWrap")) { const me = document.getElementById("timesheetsMsg"); if (me) me.innerHTML = `<div class="msg error">Enter a call and a wrap time to fill in.</div>`; return; }
    const m = v("tsQDays");
    const days = m === "all" ? [0, 1, 2, 3, 4, 5, 6] : m === "sunthu" ? [0, 1, 2, 3, 4] : m === "weekend" ? [0, 6] : [1, 2, 3, 4, 5];
    days.forEach((d) => {
      [["tsCall", "tsQCall"], ["tsWrap", "tsQWrap"], ["tsM1o", "tsQM1o"], ["tsM1i", "tsQM1i"], ["tsBrk", "tsQBrk"]].forEach(([t, q]) => {
        const a = document.getElementById(t + d), b = document.getElementById(q);
        if (a && b && !a.readOnly) a.value = b.value;
      });
    });
    const me = document.getElementById("timesheetsMsg"); if (me) me.innerHTML = "";
    updateTimesheetTotals();
  });
  const clr = document.getElementById("tsClearAll");
  if (clr) clr.addEventListener("click", () => {
    grid.querySelectorAll(".ts-card input, .ts-ot input, .ts-quick input").forEach((inp) => { if (inp.type === "checkbox") inp.checked = false; else if (!inp.readOnly) inp.value = ""; });
    updateTimesheetTotals();
  });
  // paste rows like "9:00 AM<tab>5:00 PM" (one line per day) starting at the box you paste into
  grid.querySelectorAll('.ts-time[data-for^="tsCall"], .ts-time[data-for^="tsWrap"]').forEach((inp) => inp.addEventListener("paste", (e) => {
    const text = (e.clipboardData || window.clipboardData).getData("text") || "";
    if (!/[\t\n]/.test(text.trim())) return;
    const start = Number(inp.dataset.for.replace(/\D/g, "")), isWrap = inp.dataset.for.startsWith("tsWrap");
    const rows = text.trim().split(/\r?\n/).map((r) => r.split("\t"));
    let filled = 0;
    rows.forEach((cols, r) => {
      const d = start + r; if (d > 6) return;
      const t = cols.map(tsParseTime);
      const order = isWrap ? ["tsWrap", "tsM1o", "tsM1i", "tsM2o", "tsM2i"] : ["tsCall", "tsWrap", "tsM1o", "tsM1i", "tsM2o", "tsM2i"];
      order.forEach((p, k) => { const el = document.getElementById(p + d); if (el && t[k]) { el.value = t[k]; filled++; } });
    });
    if (filled) { e.preventDefault(); updateTimesheetTotals(); }
  }));
}

// Which meal columns the assigned union form needs (none = plain "break minutes").
let tsMeals = { m1: false, m2: false };
function tsTemplateMeals() {
  const f = (myTsTemplate && myTsTemplate.fields) || [];
  const has = (re) => f.some((x) => re.test(x.bind || ""));
  return { m1: has(/^d\d\.meal1_(in|out)$/), m2: has(/^d\d\.meal2_(in|out)$/) };
}
function mealSpan(outId, inId) {
  const o = document.getElementById(outId), n = document.getElementById(inId);
  if (!o || !n || !o.value || !n.value) return 0;
  const diff = toMinutes(n.value) - toMinutes(o.value);
  return diff < 0 ? diff + 1440 : diff;
}
// Unpaid break for a day: the meal times when the form has them, else the typed minutes.
function dayBreak(i) {
  if (tsMeals.m1) {
    const total = mealSpan(`tsM1o${i}`, `tsM1i${i}`) + (tsMeals.m2 ? mealSpan(`tsM2o${i}`, `tsM2i${i}`) : 0);
    const brk = document.getElementById(`tsBrk${i}`);
    if (brk) brk.value = total ? String(total) : "";
    return total;
  }
  return Math.max(0, parseInt(document.getElementById(`tsBrk${i}`).value, 10) || 0);
}

// Worked minutes for one day: call to wrap, less any unpaid break.
// null = day not filled in, NaN = invalid (same call/wrap, or break too long).
function dayMinutes(i) {
  const gross = shiftMinutes(document.getElementById(`tsCall${i}`).value, document.getElementById(`tsWrap${i}`).value);
  if (gross == null || Number.isNaN(gross)) return gross;
  const brk = dayBreak(i);
  return brk >= gross ? NaN : gross - brk;
}

function updateTimesheetTotals() {
  let total = 0, kitDays = 0;
  tsSyncTimes(document.getElementById("tsGrid"));
  for (let i = 0; i < 7; i++) {
    const m = dayMinutes(i);
    const out = document.getElementById(`tsHrs${i}`);
    out.classList.toggle("has", m != null && !Number.isNaN(m));
    { const cd = document.getElementById(`tsCard${i}`); if (cd) { cd.classList.toggle("filled", m != null && !Number.isNaN(m)); cd.classList.toggle("bad", Number.isNaN(m)); } }
    if (m == null) out.textContent = "–";
    else if (Number.isNaN(m)) out.textContent = "!";
    else {
      out.textContent = fmtHours(m);
      total += m;
      const kit = document.getElementById(`tsKit${i}`);
      if (kit && kit.checked) kitDays++;
    }
  }
  document.getElementById("tsTotal").textContent = fmtHours(total);
  const kitRow = document.getElementById("tsKitRow");
  kitRow.classList.toggle("hidden", !myKitEnabled);
  document.getElementById("tsKitTotal").textContent = `${kitDays} day${kitDays === 1 ? "" : "s"} × $${myKitRate.toFixed(2)} = $${(kitDays * myKitRate).toFixed(2)}`;
}

function readTimesheetForm() {
  const start = parseYmd(tsGridWeek);
  const entries = [];
  let total = 0, kitDays = 0;
  for (let i = 0; i < 7; i++) {
    const call = document.getElementById(`tsCall${i}`).value;
    const wrap = document.getElementById(`tsWrap${i}`).value;
    const brkVal = dayBreak(i);
    const brkRaw = brkVal ? String(brkVal) : "";
    const kit = !!(document.getElementById(`tsKit${i}`) && document.getElementById(`tsKit${i}`).checked);
    if (!call && !wrap) {
      if (["15", "2", "3"].some((k) => { const el = document.getElementById(`tsOt${k}_${i}`); return el && parseFloat(el.value) > 0; })) return { error: `${DAY_NAMES[i]} has overtime but no call and wrap time.` };
      if (brkRaw || kit) return { error: `${DAY_NAMES[i]} has a break or kit fee but no call and wrap time.` };
      continue;
    }
    const day = DAY_NAMES[i];
    if (!call || !wrap) return { error: `Enter both a call and a wrap time for ${day}, or clear that day.` };
    const gross = shiftMinutes(call, wrap);
    if (!gross) return { error: `Call and wrap are the same time on ${day}.` };
    const brk = Math.max(0, parseInt(brkRaw, 10) || 0);
    if (brk > 240) return { error: `${day}'s break is over 4 hours. Check the minutes.` };
    if (brk >= gross) return { error: `${day}'s break is longer than the shift.` };
    const mins = gross - brk;
    if (mins > 20 * 60) return { error: `${day} is over 20 hours. Check the call and wrap times.` };
    const entry = { date: ymd(addDays(start, i)), day, call, wrap, break_minutes: brk, kit, minutes: mins };
    {
      let otTotal = 0;
      for (const [k, key] of [["15", "ot15"], ["2", "ot2"], ["3", "ot3"]]) {
        const el = document.getElementById(`tsOt${k}_${i}`);
        const v = el ? parseFloat(el.value) : 0;
        if (Number.isFinite(v) && v > 0) { entry[key] = Math.round(v * 100) / 100; otTotal += v; }
      }
      if (otTotal * 60 > mins + 0.5) return { error: `${day}'s overtime (${otTotal} h) is more than the hours worked that day (${fmtHours(mins)}).` };
    }
    if (tsMeals.m1) {
      ["M1o:meal1_out", "M1i:meal1_in", "M2o:meal2_out", "M2i:meal2_in"].forEach((pair) => {
        const [idp, key] = pair.split(":");
        const el = document.getElementById(`ts${idp}${i}`);
        if (el && el.value) entry[key] = el.value;
      });
      if ((entry.meal1_out && !entry.meal1_in) || (!entry.meal1_out && entry.meal1_in) || (entry.meal2_out && !entry.meal2_in) || (!entry.meal2_out && entry.meal2_in)) {
        return { error: `Enter both the meal out and meal in time for ${day}, or clear them.` };
      }
    }
    entries.push(entry);
    total += mins;
    if (kit) kitDays++;
  }
  if (!entries.length) return { error: "Enter call and wrap times for at least one day." };
  return { entries, totalMinutes: total, kitDays };
}

// Extra boxes the assigned union form needs: things typed once per
// submission (member number…) and the typed signature.
function renderTsExtras() {
  const box = document.getElementById("tsExtras");
  if (!box) return;
  const fields = (myTsTemplate && myTsTemplate.fields) || [];
  const free = fields.filter((f) => f.bind === "free" || f.bind === "free_check");
  const needsSig = fields.some((f) => f.bind === "signature");
  if (!myTsTemplate || (!free.length && !needsSig)) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  let html = `<p class="ts-extra-note">This goes onto the ${escHtml(myTsTemplate.name)} form.</p>`;
  free.forEach((f) => {
    html += f.bind === "free_check"
      ? `<div class="field-line"><label><input type="checkbox" data-ts-free="${f.id}" /> ${escHtml(f.label || "Tick if it applies")}</label></div>`
      : (() => {
        // things already on file (name, position, phone…) are filled in for them
        const gb = dmGuessBind(f.label, "text"), pre = gb ? bindValue(gb) : "";
        return `<div class="field-line"><label for="tsFree_${f.id}">${escHtml(f.label || "Details")}${f.optional ? ` <span class="muted">(optional)</span>` : ""}${pre ? ` <span class="muted">· from your details</span>` : ""}</label><input type="text" id="tsFree_${f.id}" data-ts-free="${f.id}" value="${escHtml(pre)}" /></div>`;
      })();
  });
  if (needsSig) {
    html += `<div class="field-line"><label for="tsSignName">Type your full name to sign this timesheet</label><input type="text" id="tsSignName" autocomplete="name" placeholder="${escHtml(myFullName || '')}" /><div class="sig-prev" id="tsSignPrev"></div></div>`;
  }
  box.innerHTML = html;
  box.classList.remove("hidden");
  const sn = document.getElementById("tsSignName");
  if (sn) sn.addEventListener("input", () => { document.getElementById("tsSignPrev").textContent = sn.value; });
}
// Reads and checks those extra boxes. Returns { formValues, signature } or { error }.
function readTsExtras() {
  const out = { formValues: { _position: myCrewRole || "" }, signature: null };
  if (!myTsTemplate) return out;
  for (const f of myTsTemplate.fields || []) {
    if (f.bind === "free") {
      const v = (document.querySelector(`[data-ts-free="${f.id}"]`) || {}).value || "";
      if (!v.trim() && !f.optional) return { error: `Fill in "${f.label || "Details"}" first.` };
      out.formValues[f.id] = v.trim();
    } else if (f.bind === "free_check") {
      const el = document.querySelector(`[data-ts-free="${f.id}"]`);
      out.formValues[f.id] = !!(el && el.checked);
    }
  }
  if ((myTsTemplate.fields || []).some((f) => f.bind === "signature")) {
    const s = (document.getElementById("tsSignName") || {}).value || "";
    if (s.trim().length < 3) return { error: "Type your full name to sign the timesheet." };
    out.signature = s.trim();
  }
  return out;
}
