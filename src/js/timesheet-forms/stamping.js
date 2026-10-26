// ----- Filling a form from a submitted timesheet -----
function tsLong(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function tsFieldValue(f, d) {
  const b = f.bind || "";
  const dm = /^d(\d)\.(\w+)$/.exec(b);
  if (dm) {
    const i = Number(dm[1]), col = dm[2];
    const date = addDays(parseYmd(d.weekStart), i);
    const e = (d.entries || []).find((en) => en.date === ymd(date));
    if (col === "date") return { text: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
    if (col === "day") return { text: DAY_NAMES[i] };
    if (!e) return {};
    if (col === "call" || col === "wrap" || /^meal[12]_(in|out)$/.test(col)) return e[col] ? { text: fmtTime(e[col]) } : {};
    if (col === "break") return e.break_minutes ? { text: String(e.break_minutes) } : {};
    if (col === "hours") return { text: fmtHours(e.minutes) };
    if (col === "kit") return e.kit ? { check: true } : {};
    if (col === "ot15" || col === "ot2" || col === "ot3") return e[col] ? { text: String(e[col]) } : {};
    return {};
  }
  const fv = d.formValues || {};
  switch (b) {
    case "name": return { text: d.name || d.email || "" };
    case "email": return { text: d.email || "" };
    case "position": return { text: fv._position || "" };
    case "department": return { text: d.department || "" };
    case "company": return { text: d.company || "" };
    case "week_start": return { text: tsLong(parseYmd(d.weekStart)) };
    case "week_end": return { text: tsLong(addDays(parseYmd(d.weekStart), 6)) };
    case "total_hours": return { text: fmtHours(d.totalMinutes || 0) };
    case "kit_days": return { text: String(d.kitDays || 0) };
    case "kit_total": return { text: "$" + ((d.kitDays || 0) * (d.kitRate || 0)).toFixed(2) };
    case "signature": return d.signature ? { sig: d.signature } : {};
    case "signed_date": return { text: tsLong(new Date(d.submittedAt || Date.now())) };
    case "fixed": return { text: f.value || "" };
    case "free": return fv[f.id] ? { text: String(fv[f.id]) } : {};
    case "free_check": return fv[f.id] ? { check: true } : {};
    default: return {};
  }
}

async function stampTimesheetForm(template, bytes, d) {
  const L = await ensurePdfLib();
  const doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true });
  try { doc.getForm().flatten(); } catch (_) { /* no fillable boxes to flatten */ }
  const font = await doc.embedFont(L.StandardFonts.Helvetica);
  const pages = doc.getPages();
  const ink = L.rgb(0.114, 0.141, 0.2);
  let sigImg = null, sigDims = null;
  for (const f of template.fields || []) {
    const pg = pages[f.page];
    if (!pg) continue;
    const v = tsFieldValue(f, d);
    if (!v.text && !v.check && !v.sig) continue;
    const { width: W, height: H } = pg.getSize();
    const bx = f.x * W, bw = f.w * W, bh = f.h * H, by = H - f.y * H - bh;
    if (v.text) {
      const text = String(v.text).replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
      let size = clamp(bh * 0.62, 6, 11);
      while (size > 5 && font.widthOfTextAtSize(text, size) > bw - 3) size -= 0.5;
      pg.drawText(text, { x: bx + 2, y: by + (bh - size) / 2 + size * 0.2, size, font, color: ink });
    } else if (v.check) {
      const m = Math.min(bw, bh) * 0.2, opt = { thickness: 1.4, color: ink };
      pg.drawLine({ start: { x: bx + m, y: by + m }, end: { x: bx + bw - m, y: by + bh - m }, ...opt });
      pg.drawLine({ start: { x: bx + m, y: by + bh - m }, end: { x: bx + bw - m, y: by + m }, ...opt });
    } else if (v.sig) {
      if (!sigImg) { const png = await signaturePng(v.sig); sigImg = await doc.embedPng(png.bytes); sigDims = png; }
      const k = Math.min(bw / sigDims.w, bh / sigDims.h);
      pg.drawImage(sigImg, { x: bx + 2, y: by + (bh - sigDims.h * k) / 2, width: sigDims.w * k, height: sigDims.h * k });
    }
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}

const tsTplCache = new Map();
async function getTsTemplateWithBytes(id) {
  if (!tsTplCache.has(id)) {
    const { data, error } = await client.from("timesheet_templates").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    try { tsTplCache.set(id, { template: data, bytes: new Uint8Array(await loadTemplatePdfBytes(data.source_pdf_path)) }); }
    catch (_) { return null; }
  }
  return tsTplCache.get(id);
}
