// ---- Timesheet forms: read a union's blank timesheet and propose the boxes ----
// A form's fields each carry a "bind": what the portal fills in there
// (e.g. d1.call = Monday's call time, name, total_hours), or "free" for
// things the employee types themselves (member number), or "fixed" for
// text the admin sets once (production title).
const TS_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TS_DAY_RE = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?$/i;
const TS_DAY_COLS = [
  ["date", "date"], ["day", "day name"], ["call", "call"], ["wrap", "wrap"],
  ["meal1_out", "meal 1 out"], ["meal1_in", "meal 1 in"], ["meal2_out", "meal 2 out"], ["meal2_in", "meal 2 in"],
  ["break", "unpaid break (min)"], ["hours", "hours"], ["ot15", "1.5X overtime hrs"], ["ot2", "2X overtime hrs"], ["ot3", "3X overtime hrs"], ["kit", "kit fee tick"],
];
const TS_BIND_GROUPS = [
  { label: "Employee", items: [["name", "Employee name"], ["email", "Email"], ["position", "Position / classification"], ["department", "Department"], ["company", "Company"]] },
  { label: "Pay period", items: [["week_start", "Week start date"], ["week_end", "Week ending date"]] },
  { label: "Totals", items: [["total_hours", "Total hours"], ["kit_days", "Kit days"], ["kit_total", "Kit total ($)"]] },
  { label: "Sign-off", items: [["signature", "Employee signature"], ["signed_date", "Date signed"]] },
  { label: "Other", items: [["free", "Employee types this (e.g. member #)"], ["free_check", "Employee ticks this"], ["fixed", "Fixed text (same for everyone)"]] },
];
const TS_BIND_LABEL = {};
TS_BIND_GROUPS.forEach((g) => g.items.forEach(([k, v]) => { TS_BIND_LABEL[k] = v; }));

function tsBindCaption(f) {
  const m = /^d(\d)\.(\w+)$/.exec(f.bind || "");
  if (m) {
    const col = TS_DAY_COLS.find((c) => c[0] === m[2]);
    return `${DAY_NAMES[Number(m[1])].slice(0, 3)} ${col ? col[1] : m[2]}`;
  }
  if (f.bind === "free") return f.label || "Employee types";
  if (f.bind === "fixed") return f.value || f.label || "Fixed text";
  return TS_BIND_LABEL[f.bind] || f.bind || "?";
}
function tsFieldType(bind) {
  if (bind === "signature") return "signature";
  if (bind === "free_check" || /^d\d\.kit$/.test(bind || "")) return "checkbox";
  return "text";
}
function tsBindOptionsHtml(selected) {
  const opt = (k, label) => `<option value="${k}"${k === selected ? " selected" : ""}>${escHtml(label)}</option>`;
  let html = TS_BIND_GROUPS.map((g) => `<optgroup label="${g.label}">${g.items.map(([k, v]) => opt(k, v)).join("")}</optgroup>`).join("");
  for (let i = 0; i < 7; i++) {
    html += `<optgroup label="${DAY_NAMES[i]}">${TS_DAY_COLS.map(([k, v]) => opt(`d${i}.${k}`, `${DAY_NAMES[i].slice(0, 3)} ${v}`)).join("")}</optgroup>`;
  }
  return html;
}

function tsClassifyColumn(text) {
  const s = String(text).toLowerCase().replace(/[^a-z0-9 \/]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/(meal|lunch|dinner)/.test(s)) {
    const key = /(2nd|second|meal 2|meal2|lunch 2)/.test(s) ? "meal2" : "meal1";
    if (/\b(out|start|off|begin|from)\b/.test(s)) return key + "_out";
    if (/\b(in|end|on|back|finish)\b/.test(s)) return key + "_in";
    return null;
  }
  if (s === "date") return "date";
  if (/(kit|box rental)/.test(s)) return "kit";
  if (/(total|hours|hrs)/.test(s)) return "hours";
  if (/^(break|breaks|unpaid|unpaid break)/.test(s)) return "break";
  if (/^(call|crew call|report|start|time in|in time|in|time on)$/.test(s)) return "call";
  if (/^(wrap|wrap time|out|end|finish|release|time out|out time|time off)$/.test(s)) return "wrap";
  return null;
}

