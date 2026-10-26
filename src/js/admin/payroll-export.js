// ---- Payroll export: days worked and hours per pay period ----
(function () {
  const $ = (id) => document.getElementById(id);
  let lastCsv = null, lastName = "payroll.csv";
  const num = (v) => Number(v) || 0;
  const csvCell = (v) => {
    let t = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t) && isNaN(Number(t))) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const addDaysStr = (str, n) => { const d = new Date(str + "T00:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const worked = (rows) => rows.flatMap((r) => (Array.isArray(r.entries) ? r.entries : []).filter((e) => num(e.minutes) > 0).map((e) => ({ r, e })));

  function build(rows, group, show) {
    const who = (r) => r.employee_name || r.employee_email || profileMap.get(r.user_id) || "";
    const mail = (r) => r.employee_email || profileMap.get(r.user_id) || "";
    let head, body;
    const dayHours = (show === "both" || show === "hours");
    const dayDays = (show === "both" || show === "days");
    if (group === "day") {
      head = ["Employee", "Email", "Department", "Date", "Day", "Call", "Wrap", "Break (min)", "Hours", "Kit"];
      body = worked(rows).map(({ r, e }) => [who(r), mail(r), r.department || "", e.date || "", e.day || "", e.call || "", e.wrap || "", num(e.break_minutes), (num(e.minutes) / 60).toFixed(2), e.kit ? "Yes" : ""])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])));
      const tot = body.reduce((t, r) => t + Number(r[8]), 0);
      body.push(["TOTAL", "", "", body.length + " days", "", "", "", "", tot.toFixed(2), ""]);
      return { head, body, tot: { days: body.length - 1, hours: tot } };
    }
    const stat = (r) => { const w = worked([r]); return { days: w.length, hours: w.reduce((t, x) => t + num(x.e.minutes), 0) / 60 }; };
    const cols = (st, kitDays, kitTotal) => [...(dayDays ? [st.days] : []), ...(dayHours ? [st.hours.toFixed(2)] : []), kitDays, kitTotal.toFixed(2)];
    const colHead = [...(dayDays ? ["Days worked"] : []), ...(dayHours ? ["Hours"] : []), "Kit days", "Kit total ($)"];
    if (group === "week") {
      head = ["Employee", "Email", "Department", "Week starting", "Week ending", ...colHead, "Status"];
      body = rows.map((r) => [who(r), mail(r), r.department || "", r.week_start || "", r.week_start ? addDaysStr(r.week_start, 6) : "", ...cols(stat(r), num(r.kit_days), num(r.kit_days) * num(r.kit_rate)), r.status || ""])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])));
    } else {
      const m = new Map();
      rows.forEach((r) => {
        const k = (mail(r) || who(r)).toLowerCase();
        const o = m.get(k) || { name: who(r), email: mail(r), dept: r.department || "", weeks: 0, days: 0, hours: 0, kd: 0, kt: 0 };
        const st = stat(r);
        o.weeks++; o.days += st.days; o.hours += st.hours; o.kd += num(r.kit_days); o.kt += num(r.kit_days) * num(r.kit_rate);
        if (!o.name) o.name = who(r);
        m.set(k, o);
      });
      head = ["Employee", "Email", "Department", "Weeks", ...colHead];
      body = [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((o) => [o.name, o.email, o.dept, o.weeks, ...cols({ days: o.days, hours: o.hours }, o.kd, o.kt)]);
    }
    const sum = rows.reduce((t, r) => { const st = stat(r); t.days += st.days; t.hours += st.hours; t.kd += num(r.kit_days); t.kt += num(r.kit_days) * num(r.kit_rate); return t; }, { days: 0, hours: 0, kd: 0, kt: 0 });
    const lead = head.length - colHead.length - (group === "week" ? 1 : 0);
    body.push(["TOTAL", ...Array(lead - 1).fill(""), ...cols(sum, sum.kd, sum.kt), ...(group === "week" ? [""] : [])]);
    return { head, body, tot: sum };
  }

  $("pxRun").addEventListener("click", async () => {
    const msg = $("pxMsg"), wrap = $("pxTableWrap"), btn = $("pxRun");
    const from = $("pxFrom").value, to = $("pxTo").value, status = $("pxStatus").value, group = $("pxGroup").value, show = $("pxShow").value;
    btn.disabled = true; msg.innerHTML = `<div class="msg ok">Loading…</div>`; wrap.innerHTML = ""; $("pxDownload").disabled = true;
    let q = client.from("timesheets").select("*").order("week_start", { ascending: true });
    if (from) q = q.gte("week_start", from);
    if (to) q = q.lte("week_start", to);
    if (status !== "all") q = q.eq("status", status); else q = q.in("status", ["pending", "approved", "rejected"]);
    const { data, error } = await q;
    btn.disabled = false;
    if (error) { msg.innerHTML = `<div class="msg error">${escHtml(error.message)}</div>`; return; }
    const rows = data || [];
    if (!rows.length) { msg.innerHTML = `<div class="msg ok">No timesheets match those filters.</div>`; return; }
    const { head, body } = build(rows, group, show);
    msg.innerHTML = `<div class="msg ok">${rows.length} timesheet${rows.length === 1 ? "" : "s"} included.</div>`;
    const th = head.map((h) => `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;">${escHtml(h)}</th>`).join("");
    const tr = body.map((r, i) => `<tr${i === body.length - 1 ? ' style="font-weight:600;"' : ""}>${r.map((c) => `<td style="padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;">${escHtml(String(c))}</td>`).join("")}</tr>`).join("");
    wrap.innerHTML = `<table style="border-collapse:collapse;font-size:13px;width:100%;"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
    lastCsv = "\uFEFF" + [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const co = ((currentCompany && currentCompany.name) || "payroll").replace(/[^\w.-]+/g, "_");
    lastName = `Payroll-${co}-${from || "start"}-to-${to || "latest"}.csv`;
    $("pxDownload").disabled = false;
  });
  $("pxGroup").addEventListener("change", () => { $("pxShow").disabled = $("pxGroup").value === "day"; });
  $("pxDownload").addEventListener("click", () => {
    if (!lastCsv) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lastCsv], { type: "text/csv;charset=utf-8" }));
    a.download = lastName; document.body.appendChild(a); a.click(); a.remove();
  });
})();
