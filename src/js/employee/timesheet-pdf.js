// jsPDF is loaded from a CDN the first time someone submits a timesheet.
let jsPdfReady = null;
function ensureJsPdf() {
  if (jsPdfReady) return jsPdfReady;
  jsPdfReady = new Promise((resolve, reject) => {
    if (window.jspdf && window.jspdf.jsPDF) { resolve(window.jspdf.jsPDF); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = () => { jsPdfReady = null; reject(new Error("Couldn't load the PDF library. Check your connection and try again.")); };
    document.head.appendChild(script);
  });
  return jsPdfReady;
}

async function buildTimesheetPdf({ entries, totalMinutes, weekStart, email, name, department, companyName, kitDays, kitRate, submittedAt }) {
  const JsPDF = await ensureJsPdf();
  const doc = new JsPDF({ unit: "pt", format: "letter" });
  const L = 54, R = 558;
  let y = 66;

  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(25);
  doc.text("Weekly Timesheet", L, y);
  if (companyName) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110);
    doc.text(companyName, R, y, { align: "right" });
  }
  y += 28;

  const s = parseYmd(weekStart), e = addDays(s, 6);
  const full = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const meta = [
    ["Employee", name || email],
    ["Email", email],
    ["Department", department || "-"],
    ["Pay period", `${full(s)} to ${full(e)}`],
  ];
  doc.setFontSize(11); doc.setTextColor(25);
  meta.forEach(([k, v]) => {
    doc.setFont("helvetica", "bold"); doc.text(k, L, y);
    doc.setFont("helvetica", "normal"); doc.text(String(v), L + 90, y);
    y += 18;
  });
  y += 14;

  const cx = [L, L + 88, L + 170, L + 250, L + 330];
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(110);
  ["DAY", "DATE", "CALL", "WRAP", "BREAK"].forEach((h, i) => doc.text(h, cx[i], y));
  doc.text("HOURS", R, y, { align: "right" });
  y += 6; doc.setDrawColor(190); doc.line(L, y, R, y); y += 18;

  doc.setFontSize(11); doc.setTextColor(25);
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i);
    const entry = entries.find((en) => en.date === ymd(d));
    doc.setFont("helvetica", "normal");
    doc.text(DAY_NAMES[i], cx[0], y);
    doc.text(fmtShort(d), cx[1], y);
    doc.text(entry ? fmtTime(entry.call) : "-", cx[2], y);
    doc.text(entry ? fmtTime(entry.wrap) : "-", cx[3], y);
    doc.text(entry ? (entry.break_minutes ? `${entry.break_minutes} min` : "none") : "-", cx[4], y);
    doc.text(entry ? fmtHours(entry.minutes) + (entry.kit ? "  (kit)" : "") : "-", R, y, { align: "right" });
    if (entry && (entry.ot15 || entry.ot2 || entry.ot3)) {
      y += 11; doc.setFontSize(8.5); doc.setTextColor(110);
      doc.text("Overtime: " + [["ot15", "1.5X"], ["ot2", "2X"], ["ot3", "3X"]].filter(([k]) => entry[k]).map(([k, l]) => `${l} ${entry[k]} h`).join(", "), cx[2], y);
      doc.setFontSize(11); doc.setTextColor(25);
      y += 11;
    } else y += 22;
    doc.setDrawColor(228); doc.line(L, y - 15, R, y - 15);
  }
  y += 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("Total hours", cx[3], y);
  doc.text(fmtHours(totalMinutes), R, y, { align: "right" });
  if (kitDays) {
    y += 20;
    doc.text("Kit fee", cx[3], y);
    doc.text(`${kitDays} day${kitDays === 1 ? "" : "s"} x $${kitRate.toFixed(2)} = $${(kitDays * kitRate).toFixed(2)}`, R, y, { align: "right" });
  }

  y += 44;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`Submitted through the crew portal on ${new Date(submittedAt || Date.now()).toLocaleString("en-US")}.`, L, y);
  doc.text("Hours are call to wrap less unpaid break. A wrap earlier than call is counted as the following morning.", L, y + 13);
  return doc.output("blob");
}