// [pattern, bind, ignore-if-matches]
const TS_LABEL_RULES = [
  [/signature|signed by|sign here/i, "signature", /supervisor|manager|producer|upm|approv|head|coordinator|department|dept|authoriz|accountant/i],
  [/^(production|show|series|film|project)\b/i, "fixed"],
  [/(week|period)\s*(ending|end)|w\/e|^ending/i, "week_end"],
  [/(week|period)\s*(of|start|beginning|commenc)/i, "week_start"],
  [/(position|classification|job\s*title|occupation|crew\s*position)/i, "position"],
  [/department|dept/i, "department"],
  [/(member|permit|local|union|licen[sc]e)\s*(#|no\.?|number|num)?/i, "free"],
  [/^(employee\s*)?name\b|full\s*name|^name\b/i, "name"],
  [/^e-?mail/i, "email"],
];
function tsGuessLabelBind(text) {
  for (const [re, bind, ignore] of TS_LABEL_RULES) {
    if (re.test(text)) { if (ignore && ignore.test(text)) return { skip: true }; return { bind }; }
  }
  return null;
}

// Text on a page as phrases (nearby words on one line merged), positions as page fractions.
async function tsPagePhrases(page, opts) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const raw = [];
  tc.items.forEach((it) => {
    const s = String(it.str || "").replace(/\s+/g, " ");
    if (!s.trim()) return;
    // Skip watermarks and other turned or oversized text: it isn't a label and its box would cover real blanks.
    const tr = it.transform;
    if (Math.abs(tr[1]) > 0.15 * Math.abs(tr[0] || 1e-6) || Math.abs(tr[2]) > 0.5 * Math.abs(tr[3] || 1e-6) || Math.abs(it.height) > 36) return;
    const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const hPx = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 9;
    const base = { y: vy / vp.height, h: hPx / vp.height, hx: hPx / vp.width };
    if (opts && opts.blanks) {
      // Pull underscore runs and checkbox glyphs out of the text; they are blanks, not words.
      const len = s.length, at = (i) => (vx + it.width * (i / len)) / vp.width;
      const re = /_{3,}|[\u2610\u25A1\u274F\u2751\u2752\u25A2]|\[\s{0,3}\]/g;
      let last = 0, m;
      const piece = (a, b) => { const t = s.slice(a, b).trim(); if (t) raw.push({ s: t, x0: at(a), x1: at(b), ...base }); };
      while ((m = re.exec(s))) {
        piece(last, m.index);
        const kind = m[0][0] === "_" ? "line" : "box";
        opts.blanks.push({ kind, x0: at(m.index), x1: at(m.index + m[0].length), y: base.y, h: base.h });
        last = m.index + m[0].length;
      }
      piece(last, len);
      return;
    }
    raw.push({ s: s.trim(), x0: vx / vp.width, x1: (vx + it.width) / vp.width, ...base });
  });
  raw.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines = [];
  raw.forEach((it) => {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 0.4 * it.h);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  });
  const phrases = [];
  lines.forEach((l) => {
    l.items.sort((a, b) => a.x0 - b.x0);
    let cur = null;
    l.items.forEach((it) => {
      if (cur && it.x0 - cur.x1 <= 0.9 * it.hx) { cur.s += " " + it.s; cur.x1 = it.x1; cur.h = Math.max(cur.h, it.h); }
      else { if (cur) phrases.push(cur); cur = { ...it }; }
    });
    if (cur) phrases.push(cur);
  });
  phrases.forEach((p) => { p.cy = p.y - p.h * 0.3; p.cx = (p.x0 + p.x1) / 2; });
  return phrases;
}

