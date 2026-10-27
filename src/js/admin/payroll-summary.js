// ---- Payroll summary: what to pay for a week, per person, with a PDF for accounting ----
// Admins and people with payroll access (company_memberships.payroll_access) see the Payroll tab.
// Data comes from the payroll_week RPC; amounts are an estimate from each person's rate on their
// crew record and the production's overtime rules. Payment happens in the payroll software.

let canSeePayroll = false;
let payrollData = null, payrollCalc = null, payrollWeek = null;

const PR_UNIT = { hour: "/h", day: "/day", week: "/wk" };
const prNum = (v) => Number(v) || 0;
const prRound = (n) => Math.round(n * 100) / 100;
const prHours = (h) => (Math.round(h * 100) / 100).toFixed(2);
const prWeekLabel = (ws) => {
  const s = parseYmd(ws), e = addDays(s, 6);
  const o = { weekday: "short", month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-CA", o)} – ${e.toLocaleDateString("en-CA", { ...o, year: "numeric" })}`;
};

// Split one day's hours into regular, overtime (1.5x), double and triple time.
// Overtime the crew member entered on the timesheet (union forms) wins over the production's rules.
function prSplitDay(entry, rules) {
  const h = prNum(entry.minutes) / 60;
  if (entry.ot15 != null || entry.ot2 != null || entry.ot3 != null) {
    const ot = prNum(entry.ot15), dt = prNum(entry.ot2), tt = prNum(entry.ot3);
    return { h, reg: Math.max(0, h - ot - dt - tt), ot, dt, tt, otMult: 1.5, dtMult: 2, entered: true };
  }
  const otA = rules.ot_daily_after != null ? prNum(rules.ot_daily_after) : null;
  const dtA = rules.dt_daily_after != null ? prNum(rules.dt_daily_after) : null;
  const reg = otA ? Math.min(h, otA) : h;
  const dt = dtA ? Math.max(0, h - Math.max(dtA, otA || 0)) : 0;
  return { h, reg, ot: Math.max(0, h - reg - dt), dt, tt: 0, otMult: prNum(rules.ot_multiplier) || 1.5, dtMult: prNum(rules.dt_multiplier) || 2, entered: false };
}

// One person's week: the days, the split of hours and what it comes to.
function prPersonPay(person, sheet, rules) {
  const days = (Array.isArray(sheet && sheet.entries) ? sheet.entries : [])
    .filter((e) => prNum(e.minutes) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((e) => ({ e, ...prSplitDay(e, rules) }));
  // Weekly overtime: regular hours past the weekly limit become overtime (production rules only).
  if (rules.ot_weekly_after != null) {
    let reg = 0;
    const lim = prNum(rules.ot_weekly_after);
    days.forEach((d) => {
      if (d.entered) { reg += d.reg; return; }
      const over = Math.max(0, reg + d.reg - lim) - Math.max(0, reg - lim);
      reg += d.reg;
      if (over > 0) { d.reg -= over; d.ot += over; }
    });
  }
  const rate = person.pay_rate != null ? prNum(person.pay_rate) : null;
  const unit = person.pay_unit || "hour";
  days.forEach((d) => {
    d.pay = rate == null ? null
      : unit === "hour" ? prRound(rate * (d.reg + d.ot * d.otMult + d.dt * d.dtMult + d.tt * 3))
      : unit === "day" ? rate : null;
  });
  const sum = (k) => days.reduce((t, d) => t + d[k], 0);
  const hours = { total: sum("h"), reg: sum("reg"), ot: sum("ot"), dt: sum("dt"), tt: sum("tt") };
  let base = null;
  if (rate != null && days.length) {
    base = unit === "hour" ? days.reduce((t, d) => t + d.pay, 0) : unit === "day" ? rate * days.length : rate;
  } else if (rate != null) base = 0;
  const kit = sheet ? prNum(sheet.kit_days) * prNum(sheet.kit_rate) : 0;
  return { days, hours, base: base == null ? null : prRound(base), kit: prRound(kit), kitDays: sheet ? prNum(sheet.kit_days) : 0 };
}

// The whole week. Mirrors payroll_week_ready() in the database for who's expected.
function computePayroll(data, week) {
  const rules = data.company || {};
  const weekEnd = ymd(addDays(parseYmd(week), 6));
  const byUser = new Map();
  (data.timesheets || []).forEach((t) => { (byUser.get(t.user_id) || byUser.set(t.user_id, []).get(t.user_id)).push(t); });
  const invByUser = new Map();
  (data.invoices || []).filter((r) => r.status !== "rejected").forEach((r) => { (invByUser.get(r.user_id) || invByUser.set(r.user_id, []).get(r.user_id)).push(r); });
  const crewById = new Map((data.crew || []).map((c) => [c.user_id, c]));

  const ids = new Set([...byUser.keys(), ...invByUser.keys()]);
  (data.crew || []).forEach((c) => {
    if (c.role !== "admin" && c.has_invite && !c.contractor
        && (!c.start_date || c.start_date <= weekEnd) && (!c.end_date || c.end_date >= week)) ids.add(c.user_id);
  });

  const people = [...ids].map((uid) => {
    const sheets = byUser.get(uid) || [];
    const fallback = sheets[0] || (invByUser.get(uid) || [])[0] || {};
    const c = crewById.get(uid) || { user_id: uid, name: fallback.employee_name || fallback.employee_email || "Former crew member", email: fallback.employee_email, department: fallback.department, pay_unit: "hour", pay_rate: null };
    // Their timesheet: the latest one that wasn't rejected, else the latest.
    const sorted = [...sheets].sort((a, b) => ((b.status !== "rejected") - (a.status !== "rejected")) || String(b.created_at).localeCompare(String(a.created_at)));
    const sheet = sorted[0] || null;
    const invoices = invByUser.get(uid) || [];
    const p = { ...c, sheet, invoices, ...prPersonPay(c, sheet, rules) };
    p.invoiceTotal = prRound(invoices.reduce((t, r) => t + prNum(r.invoice && r.invoice.total), 0));
    p.noRate = !!sheet && c.pay_rate == null;
    p.amount = p.noRate ? null : prRound((p.base || 0) + p.kit + p.invoiceTotal);
    if (sheet) {
      p.status = sheet.status === "approved" ? "approved" : sheet.status === "rejected" ? "rejected" : sheet.dept_status === "approved" ? "final" : "review";
    } else if (invoices.length) {
      p.status = invoices.every((r) => r.status === "approved") ? "approved" : "review";
    } else p.status = "missing";
    if (sheet && invoices.some((r) => r.status !== "approved") && p.status === "approved") p.status = "review";
    return p;
  }).sort((a, b) => String(a.department || "~").localeCompare(String(b.department || "~")) || String(a.name).localeCompare(String(b.name)));

  const approved = people.filter((p) => p.status === "approved");
  const sum = (list, f) => prRound(list.reduce((t, p) => t + (f(p) || 0), 0));
  return {
    rules, people,
    ready: people.length > 0 && approved.length === people.length,
    total: sum(approved, (p) => p.amount),
    pendingTotal: sum(people.filter((p) => p.status !== "approved"), (p) => p.amount),
    hours: { total: sum(people, (p) => p.hours.total), reg: sum(people, (p) => p.hours.reg), ot: sum(people, (p) => p.hours.ot), dt: sum(people, (p) => p.hours.dt + p.hours.tt) },
    kit: sum(approved, (p) => p.kit),
    invoices: sum(approved, (p) => p.invoiceTotal),
    noRate: people.filter((p) => p.noRate),
  };
}

const PR_STATUS = {
  approved: ["approved", "Approved", "Approved"],
  final: ["pending", "Waiting for final approval", "Final approval"],
  review: ["pending", "Waiting for review", "In review"],
  rejected: ["rejected", "Rejected, waiting to be resubmitted", "Rejected"],
  missing: ["rejected", "Not submitted", "Not submitted"],
};
function prRateText(p) {
  if (p.contractor && p.pay_rate == null) return "Invoices";
  return p.pay_rate == null ? "No rate set" : `${money(p.pay_rate)}${PR_UNIT[p.pay_unit] || ""}`;
}
function prRulesText(rules) {
  const bits = [];
  if (rules.ot_daily_after != null) bits.push(`${prNum(rules.ot_multiplier)}x after ${prNum(rules.ot_daily_after)} h/day`);
  if (rules.dt_daily_after != null) bits.push(`${prNum(rules.dt_multiplier)}x after ${prNum(rules.dt_daily_after)} h/day`);
  if (rules.ot_weekly_after != null) bits.push(`${prNum(rules.ot_multiplier)}x after ${prNum(rules.ot_weekly_after)} h/week`);
  return bits.length ? `Overtime for hourly crew: ${bits.join(", ")}. Overtime entered on a timesheet is used as entered.` : "No overtime rules set; hourly crew are paid straight time unless overtime is entered on the timesheet.";
}

// ---- Loading ----
async function loadPayroll(week) {
  const msg = document.getElementById("prMsg");
  const sel = document.getElementById("prWeek");
  msg.innerHTML = `<p class="empty">Loading…</p>`;
  const { data: weeks, error } = await client.rpc("payroll_weeks");
  if (error) { msg.innerHTML = `<div class="msg error">${escHtml(/payroll_weeks|function/i.test(error.message) ? "Payroll isn't set up on this database yet." : error.message)}</div>`; return; }
  const list = weeks || [];
  const thisWeek = ymd(weekStartOf(new Date()));
  const pick = week || payrollWeek || (list.find((w) => w.week_start < thisWeek) || list[0] || {}).week_start || ymd(addDays(parseYmd(thisWeek), -7));
  const opts = list.some((w) => w.week_start === pick) ? list : [{ week_start: pick, approved: 0, pending: 0, rejected: 0 }, ...list].sort((a, b) => b.week_start.localeCompare(a.week_start));
  sel.innerHTML = opts.map((w) => {
    const open = w.pending + w.rejected;
    const tag = !w.approved && !open ? "no timesheets" : open ? `${open} not approved` : "all approved";
    return `<option value="${escHtml(w.week_start)}">${escHtml(prWeekLabel(w.week_start))} · ${tag}</option>`;
  }).join("");
  sel.value = pick;
  await loadPayrollWeek(pick);
}

async function loadPayrollWeek(week) {
  payrollWeek = week;
  const msg = document.getElementById("prMsg");
  const { data, error } = await client.rpc("payroll_week", { p_week: week });
  if (payrollWeek !== week) return;  // picked another week meanwhile
  if (error) { msg.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
  payrollData = data;
  payrollCalc = computePayroll(data, week);
  msg.innerHTML = "";
  renderPayroll();
}

// ---- Rendering ----
function renderPayroll() {
  const c = payrollCalc, wrap = document.getElementById("prBody");
  const outstanding = c.people.filter((p) => p.status !== "approved");
  const banner = !c.people.length
    ? `<div class="pr-banner"><strong>No timesheets for this week.</strong></div>`
    : c.ready
      ? `<div class="pr-banner ready"><strong>Ready for payroll.</strong> All ${c.people.length} ${c.people.length === 1 ? "person is" : "people are"} approved.</div>`
      : `<div class="pr-banner"><strong>Not ready yet.</strong> ${outstanding.length} of ${c.people.length} still to approve or submit: ${outstanding.map((p) => `${escHtml(p.name)} (${PR_STATUS[p.status][1].toLowerCase()})`).join(", ")}. The PDF is marked DRAFT until everyone is approved.</div>`;
  const noRate = c.noRate.length
    ? `<div class="msg error">No pay rate for ${c.noRate.map((p) => escHtml(p.name)).join(", ")}, so they're left out of the total.${isAdmin ? " Open them below to set one." : " Ask an admin to set one."}</div>` : "";

  const chip = (label, value, sub) => `<div class="pr-stat"><span>${label}</span><strong>${value}</strong>${sub ? `<em>${sub}</em>` : ""}</div>`;
  const stats = `<div class="pr-stats">
    ${chip(c.ready ? "Total to pay" : "Approved so far", money(c.total), c.pendingTotal ? `${money(c.pendingTotal)} more waiting on approval` : "")}
    ${chip("People", String(c.people.length), `${c.people.length - outstanding.length} approved`)}
    ${chip("Hours", prHours(c.hours.total), `${prHours(c.hours.ot)} overtime · ${prHours(c.hours.dt)} double+`)}
    ${chip("Kit fees", money(c.kit), c.ready ? "" : "approved only")}
    ${c.invoices ? chip("Contractor invoices", money(c.invoices), c.ready ? "" : "approved only") : ""}
  </div>`;

  const rows = c.people.map((p, i) => {
    const [cls, label] = PR_STATUS[p.status];
    const hrs = p.sheet ? `${prHours(p.hours.total)}${p.hours.ot + p.hours.dt + p.hours.tt > 0 ? ` <span class="muted">(${prHours(p.hours.ot + p.hours.dt + p.hours.tt)} OT)</span>` : ""}` : "–";
    return `<tr class="pr-row" data-i="${i}" tabindex="0" aria-expanded="false">
      <td><span class="pr-caret" aria-hidden="true">▸</span><strong>${escHtml(p.name)}</strong><span class="pr-sub">${escHtml(p.crew_role || "")}${p.contractor ? " · contractor" : ""}</span></td>
      <td>${escHtml(p.department || "–")}</td>
      <td class="${p.noRate ? "pr-warn" : ""}">${escHtml(prRateText(p))}</td>
      <td class="num">${hrs}</td>
      <td class="num">${p.sheet ? p.days.length : "–"}</td>
      <td class="num">${p.kit ? money(p.kit) : "–"}</td>
      <td class="num">${p.invoices.length ? money(p.invoiceTotal) : "–"}</td>
      <td class="num"><strong>${p.amount == null ? "–" : money(p.amount)}</strong></td>
      <td><span class="status-badge status-${cls}">${label}</span></td>
    </tr><tr class="pr-detail hidden" data-for="${i}"><td colspan="9"></td></tr>`;
  }).join("");

  wrap.innerHTML = `${banner}${noRate}${stats}
    <div class="pr-actions">
      <label class="checkbox-label"><input type="checkbox" id="prIncludeDetails" checked /> Include each person's days in the PDF</label>
      <button type="button" class="btn-primary" id="prPdfBtn"${c.people.length ? "" : " disabled"}>${c.ready ? "Download PDF" : "Download draft PDF"}</button>
    </div>
    ${c.people.length ? `<div class="pr-table-wrap"><table class="pr-table">
      <thead><tr><th>Name</th><th>Department</th><th>Rate</th><th class="num">Hours</th><th class="num">Days</th><th class="num">Kit</th><th class="num">Invoices</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7">${c.ready ? "Total to pay" : "Approved total"}</td><td class="num"><strong>${money(c.total)}</strong></td><td></td></tr></tfoot>
    </table></div>` : ""}
    <p class="desc pr-rules">${escHtml(prRulesText(c.rules))} Amounts are estimates before deductions; the payroll software calculates the final pay.</p>`;
}

function prDetailHtml(p) {
  const head = `<p class="pr-detail-meta">${escHtml(p.email || "")} · ${escHtml(prRateText(p))}${p.kitDays ? ` · kit ${p.kitDays} day${p.kitDays === 1 ? "" : "s"} × ${money(p.sheet.kit_rate)}` : ""}${p.sheet ? ` · submitted ${new Date(p.sheet.created_at).toLocaleDateString()}` : ""}</p>`;
  const unitNote = p.pay_unit !== "hour" && p.hours.ot + p.hours.dt + p.hours.tt > 0 ? `<p class="desc">Overtime hours are shown but not added to a ${p.pay_unit === "day" ? "day" : "weekly"} rate.</p>` : "";
  const days = p.days.length ? `<table class="pr-days">
      <thead><tr><th>Day</th><th>Call</th><th>Wrap</th><th class="num">Break</th><th class="num">Hours</th><th class="num">Reg</th><th class="num">OT</th><th class="num">Double+</th><th>Kit</th><th class="num">Pay</th></tr></thead>
      <tbody>${p.days.map((d) => `<tr>
        <td>${escHtml(fmtShort(parseYmd(d.e.date)))} <span class="muted">${escHtml(String(d.e.day || "").slice(0, 3))}</span></td>
        <td>${escHtml(fmtTime(d.e.call) || "")}</td><td>${escHtml(fmtTime(d.e.wrap) || "")}</td>
        <td class="num">${prNum(d.e.break_minutes)} min</td><td class="num">${prHours(d.h)}</td>
        <td class="num">${prHours(d.reg)}</td><td class="num">${d.ot ? prHours(d.ot) : "–"}</td><td class="num">${d.dt + d.tt ? prHours(d.dt + d.tt) : "–"}</td>
        <td>${d.e.kit ? "Yes" : ""}</td><td class="num">${d.pay == null ? "–" : money(d.pay)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="4">Week${p.days.some((d) => d.entered) ? " (overtime as entered on the timesheet)" : ""}</td><td class="num">${prHours(p.hours.total)}</td><td class="num">${prHours(p.hours.reg)}</td><td class="num">${prHours(p.hours.ot)}</td><td class="num">${prHours(p.hours.dt + p.hours.tt)}</td><td></td><td class="num">${p.base == null ? "–" : money(p.base)}</td></tr></tfoot>
    </table>` : p.sheet ? "" : p.invoices.length ? "" : `<p class="empty" style="text-align:left;padding:0;">No timesheet submitted for this week.</p>`;
  const inv = p.invoices.map((r) => {
    const v = r.invoice || {};
    return `<div class="pr-invoice"><strong>Invoice ${escHtml(v.number || "")}</strong> · ${escHtml(v.date || "")}${v.period ? ` · ${escHtml(v.period)}` : ""} · <span class="status-badge status-${r.status === "approved" ? "approved" : "pending"}">${escHtml(r.status)}</span>
      <ul>${(v.lines || []).map((l) => `<li>${escHtml(l.desc)}: ${prNum(l.qty)} × ${money(l.rate)} = ${money(l.amount)}</li>`).join("")}${prNum(v.tax) ? `<li>Tax (${prNum(v.taxPct)}%): ${money(v.tax)}</li>` : ""}<li><strong>Total ${money(v.total)}</strong></li></ul></div>`;
  }).join("");
  const sum = p.amount == null ? "" : `<p class="pr-detail-sum">${p.base ? `Pay ${money(p.base)}` : ""}${p.kit ? ` + kit ${money(p.kit)}` : ""}${p.invoiceTotal ? ` + invoices ${money(p.invoiceTotal)}` : ""} = <strong>${money(p.amount)}</strong></p>`;
  const rateForm = isAdmin && p.has_invite && !p.contractor ? `<div class="pr-rate-form">
      <label for="prRate">Pay rate</label>
      <div class="pay-rate-row"><input type="number" id="prRate" min="0" step="0.01" placeholder="0.00" value="${p.pay_rate == null ? "" : escHtml(p.pay_rate)}" />
      <select id="prUnit">${["hour", "day", "week"].map((u) => `<option value="${u}"${(p.pay_unit || "hour") === u ? " selected" : ""}>per ${u}</option>`).join("")}</select>
      <button type="button" class="btn-secondary" data-pr-save-rate="${escHtml(p.email || "")}">Save rate</button></div>
      <div class="pr-rate-msg"></div></div>` : "";
  return head + unitNote + days + inv + sum + rateForm;
}

document.getElementById("prBody").addEventListener("click", async (e) => {
  if (e.target.closest("#prPdfBtn")) { prDownloadPdf(e.target.closest("#prPdfBtn")); return; }
  const save = e.target.closest("[data-pr-save-rate]");
  if (save) {
    const box = save.closest(".pr-rate-form"), out = box.querySelector(".pr-rate-msg");
    const raw = box.querySelector("#prRate").value.trim();
    save.disabled = true;
    const err = await savePayRate(save.dataset.prSaveRate, raw === "" ? null : Number(raw), box.querySelector("#prUnit").value);
    save.disabled = false;
    if (err) { out.innerHTML = `<div class="msg error">${escHtml(err)}</div>`; return; }
    await loadPayrollWeek(payrollWeek);
    return;
  }
  const row = e.target.closest(".pr-row");
  if (row) prToggleRow(row);
});
document.getElementById("prBody").addEventListener("keydown", (e) => {
  const row = e.target.closest(".pr-row");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); prToggleRow(row); }
});
function prToggleRow(row) {
  const detail = row.nextElementSibling, open = detail.classList.contains("hidden");
  if (open) detail.firstElementChild.innerHTML = prDetailHtml(payrollCalc.people[Number(row.dataset.i)]);
  detail.classList.toggle("hidden", !open);
  row.classList.toggle("open", open);
  row.setAttribute("aria-expanded", String(open));
}
document.getElementById("prWeek").addEventListener("change", (e) => loadPayrollWeek(e.target.value));
document.getElementById("prDate").addEventListener("change", (e) => {
  if (e.target.value) loadPayroll(ymd(weekStartOf(parseYmd(e.target.value))));
});

// ---- PDF ----
async function prDownloadPdf(btn) {
  const c = payrollCalc, week = payrollWeek;
  if (!c || !c.people.length) return;
  const withDetails = document.getElementById("prIncludeDetails").checked;
  btn.disabled = true;
  try {
    const JsPDF = await ensureJsPdf();
    const doc = new JsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
    const W = 792, H = 612, L = 40, R = W - 40;
    const company = (payrollData.company && payrollData.company.name) || (currentCompany && currentCompany.name) || "";
    let y = 0;
    const draftMark = () => {
      if (c.ready) return;
      doc.setFont("helvetica", "bold"); doc.setFontSize(90); doc.setTextColor(235, 200, 200);
      doc.text("DRAFT", W / 2, H / 2 + 30, { align: "center", angle: 20 });
      doc.setTextColor(25);
    };
    const newPage = () => { doc.addPage(); draftMark(); y = 50; };
    const need = (h) => { if (y + h > H - 46) newPage(); };
    const cell = (txt, x, opts) => doc.text(String(txt), x, y, opts);

    draftMark();
    y = 52;
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(25);
    cell("Payroll summary", L);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110);
    cell(company, R, { align: "right" });
    y += 18;
    doc.setFontSize(12); doc.setTextColor(25);
    cell(`Week of ${prWeekLabel(week)}`, L);
    doc.setFontSize(9); doc.setTextColor(110);
    cell(`Generated ${new Date().toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}${currentUserEmail ? ` by ${currentUserEmail}` : ""}`, R, { align: "right" });
    y += 22;

    // Status and totals.
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    if (c.ready) { doc.setTextColor(30, 120, 60); cell(`Ready for payroll: all ${c.people.length} approved`, L); }
    else { doc.setTextColor(170, 40, 40); cell(`DRAFT: ${c.people.filter((p) => p.status !== "approved").length} of ${c.people.length} not approved yet`, L); }
    y += 26;
    const stats = [[c.ready ? "Total to pay" : "Approved so far", money(c.total)], ["People", String(c.people.length)], ["Hours", prHours(c.hours.total), `${prHours(c.hours.ot)} OT, ${prHours(c.hours.dt)} double+`], [c.ready ? "Kit fees" : "Kit fees (approved)", money(c.kit)]];
    if (c.invoices) stats.push([c.ready ? "Contractor invoices" : "Invoices (approved)", money(c.invoices)]);
    const sw = (R - L) / stats.length;
    stats.forEach(([k, v, sub], i) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(110); doc.text(k.toUpperCase(), L + i * sw, y);
      if (sub) doc.text(sub, L + i * sw, y + 29);
      doc.setFont("helvetica", "bold"); doc.setFontSize(i === 0 ? 16 : 11); doc.setTextColor(25); doc.text(v, L + i * sw, y + (i === 0 ? 18 : 15));
    });
    y += 46;

    // Summary table.
    const cols = [["Name", L, "left"], ["Department", 180, "left"], ["Rate", 285, "left"], ["Hours", 395, "right"], ["OT", 435, "right"], ["Days", 470, "right"], ["Kit", 530, "right"], ["Invoices", 595, "right"], ["Amount", 665, "right"], ["Status", 680, "left"]];
    const header = () => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(90);
      cols.forEach(([t, x, a]) => doc.text(t, x, y, { align: a }));
      y += 5; doc.setDrawColor(200); doc.line(L, y, R, y); y += 13;
    };
    header();
    const fit = (t, w) => doc.splitTextToSize(String(t), w)[0];
    c.people.forEach((p) => {
      if (y + 16 > H - 46) { newPage(); header(); }
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(25);
      const row = [fit(p.name, 135), fit(p.department || "-", 100), prRateText(p),
        p.sheet ? prHours(p.hours.total) : "-", p.sheet && p.hours.ot + p.hours.dt + p.hours.tt ? prHours(p.hours.ot + p.hours.dt + p.hours.tt) : "-",
        p.sheet ? String(p.days.length) : "-", p.kit ? money(p.kit) : "-", p.invoices.length ? money(p.invoiceTotal) : "-",
        p.amount == null ? "-" : money(p.amount), PR_STATUS[p.status][2]];
      cols.forEach(([, x, a], i) => {
        if (i === 8) doc.setFont("helvetica", "bold");
        if (i === 9 && p.status !== "approved") doc.setTextColor(170, 40, 40);
        doc.text(row[i], x, y, { align: a });
        doc.setFont("helvetica", "normal"); doc.setTextColor(25);
      });
      y += 6; doc.setDrawColor(230); doc.line(L, y, R, y); y += 12;
    });
    need(30);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(c.ready ? "Total to pay" : "Approved total", L, y);
    doc.text(money(c.total), 665, y, { align: "right" });
    if (c.pendingTotal) { y += 13; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110); doc.text(`Not yet approved: ${money(c.pendingTotal)}`, 665, y, { align: "right" }); }
    y += 22;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(110);
    const notes = [prRulesText(c.rules), "Amounts are estimates before deductions; the payroll software calculates the final pay."];
    if (c.noRate.length) notes.unshift(`No pay rate set for ${c.noRate.map((p) => p.name).join(", ")}; not included in the total.`);
    notes.forEach((n) => doc.splitTextToSize(n, R - L).forEach((ln) => { need(12); doc.text(ln, L, y); y += 11; }));

    // One section per person with their days.
    if (withDetails) {
      const dcols = [["Day", L, "left"], ["Call", 150, "left"], ["Wrap", 210, "left"], ["Break", 300, "right"], ["Hours", 360, "right"], ["Reg", 420, "right"], ["OT", 480, "right"], ["Double+", 545, "right"], ["Kit", 575, "left"], ["Pay", R, "right"]];
      newPage();
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(25);
      doc.text("Details by person", L, y); y += 24;
      c.people.forEach((p) => {
        need(70);
        doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(25);
        doc.text(p.name, L, y);
        doc.text(p.amount == null ? "-" : money(p.amount), R, y, { align: "right" });
        y += 13;
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(110);
        doc.text([p.crew_role, p.department, p.email, prRateText(p), PR_STATUS[p.status][1]].filter(Boolean).join("  ·  "), L, y);
        y += 15;
        if (p.days.length) {
          doc.setFont("helvetica", "bold"); doc.setTextColor(90);
          dcols.forEach(([t, x, a]) => doc.text(t, x, y, { align: a }));
          y += 12;
          doc.setFont("helvetica", "normal"); doc.setTextColor(25);
          p.days.forEach((d) => {
            need(12);
            const v = [`${fmtShort(parseYmd(d.e.date))} ${String(d.e.day || "").slice(0, 3)}`, fmtTime(d.e.call) || "", fmtTime(d.e.wrap) || "", `${prNum(d.e.break_minutes)} min`,
              prHours(d.h), prHours(d.reg), d.ot ? prHours(d.ot) : "-", d.dt + d.tt ? prHours(d.dt + d.tt) : "-", d.e.kit ? "Yes" : "", d.pay == null ? "-" : money(d.pay)];
            dcols.forEach(([, x, a], i) => doc.text(v[i], x, y, { align: a }));
            y += 11;
          });
          need(12);
          doc.setFont("helvetica", "bold");
          [["Week", L, "left"], [prHours(p.hours.total), 360, "right"], [prHours(p.hours.reg), 420, "right"], [prHours(p.hours.ot), 480, "right"], [prHours(p.hours.dt + p.hours.tt), 545, "right"], [p.base == null ? "-" : money(p.base), R, "right"]]
            .forEach(([t, x, a]) => doc.text(t, x, y, { align: a }));
          doc.setFont("helvetica", "normal");
          y += 12;
        } else if (!p.invoices.length) { doc.setTextColor(170, 40, 40); doc.text("No timesheet submitted for this week.", L, y); doc.setTextColor(25); y += 12; }
        if (p.kit) { need(12); doc.text(`Kit: ${p.kitDays} day${p.kitDays === 1 ? "" : "s"} x ${money(p.sheet.kit_rate)} = ${money(p.kit)}`, L, y); y += 12; }
        p.invoices.forEach((r) => {
          const v = r.invoice || {};
          need(12); doc.text(`Invoice ${v.number || ""} (${v.date || ""}, ${r.status}): ${money(v.total)}`, L, y); y += 12;
          (v.lines || []).forEach((l) => { need(11); doc.setTextColor(110); doc.text(`   ${fit(l.desc, 400)}: ${prNum(l.qty)} x ${money(l.rate)} = ${money(l.amount)}`, L, y); y += 11; });
          doc.setTextColor(25);
        });
        y += 6; doc.setDrawColor(220); doc.line(L, y, R, y); y += 18;
      });
    }

    // Page numbers.
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
      doc.text(`${company} · Payroll week of ${week}${c.ready ? "" : " · DRAFT"}`, L, H - 24);
      doc.text(`Page ${i} of ${n}`, R, H - 24, { align: "right" });
    }
    const safe = (company || "Payroll").replace(/[^\w.-]+/g, "_");
    doc.save(`Payroll-${safe}-${week}${c.ready ? "" : "-DRAFT"}.pdf`);
  } catch (err) {
    showToast("rejected", "Couldn't make the PDF", err.message || String(err));
  } finally {
    btn.disabled = false;
  }
}

// ---- Overtime rules (Company Settings, admins) ----
const PR_RULE_FIELDS = ["ot_daily_after", "dt_daily_after", "ot_weekly_after", "ot_multiplier", "dt_multiplier"];
async function loadPayrollRules() {
  const msg = document.getElementById("prRulesMsg");
  const { data, error } = await client.from("companies").select(PR_RULE_FIELDS.join(", ")).eq("id", currentCompany.id).maybeSingle();
  if (error || !data) { msg.innerHTML = `<div class="msg error">Payroll rules aren't set up on this database yet.</div>`; return; }
  PR_RULE_FIELDS.forEach((f) => { document.getElementById("pr_" + f).value = data[f] == null ? "" : data[f]; });
}
document.getElementById("prRulesSave").addEventListener("click", async () => {
  const msg = document.getElementById("prRulesMsg"), patch = {};
  for (const f of PR_RULE_FIELDS) {
    const raw = document.getElementById("pr_" + f).value.trim();
    const v = raw === "" ? null : Number(raw);
    if (v != null && !(v > 0)) { msg.innerHTML = `<div class="msg error">Use positive numbers, or leave a limit empty to turn it off.</div>`; return; }
    if (/multiplier/.test(f) && (v == null || v < 1)) { msg.innerHTML = `<div class="msg error">Multipliers must be 1 or more.</div>`; return; }
    patch[f] = v;
  }
  const { error } = await client.from("companies").update(patch).eq("id", currentCompany.id);
  msg.innerHTML = error ? `<div class="msg error">${escHtml(error.message)}</div>` : `<div class="msg ok">Overtime rules saved.</div>`;
  if (!error && payrollWeek) loadPayrollWeek(payrollWeek);
});