// Rebuilds a submitted timesheet's PDF from the data saved with it, so it
// is always available to reviewers even if the stored file is missing.
async function timesheetRowPdf(row) {
  const entries = Array.isArray(row.entries) ? row.entries : [];
  if (row.template_id) {
    const t = await getTsTemplateWithBytes(row.template_id);
    if (t) {
      return stampTimesheetForm(t.template, t.bytes, {
        entries, totalMinutes: entries.reduce((sum, en) => sum + (Number(en.minutes) || 0), 0),
        weekStart: row.week_start, email: row.employee_email || profileMap.get(row.user_id) || "",
        name: row.employee_name, department: row.department,
        company: (currentCompany && currentCompany.name) || "",
        kitDays: Number(row.kit_days) || 0, kitRate: Number(row.kit_rate) || 0,
        formValues: row.form_values || {}, signature: row.signature, submittedAt: row.created_at,
      });
    }
  }
  return buildTimesheetPdf({
    entries,
    totalMinutes: entries.reduce((sum, en) => sum + (Number(en.minutes) || 0), 0),
    weekStart: row.week_start,
    email: row.employee_email || profileMap.get(row.user_id) || "",
    name: row.employee_name, department: row.department,
    companyName: (currentCompany && currentCompany.name) || "",
    kitDays: Number(row.kit_days) || 0, kitRate: Number(row.kit_rate) || 0,
    submittedAt: row.created_at,
  });
}
function timesheetPdfName(row) {
  const who = (row.employee_name || row.employee_email || profileMap.get(row.user_id) || "employee").replace(/[^\w.-]+/g, "_");
  return `Timesheet-${who}-${row.week_start}.pdf`;
}
async function previewTimesheetRow(row) {
  try {
    const blob = await timesheetRowPdf(row);
    openPreview(URL.createObjectURL(blob), timesheetPdfName(row));
  } catch (err) { window.alert("Couldn't build the timesheet PDF: " + (err.message || err)); }
}
async function downloadTimesheetRow(row) {
  try {
    const blob = await timesheetRowPdf(row);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = timesheetPdfName(row);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) { window.alert("Couldn't build the timesheet PDF: " + (err.message || err)); }
}

document.getElementById("tsPeriodSelect").addEventListener("change", renderTimesheetGrid);
window.addEventListener("focus", () => { if (currentUserId) buildPeriodOptions(); });

document.getElementById("tsSubmitBtn").addEventListener("click", async () => {
  const msgEl = document.getElementById("timesheetsMsg");
  const btn = document.getElementById("tsSubmitBtn");
  const week = tsGridWeek;
  if (!week) { msgEl.innerHTML = `<div class="msg error">Pick a pay period first.</div>`; return; }
  if (myTimesheetRows.some((r) => r.week_start === week && r.status !== "rejected")) {
    msgEl.innerHTML = `<div class="msg error">You've already submitted this pay period.</div>`;
    return;
  }
  const form = readTimesheetForm();
  if (form.error) { msgEl.innerHTML = `<div class="msg error">${form.error}</div>`; return; }
  const extras = readTsExtras();
  if (extras.error) { msgEl.innerHTML = `<div class="msg error">${escHtml(extras.error)}</div>`; return; }

  btn.disabled = true;
  msgEl.innerHTML = `<div class="msg">Creating your timesheet…</div>`;
  let uploadedPath = null;
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("You're signed out. Sign in again and retry.");

    let pdf;
    if (myTsTemplate) {
      const t = await getTsTemplateWithBytes(myTsTemplate.id);
      if (!t) throw new Error("Couldn't load your timesheet form. Try again in a moment.");
      pdf = await stampTimesheetForm(t.template, t.bytes, {
        entries: form.entries, totalMinutes: form.totalMinutes, weekStart: week,
        email: user.email, name: myFullName, department: myDepartment,
        company: (currentCompany && currentCompany.name) || "",
        kitDays: myKitEnabled ? form.kitDays : 0, kitRate: myKitRate,
        formValues: extras.formValues, signature: extras.signature, submittedAt: Date.now(),
      });
    } else {
      pdf = await buildTimesheetPdf({
        entries: form.entries, totalMinutes: form.totalMinutes, weekStart: week,
        email: user.email, name: myFullName, department: myDepartment,
        companyName: (currentCompany && currentCompany.name) || "",
        kitDays: myKitEnabled ? form.kitDays : 0, kitRate: myKitRate,
      });
    }

    // A rejected submission for the same week is replaced by this one.
    for (const old of myTimesheetRows.filter((r) => r.week_start === week && r.status === "rejected")) {
      await client.storage.from("timesheets").remove([old.file_path]);
      await client.from("timesheets").delete().eq("id", old.id);
    }

    uploadedPath = `${user.id}/${Date.now()}-Timesheet-${week}.pdf`;
    const { error: upErr } = await client.storage.from("timesheets").upload(uploadedPath, pdf, { contentType: "application/pdf" });
    if (upErr) throw upErr;

    const tsRow = {
      user_id: user.id, status: "pending", file_path: uploadedPath,
      week_start: week, entries: form.entries,
      total_hours: Math.round((form.totalMinutes / 60) * 100) / 100,
      kit_days: myKitEnabled ? form.kitDays : 0,   // rate and total are stamped server-side from the invite
    };
    if (myTsTemplate) { tsRow.template_id = myTsTemplate.id; tsRow.form_values = extras.formValues; tsRow.signature = extras.signature; }
    const { error: insErr } = await client.from("timesheets").insert(tsRow);
    if (insErr) {
      await client.storage.from("timesheets").remove([uploadedPath]);
      throw insErr;
    }

    msgEl.innerHTML = `<div class="msg ok">Timesheet for ${periodLabel(week)} submitted (${fmtHours(form.totalMinutes)} hours).</div>`;
    tsGridWeek = null;
    await loadList("timesheets", "timesheets", true);
  } catch (err) {
    const text = err && err.code === "23505"
      ? "You've already submitted this pay period."
      : `Couldn't submit: ${(err && err.message) || err}`;
    msgEl.innerHTML = `<div class="msg error">${escHtml(text)}</div>`;
  } finally {
    btn.disabled = false;
  }
});