// Finds the seven day rows and the call/wrap/meal/hours columns on one page.
function tsDetectGrid(phr) {
  const hits = phr.filter((p) => p.s.length <= 12 && TS_DAY_RE.test(p.s))
    .map((p) => ({ ...p, di: TS_DAY_KEYS.indexOf(p.s.slice(0, 3).toLowerCase()) })).filter((p) => p.di >= 0)
    .sort((a, b) => a.x0 - b.x0);
  const clusters = [];
  hits.forEach((p) => {
    const c = clusters.find((cl) => Math.abs(cl.x - p.x0) < 0.03);
    if (c) c.list.push(p); else clusters.push({ x: p.x0, list: [p] });
  });
  let best = null;
  clusters.forEach((c) => { const n = new Set(c.list.map((p) => p.di)).size; if (n >= 5 && (!best || n > best.n)) best = { n, list: c.list }; });
  if (!best) return null;
  const seen = new Set(), rows = [];
  best.list.sort((a, b) => a.y - b.y).forEach((p) => { if (!seen.has(p.di)) { seen.add(p.di); rows.push(p); } });
  const diffs = rows.slice(1).map((r, i) => r.cy - rows[i].cy).sort((a, b) => a - b);
  const rh = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0.03;
  const first = rows[0], last = rows[rows.length - 1];

  const top = first.cy - 0.14, bottom = first.cy - rh * 0.5;
  const band = phr.filter((p) => p.y >= top && p.y <= bottom && !(TS_DAY_RE.test(p.s)));
  const groups = [];
  band.forEach((p) => {
    const g = groups.find((x) => Math.abs(x.cx - p.cx) < 0.03);
    if (g) g.list.push(p); else groups.push({ cx: p.cx, list: [p] });
  });
  const cols = [];
  groups.forEach((g) => {
    g.list.sort((a, b) => a.y - b.y);
    const text = g.list.map((p) => p.s).join(" ");
    const key = tsClassifyColumn(text);
    if (!key) return;
    cols.push({ key, cx: g.cx, x0: Math.min(...g.list.map((p) => p.x0)), x1: Math.max(...g.list.map((p) => p.x1)), y0: Math.min(...g.list.map((p) => p.y - p.h)) });
  });
  cols.sort((a, b) => a.cx - b.cx);
  cols.forEach((c, k) => {
    const half = Math.max((c.x1 - c.x0) / 2, 0.025);
    const l = k > 0 ? (cols[k - 1].cx + c.cx) / 2 : c.cx - half * 1.3;
    const r = k < cols.length - 1 ? (c.cx + cols[k + 1].cx) / 2 : c.cx + half * 1.3;
    c.l = l + 0.003; c.r = r - 0.003;
  });
  const fields = [];
  const bh = Math.min(rh * 0.84, 0.04);
  rows.forEach((r) => {
    cols.forEach((c) => {
      fields.push({ bind: `d${r.di}.${c.key}`, x: c.l, y: r.cy - bh / 2, w: c.r - c.l, h: bh });
    });
  });
  // "Total" line under the grid: put the total in the hours column.
  const hoursCol = cols.find((c) => c.key === "hours");
  if (hoursCol) {
    const tot = phr.find((p) => /^total/i.test(p.s) && p.y > last.cy + rh * 0.3 && p.y < last.cy + rh * 3.5);
    if (tot) fields.push({ bind: "total_hours", x: hoursCol.l, y: tot.cy - bh / 2, w: hoursCol.r - hoursCol.l, h: bh });
  }
  // Only the table itself is off limits for label detection, not the whole band above it.
  const headTop = cols.length ? Math.min(...cols.map((c) => c.y0)) - 0.008 : first.cy - rh;
  return { fields, region: { top: headTop, bottom: last.cy + rh * 0.7 } };
}

function tsDetectLabels(phr, region, taken) {
  const out = [];
  const usedBinds = new Set(taken.map((f) => f.bind));
  phr.forEach((p) => {
    if (region && p.y >= region.top && p.y <= region.bottom) return;
    if (p.s.length > 40) return;
    const colon = /:\s*$/.test(p.s);
    const text = p.s.replace(/[:_\s]+$/, "");
    if (!text || /^(note|notes|instructions?|total|page)\b/i.test(text)) return;
    const guess = tsGuessLabelBind(text);
    if (guess && guess.skip) return;
    if (!guess && !colon) return;
    if (!guess && text.length < 3) return;
    const bind = guess ? guess.bind : "free";
    if (bind !== "free" && bind !== "fixed" && usedBinds.has(bind)) return;
    if (/^date$/i.test(text)) return;
    const nextX = Math.min(...phr.filter((q) => q !== p && Math.abs(q.y - p.y) < p.h * 0.6 && q.x0 > p.x1).map((q) => q.x0), 0.96);
    const x = p.x1 + 0.006;
    let w = Math.min(Math.max(nextX - x - 0.008, 0.07), 0.36);
    if (x + w > 0.98) w = 0.98 - x;
    if (w < 0.05) return;
    const isSig = bind === "signature";
    const h = isSig ? 0.04 : Math.max(0.017, p.h * 1.35);
    const f = { bind, x, y: isSig ? p.cy - 0.026 : p.cy - h / 2, w, h };
    if (bind === "free" || bind === "fixed") f.label = text;
    if (bind !== "free" && bind !== "fixed") usedBinds.add(bind);
    out.push(f);
    if (isSig) {
      const dateLbl = phr.find((q) => /^date\s*:?$/i.test(q.s) && Math.abs(q.y - p.y) < p.h && q.x0 > x + w * 0.4);
      if (dateLbl) out.push({ bind: "signed_date", x: dateLbl.x1 + 0.006, y: dateLbl.cy - 0.011, w: Math.min(0.16, 0.98 - dateLbl.x1 - 0.008), h: 0.022 });
    }
  });
  return out;
}

