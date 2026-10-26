// ---- Solo contractor invoices (replaces the timesheet module) ----
let invLines = [];
function applyWorkerType() {
  const p = document.getElementById("invoicePanel"), t = document.getElementById("tsPanel");
  if (!p || !t) return;
  p.classList.toggle("hidden", !myIsContractor);
  t.classList.toggle("hidden", myIsContractor);
  const lab = document.getElementById("pvTimeLabel");
  if (lab) lab.textContent = myIsContractor ? "Invoices" : "Timesheets";
  if (myIsContractor) { renderInvoiceForm(); if (!applyWorkerType.done) { applyWorkerType.done = true; loadList("timesheets", "timesheets", true); } }
}
function invCalc() {
  const sub = invLines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const taxPct = Number((document.getElementById("invTax") || {}).value) || 0;
  const tax = Math.round(sub * taxPct) / 100;
  return { sub: Math.round(sub * 100) / 100, taxPct, tax, total: Math.round((sub + tax) * 100) / 100 };
}
function invUpdateTotals() {
  const c = invCalc(), el = document.getElementById("invTotals"); if (!el) return;
  el.innerHTML = `<div><span>Subtotal</span><strong>${money(c.sub)}</strong></div>${c.taxPct ? `<div><span>Tax (${c.taxPct}%)</span><strong>${money(c.tax)}</strong></div>` : ""}<div class="inv-grand"><span>Total due</span><strong>${money(c.total)}</strong></div>`;
  invLines.forEach((l, i) => { const a = document.getElementById("invAmt" + i); if (a) a.textContent = money((Number(l.qty) || 0) * (Number(l.rate) || 0)); });
}
function renderInvoiceForm() {
  const box = document.getElementById("invForm"); if (!box) return;
  const keep = (id) => { const e = document.getElementById(id); return e ? e.value : null; };
  const v = { num: keep("invNum"), date: keep("invDate"), period: keep("invPeriod"), tax: keep("invTax"), taxno: keep("invTaxNo"), notes: keep("invNotes") };
  if (!invLines.length) invLines = [{ desc: "", qty: 1, rate: "" }];
  const next = "INV-" + String(myTimesheetRows.filter((r) => invoiceOf(r)).length + 1).padStart(3, "0");
  box.innerHTML = `
    <div class="inv-grid">
      <div><label for="invNum">Invoice #</label><input type="text" id="invNum" value="${escHtml(v.num != null ? v.num : next)}" /></div>
      <div><label for="invDate">Invoice date</label><input type="date" id="invDate" value="${escHtml(v.date || ymd(new Date()))}" /></div>
      <div class="inv-wide"><label for="invPeriod">Work period / project</label><input type="text" id="invPeriod" placeholder="e.g. Oct 6 – Oct 17, 2026 · Episode 3" value="${escHtml(v.period || "")}" /></div>
    </div>
    <div class="inv-lines">
      <div class="inv-lh"><span>Description</span><span>Qty</span><span>Rate</span><span>Amount</span><span></span></div>
      ${invLines.map((l, i) => `<div class="inv-line">
        <input type="text" data-i="${i}" data-k="desc" placeholder="Services rendered" value="${escHtml(l.desc)}" aria-label="Description" />
        <input type="number" data-i="${i}" data-k="qty" min="0" step="0.25" inputmode="decimal" value="${escHtml(l.qty)}" aria-label="Quantity" />
        <input type="number" data-i="${i}" data-k="rate" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${escHtml(l.rate)}" aria-label="Rate" />
        <span class="inv-amt" id="invAmt${i}">$0.00</span>
        <button type="button" class="remove-link" data-del="${i}" ${invLines.length < 2 ? "disabled" : ""} aria-label="Remove line">✕</button>
      </div>`).join("")}
      <button type="button" class="btn-secondary" id="invAddLine" style="width:auto;margin-top:8px;">+ Add line</button>
    </div>
    <div class="inv-grid">
      <div><label for="invTax">Tax % (GST/HST, optional)</label><input type="number" id="invTax" min="0" max="30" step="0.01" inputmode="decimal" placeholder="0" value="${escHtml(v.tax || "")}" /></div>
      <div><label for="invTaxNo">Tax registration # (optional)</label><input type="text" id="invTaxNo" value="${escHtml(v.taxno || "")}" /></div>
      <div class="inv-wide"><label for="invNotes">Notes / payment details (optional)</label><textarea id="invNotes" rows="2" placeholder="e.g. e-Transfer to … / payment terms">${escHtml(v.notes || "")}</textarea></div>
    </div>
    <div class="inv-totals" id="invTotals"></div>
    <button class="btn-primary" id="invSubmitBtn" type="button">Submit invoice</button>`;
  box.querySelectorAll(".inv-line input").forEach((inp) => inp.addEventListener("input", () => { invLines[Number(inp.dataset.i)][inp.dataset.k] = inp.value; invUpdateTotals(); }));
  box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { invLines.splice(Number(b.dataset.del), 1); renderInvoiceForm(); }));
  document.getElementById("invAddLine").addEventListener("click", () => { invLines.push({ desc: "", qty: 1, rate: "" }); renderInvoiceForm(); });
  document.getElementById("invTax").addEventListener("input", invUpdateTotals);
  document.getElementById("invSubmitBtn").addEventListener("click", submitInvoice);
  invUpdateTotals();
}
async function buildInvoicePdf(inv) {
  const JsPDF = await ensureJsPdf();
  const doc = new JsPDF({ unit: "pt", format: "letter" });
  const L = 54, R = 558;
  let y = 66;
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(25); doc.text("INVOICE", L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90);
  doc.text(`Invoice #: ${inv.number}`, R, y - 10, { align: "right" });
  doc.text(`Date: ${inv.date}`, R, y + 4, { align: "right" });
  y += 36;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text("FROM", L, y); doc.text("BILL TO", 320, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(25);
  let yy = y + 16;
  [inv.name, inv.email, inv.taxNo ? `Tax reg. #: ${inv.taxNo}` : ""].filter(Boolean).forEach((t) => { doc.text(String(t), L, yy); yy += 14; });
  doc.text(inv.company || "", 320, y + 16);
  y = Math.max(yy, y + 32) + 12;
  if (inv.period) { doc.setFontSize(10); doc.setTextColor(90); doc.text(`Work period / project: ${inv.period}`, L, y); y += 18; }
  doc.setDrawColor(200); doc.line(L, y, R, y); y += 16;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text("DESCRIPTION", L, y); doc.text("QTY", 380, y, { align: "right" }); doc.text("RATE", 460, y, { align: "right" }); doc.text("AMOUNT", R, y, { align: "right" });
  y += 8; doc.line(L, y, R, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(25);
  for (const l of inv.lines) {
    const wrapped = doc.splitTextToSize(l.desc || "-", 290);
    if (y + wrapped.length * 14 > 700) { doc.addPage(); y = 66; }
    doc.text(wrapped, L, y);
    doc.text(String(l.qty), 380, y, { align: "right" });
    doc.text(money(l.rate), 460, y, { align: "right" });
    doc.text(money(l.amount), R, y, { align: "right" });
    y += wrapped.length * 14 + 6;
  }
  y += 4; doc.line(320, y, R, y); y += 18;
  const row = (k, val, bold) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 13 : 11); doc.text(k, 330, y); doc.text(val, R, y, { align: "right" }); y += bold ? 20 : 16; };
  row("Subtotal", money(inv.subtotal));
  if (inv.taxPct) row(`Tax (${inv.taxPct}%)`, money(inv.tax));
  row("Total due", money(inv.total), true);
  if (inv.notes) {
    y += 12; doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120); doc.text("NOTES / PAYMENT DETAILS", L, y); y += 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(25); doc.text(doc.splitTextToSize(inv.notes, R - L), L, y);
  }
  return doc.output("blob");
}
async function submitInvoice() {
  const msgEl = document.getElementById("invoicesMsg"), btn = document.getElementById("invSubmitBtn");
  const number = document.getElementById("invNum").value.trim(), date = document.getElementById("invDate").value;
  const lines = invLines.filter((l) => (l.desc || "").trim() || Number(l.rate)).map((l) => ({ desc: (l.desc || "").trim(), qty: Number(l.qty) || 0, rate: Number(l.rate) || 0, amount: Math.round((Number(l.qty) || 0) * (Number(l.rate) || 0) * 100) / 100 }));
  if (!number || !date) { msgEl.innerHTML = `<div class="msg error">Add an invoice number and date.</div>`; return; }
  if (!lines.length || lines.some((l) => !l.desc || l.qty <= 0 || l.rate <= 0)) { msgEl.innerHTML = `<div class="msg error">Every line needs a description, a quantity and a rate.</div>`; return; }
  if (myTimesheetRows.some((r) => invoiceOf(r) && invoiceOf(r).number === number && r.status !== "rejected")) { msgEl.innerHTML = `<div class="msg error">You've already submitted invoice ${escHtml(number)}.</div>`; return; }
  const c = invCalc();
  btn.disabled = true; msgEl.innerHTML = `<div class="msg">Creating your invoice…</div>`;
  let path = null;
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("You're signed out. Sign in again and retry.");
    const inv = { number, date, period: document.getElementById("invPeriod").value.trim(), lines, subtotal: c.sub, taxPct: c.taxPct, tax: c.tax, total: c.total,
      taxNo: document.getElementById("invTaxNo").value.trim(), notes: document.getElementById("invNotes").value.trim(),
      name: myFullName || user.email, email: user.email, company: (currentCompany && currentCompany.name) || "" };
    const pdf = await buildInvoicePdf(inv);
    path = `${user.id}/${Date.now()}-Invoice-${number.replace(/[^\w.-]+/g, "_")}.pdf`;
    const { error: upErr } = await client.storage.from("timesheets").upload(path, pdf, { contentType: "application/pdf" });
    if (upErr) throw upErr;
    const { error: insErr } = await client.from("timesheets").insert({ user_id: user.id, status: "pending", file_path: path, entries: { invoice: inv } });
    if (insErr) { await client.storage.from("timesheets").remove([path]); throw insErr; }
    msgEl.innerHTML = `<div class="msg ok">Invoice ${escHtml(number)} submitted (${money(c.total)}).</div>`;
    invLines = [];
    ["invNum", "invPeriod", "invNotes"].forEach((id) => { const e = document.getElementById(id); if (e) e.value = ""; });
    await loadList("timesheets", "timesheets", true);
    renderInvoiceForm();
  } catch (err) {
    msgEl.innerHTML = `<div class="msg error">Couldn't submit: ${escHtml((err && err.message) || String(err))}</div>`;
  } finally { btn.disabled = false; }
}