// Known field names on real union cards (Cast & Crew Toronto card). There, "IN" = meal starts, "OUT" = back to work.
const TS_ACRO_DAYCOL = { CALLTIME: "call", WRAPTIME: "wrap", LUNCHIN: "meal1_out", LUNCHOUT: "meal1_in", DINNERIN: "meal2_out", DINNEROUT: "meal2_in", DATE: "date", TOTALHOURS: "hours" };
const TS_ACRO_HEAD = { SHOWTITLE: "fixed", CORPNAME: "company", NAME: "name", WEEKENDING: "week_end", DEPT: "department", CTGRY: "position", UNION: "free" };
// Office / accounting / approval boxes and calculated columns: not for the employee.
const TS_ACRO_SKIP = /^(PRODUCER|PRODMGR|ACCOUNTANT|DEPTHEAD|ACCOUNTCODE|HOURS|DESC|RATE|TOTALS|CODE|TOTAL|SIN|GST|HDW|YES|NO|TRAVEL|TURNAROUND|EPS|PAYHOURS|1X|15X|2X|3X|NBD|AM|PM|BLANK|EQHOURS)\d*$/;
// Forms that already contain fillable boxes: use those exact positions.
async function tsDetectAcro(bytes) {
  const L = await ensurePdfLib();
  let doc, form;
  try { doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true }); form = doc.getForm(); } catch (_) { return []; }
  const pages = doc.getPages();
  const out = [], otCols = {};
  for (const field of form.getFields()) {
    const isCheck = field instanceof L.PDFCheckBox, isText = field instanceof L.PDFTextField;
    if (!isCheck && !isText) continue;
    const name = field.getName();
    const lower = name.toLowerCase();
    // Column-per-day naming: CALLTIME.0 .. CALLTIME.6 (0 = Sunday)
    const key = name.toUpperCase().replace(/[^A-Z0-9.]/g, "");
    const im = /^(.*?)\.?(\d)$/.exec(name.toUpperCase().replace(/[ _\-]/g, ""));
    const base = im ? im[1].replace(/\.$/, "") : "";
    const idx = im ? Number(im[2]) : -1;
    const plain = key.replace(/\./g, "");
    let bind, label;
    {
      // the 1.5X / 2X / 3X columns: the first seven boxes from the top are the days (Sunday first), the rest are totals
      const otc = { "15X": "ot15", "2X": "ot2", "3X": "ot3" }[plain.replace(/(?<=X)\d+$/, "")];
      if (otc) {
        for (const w of field.acroField.getWidgets()) {
          const r = w.getRectangle();
          let pi = pages.findIndex((pg) => w.P() && pg.ref.toString() === w.P().toString());
          if (pi < 0) pi = 0;
          const { width: W, height: H } = pages[pi].getSize();
          (otCols[otc] = otCols[otc] || []).push({ bind: null, page: pi, x: r.x / W, y: 1 - (r.y + r.height) / H, w: r.width / W, h: r.height / H });
        }
        continue;
      }
    }
    if (TS_ACRO_SKIP.test(plain) || (im && TS_ACRO_SKIP.test(base.replace(/\./g, "")))) continue;
    if (im && TS_ACRO_DAYCOL[base.replace(/\./g, "")] !== undefined) {
      if (idx > 6) continue;
      bind = `d${idx}.${TS_ACRO_DAYCOL[base.replace(/\./g, "")]}`;
      if (!bind || bind.endsWith(".null")) continue;
    } else if (TS_ACRO_HEAD[plain]) {
      bind = TS_ACRO_HEAD[plain];
    } else if (im && /^[A-Z.]*[A-Z]$/.test(base) && base.length > 1 && !/^(sun|mon|tue|wed|thu|fri|sat)/i.test(base) && !TS_ACRO_HEAD[base]) {
      continue; // unknown numbered grid column: not for the employee
    } else {
      const dm = /(sun|mon|tue|wed|thu|fri|sat)/.exec(lower);
      const col = tsClassifyColumn(name.replace(/(sun|mon|tue|wed|thu|fri|sat)[a-z]*/ig, " ").replace(/[_\-.\d]+/g, " "));
      if (dm && col) bind = `d${TS_DAY_KEYS.indexOf(dm[1])}.${col}`;
      else { const g = tsGuessLabelBind(name.replace(/[_\-.]+/g, " ")); bind = g && g.bind ? g.bind : (isCheck ? "free_check" : "free"); }
    }
    if (bind === "free" || bind === "free_check") label = name.replace(/[_\-.]+/g, " ").trim();
    for (const w of field.acroField.getWidgets()) {
      const r = w.getRectangle();
      let pi = pages.findIndex((pg) => w.P() && pg.ref.toString() === w.P().toString());
      if (pi < 0) pi = 0;
      const { width: W, height: H } = pages[pi].getSize();
      const f = { bind, page: pi, x: r.x / W, y: 1 - (r.y + r.height) / H, w: r.width / W, h: r.height / H };
      if (label) f.label = label;
      out.push(f);
    }
  }
  Object.entries(otCols).forEach(([col, arr]) => {
    arr.sort((p, q) => p.page - q.page || p.y - q.y).slice(0, 7).forEach((r, i) => out.push({ ...r, bind: `d${i}.${col}` }));
  });
  return out;
}

async function tsDetectFields(pdf, bytes) {
  const acro = await tsDetectAcro(bytes);
  let fields = [];
  if (acro.length >= 3) {
    fields = acro;
    // Cards often have no signature box: find the "EMPLOYEE SIGNATURE" line and add one.
    if (!fields.some((f) => f.bind === "signature")) {
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          const phr = await tsPagePhrases(await pdf.getPage(n));
          const sig = tsDetectLabels(phr, null, []).filter((f) => f.bind === "signature" || f.bind === "signed_date");
          if (sig.length) { sig.forEach((f) => fields.push({ ...f, page: n - 1 })); break; }
        }
      } catch (_) {}
    }
  }
  else {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const phr = await tsPagePhrases(page);
      if (phr.length < 15) {
        // a scanned page: read it with OCR and turn each blank into a box, linked by what its caption says
        try {
          const blanks = await dmOcrLabel(page, await dmDetectRaster(page));
          blanks.forEach((b) => {
            const lab = dmCleanLabel(b.label || "");
            const base = { x: b.x, y: b.y, w: b.w, h: b.h, page: n - 1 };
            if (b.type === "checkbox") { fields.push({ ...base, bind: "free_check", label: lab && !/^checkbox \d+$/i.test(lab) ? lab : "Tick if it applies" }); return; }
            if (b.type === "signature") { fields.push({ ...base, bind: "signature", label: "Employee signature" }); return; }
            const g = tsGuessLabelBind(lab);
            if (g && g.skip) return;
            if (g && g.bind && g.bind !== "fixed") fields.push({ ...base, bind: g.bind, label: lab });
            else fields.push({ ...base, bind: "free", label: /^blank \d+$/i.test(lab) ? "Details" : lab });
          });
        } catch (_) { /* leave this page for the admin to box by hand */ }
        continue;
      }
      const grid = tsDetectGrid(phr);
      const taken = grid ? grid.fields : [];
      const labels = tsDetectLabels(phr, grid && grid.region, taken);
      [...taken, ...labels].forEach((f) => fields.push({ ...f, page: n - 1 }));
    }
  }
  return fields.map((f) => {
    const x = clamp(f.x, 0, 0.99), y = clamp(f.y, 0, 0.99);
    const out = { ...f, id: "t" + Math.random().toString(36).slice(2, 8), x, y, w: clamp(f.w, 0.012, 1 - x), h: clamp(f.h, 0.008, 1 - y) };
    out.type = tsFieldType(out.bind);
    return out;
  });
}
