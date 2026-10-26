// ---- Auto-place fields on a deal memo (the admin then just nudges them) ----
const DM_SIG_RE = /(signature|signed|sign (here|below)|agreed( to)?|accepted|acknowledg|execut)/i;
const DM_COUNTER_RE = /(producer|company|authori[sz]ed|employer|upm|production manager)/i;
const DM_FOOTER_Y = 0.935;

const DM_BINDS = {
  full_name: "Full name", first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone",
  dob: "Date of birth", address: "Street address", city: "City", province: "Province / state", postal_code: "Postal / ZIP code",
  position: "Position / role", department: "Department", company: "Production company", start_date: "Start date", end_date: "End date", today: "Today's date",
};
const DM_BINDS_FR = {
  full_name: "Nom complet", first_name: "Prénom", last_name: "Nom de famille", email: "Courriel", phone: "Téléphone",
  dob: "Date de naissance", address: "Adresse (rue)", city: "Ville", province: "Province", postal_code: "Code postal",
  position: "Poste / fonction", department: "Département", company: "Société de production", start_date: "Date de début", end_date: "Date de fin",
};
function dmGuessBind(label, type) {
  const l = String(label || "").trim();
  if (!l || type === "checkbox" || type === "signature" || type === "countersignature") return "";
  if (/birth|naissance|\bdob\b|nacimiento/i.test(l)) return "dob";
  if (/e-?mail|courriel|correo/i.test(l)) return "email";
  if (/postal|\bzip\b|c[oó]digo postal/i.test(l)) return "postal_code";
  if (/phone|\btel\b|cell|mobile|t[ée]l[ée]phone|tel[ée]fono/i.test(l)) return "phone";
  if (/\bcity\b|\btown\b|\bville\b|ciudad/i.test(l)) return "city";
  if (/province|\bstate\b|provincia/i.test(l)) return "province";
  if (/address|street|adresse|\brue\b|direcci[oó]n|\bapt\b/i.test(l)) return "address";
  if (/first\s*name|given\s*name|pr[ée]nom|nombre de pila/i.test(l) || /^given$/i.test(l)) return "first_name";
  if (/last\s*name|surname|family\s*name|nom de famille|apellido/i.test(l) || /^surname/i.test(l)) return "last_name";
  if (/start(ing)?\s*date|commenc|effective|d[ée]but|date de d[ée]but|^from\b|^du$/i.test(l)) return "start_date";
  if (/end(ing)?\s*date|wrap\s*date|completion|^to$|^au$|and ending|date de fin|^fin\b/i.test(l)) return "end_date";
  if (/depart|d[ée]partement/i.test(l)) return "department";
  if (/services (of|de)|position|job\s*title|\brole\b|occupation|classification|\bposte\b|fonction|ocupaci/i.test(l)) return "position";
  if (/production company|name of applicant \(production|soci[ée]t[ée] de production|company name|nom de la soci/i.test(l)) return "company";
  if (/^(date|dated|date signed|signing date|today'?s date|\(date\)|date de signature|fecha)$/i.test(l)) return "today";
  if (/^(your |full |legal |print(ed)? |employee('?s)? |contractor('?s)? |crew( member)?('?s)? |name of (the )?(employee|contractor|crew member) ?)*(full |legal )?name( \(print(ed)?\))?$/i.test(l) && !/company|production|show|emergency|witness|supervisor|manager/i.test(l)) return "full_name";
  if (/^(nom|nombre)( complet)?( \(.*\))?$|full name of declarant|name of (the )?(applicant|declarant)$/i.test(l)) return "full_name";
  return "";
}
// Things that aren't an employee profile field but are asked the same way on many forms
const DM_CONCEPTS = [
  { k: "sin", skip: true, re: /\bs\.?\s?[il1|]\.?\s?[nm]\b|social insurance|assurance sociale|\bnas\b/i },
  { k: "nat_date", type: "date", re: /naturali/i, en: "Date you became a citizen (naturalization)", fr: "Date de naturalisation" },
  { k: "pr_date", type: "date", re: /admission|admis\b|permanent resident since/i, en: "Date you became a permanent resident", fr: "Date d'admission comme résident permanent" },
  { k: "drivers", re: /driver|driving|licen[cs]e|permis de conduire/i, en: "Driver's licence number", fr: "Numéro de permis de conduire" },
  { k: "loanout", re: /loan[\s-]?out/i, en: "Loan-out company name (leave blank if you work as an individual)", fr: "Nom de votre société de prêt de services (laisser vide si individu)" },
  { k: "production", re: /^content\b|entitled|intitul|production title|content title|title of (the )?production|name of production|titre de la production|^production$/i, en: "Production title", fr: "Titre de la production" },
];
const DM_VAGUE_WORDS = new Set("of de du des d la le les au à a and et entitled intitulée intitulee resident résident the for pour date name no number print given ending to from".split(" "));
const qNorm = (l) => String(l || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(optional\)|\(facultatif\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function dmVague(l) {
  const t = qNorm(l);
  if (!t) return true;
  const raw = String(l).trim();
  // a clipped piece of a sentence ("as a permanent", "0000 Name of", "(Signature") is not a question
  if (/^[a-z0-9]/.test(raw) && !/^(from|to|name|date|address|city|province|phone|email|e-mail|position|occupation|department|signature|title|company|surname|given|print)\b/i.test(raw)) return true;
  if (/\b(of|as|a|an|the|for|to|and|in|on|my|your|at|by|with|que|de|du|des|la|le|les|et|au|aux|pour)$/i.test(raw)) return true;
  if (/^\([^)]*$/.test(raw) || /^\d{3,}\b/.test(raw) || /^[\s(\[]*[\d\s.\/\-]+[)\]]?$/.test(raw)) return true;
  if (/^\(?\s*y{2,4}\s*[\/-]\s*m{1,2}/i.test(String(l).trim())) return true;
  const ws = t.split(" ");
  return ws.length <= 2 && ws.every((w) => DM_VAGUE_WORDS.has(w) || w.length <= 2) && !/^(from|to)$/.test(t);
}
function dmLang(text) {
  const t = " " + String(text || "").toLowerCase() + " ";
  const cnt = (re) => (t.match(re) || []).length;
  const fr = cnt(/[éèêëàâçùûôîï]/g) * 2 + cnt(/\b(de|du|des|les|et|au|aux|nom|adresse|naissance|ville|prénom|numéro|numero|permis|je|suis|pour|sur|intitulée|naturalisation|résident|resident permanent|la|le)\b/g);
  const en = cnt(/\b(the|of|and|name|address|street|city|birth|to|from|production|resident|licen[cs]e|number|print|entitled|ending|services|surname|given|postal|date of)\b/g);
  const es = cnt(/[ñ¿¡]/g) * 2 + cnt(/\b(el|los|las|nombre|dirección|direccion|fecha|ciudad|número|numero|apellido|licencia)\b/g);
  const m = Math.max(fr, en, es);
  if (!m) return "";
  if (fr === m && fr > en && fr > es) return "fr";
  if (es === m && es > en && es > fr) return "es";
  if (en === m && en > fr && en > es) return "en";
  return "";
}
const DM_LANG_NAMES = { en: "English", fr: "Français", es: "Español" };
// Last ~n characters of a sentence, starting on a word boundary
function dmTail(s, n) {
  s = String(s || "").trim();
  if (s.length <= n) return s;
  const cut = s.slice(s.length - n), sp = cut.indexOf(" ");
  return (sp > -1 ? cut.slice(sp + 1) : cut).trim();
}
function dmSegs(f) {
  const segs = [dmCleanLabel(f.label)];
  String(f.ctx || "").split(" | ").forEach((x) => { x = dmCleanLabel(x); if (x) segs.push(x); });
  return segs;
}
// What a box is really asking, in plain common terms, whatever the language it's printed in.
function dmResolveField(f) {
  const lab = dmCleanLabel(f.label).replace(/\s*\((optional|facultatif)\)\s*$/i, "");
  const vague = dmVague(lab);
  const segs = vague ? dmSegs(f) : [lab];
  let bind = "", concept = null, text = lab;
  if (f.bind === undefined) {
    for (const sg of segs) {
      const b = dmGuessBind(sg, f.type);
      if (b) { bind = b; text = sg; break; }
      const c = DM_CONCEPTS.find((c) => c.re.test(sg));
      if (c) { concept = c; text = sg; break; }
    }
  } else if (f.bind) bind = f.bind;
  const lang = dmLang(text + " " + lab);
  if (bind) return { key: bind, bind, mapped: true, label: { en: DM_BINDS[bind], fr: DM_BINDS_FR[bind] }, type: f.type, lang, skip: bind === "today" };
  if (concept) return { key: concept.k, mapped: true, skip: !!concept.skip, label: { en: concept.en, fr: concept.fr }, type: concept.type || f.type, lang };
  let best = text;
  if (vague) best = segs.find((x) => x && !dmVague(x) && x.length <= 90) || lab;
  if (dmVague(best)) {
    const here = `Detail asked on page ${(f.page || 0) + 1}`;
    return { key: "q:p" + (f.page || 0) + "-" + Math.round((f.y || 0) * 100) + "-" + Math.round((f.x || 0) * 100), mapped: false, label: { en: here, fr: `Renseignement demandé à la page ${(f.page || 0) + 1}` }, type: f.type, lang: "", vague: true, skip: /^blank \d+$/i.test(lab) };
  }
  return { key: "q:" + qNorm(best), mapped: false, label: { en: best }, type: f.type, lang: dmLang(best + " " + lab), skip: /^blank \d+$/i.test(lab) };
}
// Resolve every box on a form; a box that's just a translation of another box nearby shares its answer.
function dmResolveTemplate(t, lang) {
  const list = (t.fields || []).filter((f) => f.type === "text" || f.type === "date");
  const out = new Map();
  list.forEach((f) => out.set(f.id, dmResolveField(f)));
  if (lang) list.forEach((f) => {
    const r = out.get(f.id);
    if (r.mapped || r.skip || !r.lang || r.lang === lang) return;
    const partner = list.find((g) => { const q = out.get(g.id); return g !== f && g.page === f.page && !q.mapped && q.lang === lang && Math.abs(g.y - f.y) < 0.03; });
    if (partner) { const q = out.get(partner.id); r.key = q.key; r.label = q.label; r.hidden = true; }
  });
  return out;
}
function dmLanguages(templates) {
  const n = { en: 0, fr: 0, es: 0 };
  templates.forEach((t) => (t.fields || []).forEach((f) => { if (f.type === "text" || f.type === "date") { const l = dmLang(dmCleanLabel(f.label) + " " + (String(f.ctx || "").split(" | ")[0] || "")); if (l) n[l]++; } }));
  return Object.keys(n).filter((k) => (k === "en" ? n[k] >= 1 : n[k] >= 3));
}
function dmCleanLabel(s) {
  return String(s || "").replace(/_+/g, " ").replace(/\s+/g, " ").replace(/^[\s:.\-–—]+|[\s:.\-–—]+$/g, "").slice(0, 60);
}
function dmTypeFor(label, shape) {
  const l = label || "";
  if (shape === "checkbox") return "checkbox";
  if (/^(date|dated|date signed|signing date)$/i.test(l) || /\bdate\b/i.test(l) && !/signature/i.test(l)) return "date";
  if (/(print|type|full)\s*name|witness/i.test(l) && /sign/i.test(l)) return "text";
  if (DM_SIG_RE.test(l)) return DM_COUNTER_RE.test(l) && !/employee|contractor|crew/i.test(l) ? "countersignature" : "signature";
  return "text";
}

// Positions of the page's drawn lines and boxes, in points from the page's top-left.
const dmStats = { h: 0, v: 0, rect: 0, ops: 0, text: 0 };
async function dmPageShapes(page, pdfjs) {
  const OPS = pdfjs.OPS;
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const mulRow = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const shapes = { h: [], v: [], rect: [] };
  const pt = (x, y) => { const X = ctm[0] * x + ctm[2] * y + ctm[4], Y = ctm[1] * x + ctm[3] * y + ctm[5]; return vp.convertToViewportPoint(X, Y); };
  const paint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  let pending = []; // subpaths: arrays of [x, y] in page points
  let sub = null;
  const flush = () => { if (sub && sub.length > 1) pending.push(sub); sub = null; };
  const addRectOrLines = (pts) => {
    let q = pts.slice();
    if (q.length > 1 && Math.abs(q[0][0] - q[q.length - 1][0]) < 0.5 && Math.abs(q[0][1] - q[q.length - 1][1]) < 0.5) q.pop();
    if (q.length === 4) {
      const xs = q.map((a) => a[0]), ys = q.map((a) => a[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const axis = q.every((a) => (Math.abs(a[0] - x0) < 0.6 || Math.abs(a[0] - x1) < 0.6) && (Math.abs(a[1] - y0) < 0.6 || Math.abs(a[1] - y1) < 0.6));
      if (axis) { addRect(x0, x1, y0, y1); return; }
    }
    for (let k = 1; k < pts.length; k++) addSeg(pts[k - 1], pts[k]);
  };
  const addRect = (x0, x1, y0, y1) => {
    const rw = x1 - x0, rh = y1 - y0;
    if (rh <= 2.5 && rw >= 8) shapes.h.push({ x0, x1, y: (y0 + y1) / 2 });
    else if (rw <= 2.5 && rh >= 8) shapes.v.push({ y0, y1, x: (x0 + x1) / 2 });
    else if (rw > 2.5 && rh > 2.5) shapes.rect.push({ x0, x1, y0, y1 });
  };
  const addSeg = (a, b) => {
    const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
    if (dy <= 0.8 && dx >= 8) shapes.h.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2 });
    else if (dx <= 0.8 && dy >= 8) shapes.v.push({ y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), x: (a[0] + b[0]) / 2 });
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], args = ol.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) ctm = mulRow(args, ctm);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (args && args[0]) ctm = mulRow(args[0], ctm); }
    else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.constructPath) {
      const cops = args[0], c = args[1];
      let ci = 0;
      for (const op of cops) {
        if (op === OPS.moveTo) { flush(); sub = [pt(c[ci], c[ci + 1])]; ci += 2; }
        else if (op === OPS.lineTo) { if (!sub) sub = []; sub.push(pt(c[ci], c[ci + 1])); ci += 2; }
        else if (op === OPS.curveTo) { if (!sub) sub = []; sub.push(pt(c[ci + 4], c[ci + 5]), [1e9, 1e9]); ci += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { if (!sub) sub = []; sub.push(pt(c[ci + 2], c[ci + 3]), [1e9, 1e9]); ci += 4; }
        else if (op === OPS.closePath) { if (sub && sub.length) sub.push(sub[0].slice()); flush(); }
        else if (op === OPS.rectangle) {
          flush();
          const x = c[ci], y = c[ci + 1], w = c[ci + 2], h = c[ci + 3]; ci += 4;
          const a = pt(x, y), b = pt(x + w, y + h);
          pending.push([a, [b[0], a[1]], b, [a[0], b[1]], a.slice()]);
        }
      }
      flush();
    } else if (paint.has(fn)) {
      pending.forEach((sp) => { if (!sp.some((a) => a[0] > 1e8)) addRectOrLines(sp); });
      pending = [];
    } else if (fn === OPS.endPath) { pending = []; sub = null; }
  }
  // Squares drawn as four separate strokes are still checkboxes
  shapes.h.forEach((a) => {
    const len = a.x1 - a.x0;
    if (len < 6 || len > 26) return;
    const bottom = shapes.h.find((b) => b !== a && Math.abs(b.x0 - a.x0) < 1.5 && Math.abs(b.x1 - a.x1) < 1.5 && Math.abs(b.y - a.y - len) < len * 0.25 && b.y > a.y);
    if (bottom && shapes.v.some((v) => Math.abs(v.x - a.x0) < 1.5 && v.y0 <= a.y + 1.5 && v.y1 >= bottom.y - 1.5)) shapes.rect.push({ x0: a.x0, x1: a.x1, y0: a.y, y1: bottom.y });
  });
  dmStats.h += shapes.h.length; dmStats.v += shapes.v.length; dmStats.rect += shapes.rect.length; dmStats.ops += ol.fnArray.length;
  return { shapes, W: vp.width, H: vp.height };
}

// Scanned or flattened PDFs (no real text or drawing commands): find blanks from the picture itself.
async function dmDetectRaster(page) {
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1100 / vp0.width);
  const vp = page.getViewport({ scale });
  const cv = document.createElement("canvas");
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const w = cv.width, h = cv.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  const dark = new Uint8Array(w * h), faint = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) faint[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11 < 215 ? 1 : 0;
  const mid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mid[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11 < 185 ? 1 : 0;
  for (let i = 0; i < w * h; i++) dark[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11 < 150 ? 1 : 0;
      const pxPerPt = scale, pageScale = vp0.width / 612;
  // vertical strokes (table borders)
  const vruns = [];
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!faint[y * w + x]) { y++; continue; }
      const s0 = y; while (y < h && faint[y * w + x]) y++;
      if (y - s0 >= 14) vruns.push({ x, y0: s0, y1: y });
    }
  }
  // horizontal strokes
  const minLen = Math.max(40 * pxPerPt * pageScale, 0.06 * w);
  let runs = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!dark[y * w + x]) { x++; continue; }
      const s0 = x; while (x < w && dark[y * w + x]) x++;
      if (x - s0 >= minLen) runs.push({ x0: s0, x1: x, y0: y, y1: y });
    }
  }
  let lines = [];
  runs.forEach((r) => {
    const m = lines.find((l) => r.y0 - l.y1 <= 1 && Math.abs(l.x0 - r.x0) <= 3 && Math.abs(l.x1 - r.x1) <= 3);
    if (m) m.y1 = r.y0; else lines.push({ ...r });
  });
  // a slightly tilted or broken rule: join pieces that sit on the same row and nearly touch
  {
    lines.sort((a, b) => a.x0 - b.x0);
    const merged = [];
    lines.forEach((l) => {
      const m = merged.find((q) => Math.abs((q.y0 + q.y1) / 2 - (l.y0 + l.y1) / 2) <= 3 && l.x0 - q.x1 <= 0.006 * w && l.x0 >= q.x0 - 2);
      if (m) m.x1 = Math.max(m.x1, l.x1); else merged.push({ ...l });
    });
    lines = merged;
    // a faint scanned rule fades at its ends: follow it along (same row +-1) through small gaps
    lines.forEach((l) => {
      const ym = Math.round((l.y0 + l.y1) / 2);
      const on = (x) => x >= 0 && x < w && (mid[(ym - 1) * w + x] || mid[ym * w + x] || mid[(ym + 1) * w + x]);
      const cnt = (a, b) => { let c = 0; for (let q = a; q < b; q++) if (on(q)) c++; return c; };
      for (let k = 0; k < 200 && l.x1 + 10 <= w && cnt(l.x1, l.x1 + 10) >= 9; k++) l.x1 += 10;
      for (let k = 0; k < 200 && l.x0 - 10 >= 0 && cnt(l.x0 - 10, l.x0) >= 9; k++) l.x0 -= 10;
    });
  }
  const hit = (x, y) => vruns.some((v) => Math.abs(v.x - x) <= 3 && v.y0 - 3 <= y && v.y1 + 3 >= y);
  const out = [];
  const fh = 17 * pageScale / vp0.height * 1, sigH = 38 * pageScale / vp0.height;
  let n = 0;
  // Outlined boxes to type in: a top rule and a bottom rule joined by two sides become ONE field
  const used = new Set();
  {
    const thin = lines.filter((l) => l.y1 - l.y0 <= 4 && l.x1 - l.x0 >= 0.05 * w && l.x1 - l.x0 <= 0.6 * w);
    thin.forEach((top) => {
      if (used.has(top)) return;
      const bot = thin.find((b) => b !== top && !used.has(b) && b.y0 - top.y1 >= 8 && b.y0 - top.y1 <= 0.06 * h && Math.abs(b.x0 - top.x0) <= 4 && Math.abs(b.x1 - top.x1) <= 4);
      if (!bot) return;
      const mid = (top.y1 + bot.y0) / 2;
      // both sides must be drawn the whole way down (a bracket in the caption text is not a side)
      const solid = (x) => { let ok = 0, tot = 0; for (let yy = top.y1 + 1; yy < bot.y0; yy++) { tot++; for (let xx = x - 3; xx <= x + 3; xx++) if (xx >= 0 && xx < w && faint[yy * w + xx]) { ok++; break; } } return tot > 0 && ok / tot >= 0.9; };
      if (!solid(top.x0) || !solid(top.x1)) return;
      if (bot.y1 / h > DM_FOOTER_Y) return;
      used.add(top); used.add(bot);
      n++;
      out.push({ _box: true, type: "text", label: "Blank " + n, x: (top.x0 + 2) / w, y: (top.y1 + 1) / h, w: (top.x1 - top.x0 - 4) / w, h: (bot.y0 - top.y1 - 2) / h });
    });
  }
  lines.filter((l) => l.y1 - l.y0 <= 4 && l.x1 - l.x0 <= 0.76 * w && !used.has(l)).forEach((l) => {
    const y = (l.y0 + l.y1) / 2;
    if (hit(l.x0, y) && hit(l.x1, y)) return;
    if (y / h > DM_FOOTER_Y) return;
    const dupL = out.some((o) => o.type === "text" && Math.abs((o.y + 17 * pageScale / vp0.height) - (y / h + 0.003)) < 0.012 && Math.min(o.x + o.w, l.x1 / w) - Math.max(o.x, l.x0 / w) > 0.5 * Math.min(o.w, (l.x1 - l.x0) / w));
    if (dupL) return;
    n++;
    const fhn = 17 * pageScale / vp0.height;
    out.push({ type: "text", label: "Blank " + n, x: l.x0 / w, y: y / h - fhn + 0.003, w: (l.x1 - l.x0) / w, h: fhn });
  });
  // checkboxes: small square outlines
  const lab = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let comp = 0, cn = 0;
  const lo = 5.5 * pxPerPt * pageScale, hi = 28 * pxPerPt * pageScale;
  for (let i = 0; i < w * h; i++) {
    if (!dark[i] || lab[i]) continue;
    comp++;
    let sp = 0, count = 0, minx = w, maxx = 0, miny = h, maxy = 0, big = false;
    stack[sp++] = i; lab[i] = comp;
    while (sp) {
      const j = stack[--sp], x = j % w, y = (j - x) / w;
      count++;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (maxx - minx > hi * 2 || maxy - miny > hi * 2) big = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx2 = x + dx, ny2 = y + dy;
        if (nx2 < 0 || ny2 < 0 || nx2 >= w || ny2 >= h) continue;
        const k = ny2 * w + nx2;
        if (dark[k] && !lab[k]) { lab[k] = comp; stack[sp++] = k; }
      }
    }
    if (big) continue;
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (bw < lo || bw > hi || bh < lo || bh > hi || Math.abs(bw - bh) > 0.2 * Math.max(bw, bh)) continue;
    if (count > 0.75 * bw * bh) continue;
    let edge = 0, tot = 0;
    for (let x = minx; x <= maxx; x++) { tot += 2; edge += dark[miny * w + x] + dark[maxy * w + x]; }
    for (let y = miny; y <= maxy; y++) { tot += 2; edge += dark[y * w + minx] + dark[y * w + maxx]; }
    if (edge / tot < 0.8) continue;
    const cd = (cx, cy) => { for (let dy = 0; dy <= 2; dy++) for (let dx = 0; dx <= 2; dx++) { const xx = Math.min(Math.max(cx + dx * (cx === minx ? 1 : -1), 0), w - 1), yy = Math.min(Math.max(cy + dy * (cy === miny ? 1 : -1), 0), h - 1); if (dark[yy * w + xx]) return 1; } return 0; };
    if (cd(minx, miny) + cd(maxx, miny) + cd(minx, maxy) + cd(maxx, maxy) < 4) continue;
    // a real checkbox stands apart from its neighbours; a letter sits tight against the next one
    const gap = Math.max(4, Math.round(0.25 * Math.max(bw, bh)));
    const freeCols = (x0, x1) => { for (let xx = Math.max(x0, 0); xx <= Math.min(x1, w - 1); xx++) for (let yy = miny; yy <= maxy; yy++) if (dark[yy * w + xx]) return false; return true; };
    if (!freeCols(minx - gap, minx - 1) || !freeCols(maxx + 1, maxx + gap)) continue;
    if (maxy / h > DM_FOOTER_Y) continue;
    cn++;
    out.push({ type: "checkbox", label: "Checkbox " + cn, x: minx / w, y: miny / h, w: bw / w, h: bh / h });
  }
  return out.slice(0, 80);
}

// Either/or sections: "Yes / No" with "If Yes ... If No ...", "... OR ...", "check one", "same as above".
// Each box gets alt = { g: group, b: branch }. Answering one branch makes the others not needed.
function dmFindAlternatives(list, phr, page) {
  if (!phr || !list.length) return list;
  const cy = (f) => f.y + f.h / 2;
  let gi = 0;
  const setAlt = (fs, g, b) => fs.forEach((f) => { if (!f.alt) f.alt = { g, b }; });
  const inBand = (y0, y1) => list.filter((f) => f.type !== "signature" && f.type !== "countersignature" && cy(f) >= y0 && cy(f) < y1);
  const cbs = list.filter((f) => f.type === "checkbox");
  const lab = (f) => String(f.label || "").toLowerCase();
  const isItem = (s) => /^\d{1,2}[a-z]?[).]/.test(s.trim());
  // Yes / No with conditional sections
  cbs.filter((f) => /^(yes|oui|sí)\b/.test(lab(f))).forEach((y) => {
    const n = cbs.find((c) => c !== y && !c.alt && /^(no|non)\b/.test(lab(c)) && Math.abs(cy(c) - cy(y)) < 0.015);
    if (!n || y.alt) return;
    const g = `p${page}-yn${++gi}`;
    y.alt = { g, b: "yes" }; n.alt = { g, b: "no" };
    const find = (re) => phr.filter((p) => re.test(p.s.trim()) && p.y > cy(y)).sort((a, b) => a.y - b.y)[0];
    const ifY = find(/^if\s*[‘'’"“”]?\s*(yes|oui)\b/i), ifN = find(/^if\s*[‘'’"“”]?\s*(no|non)\b/i);
    const end = (start) => {
      const others = [ifY, ifN].filter((o) => o && o.y > start.y).map((o) => o.y);
      const stop = phr.filter((p) => p.y > start.y + 0.012 && p.s.length > 50 && p.x0 < 0.2 && !isItem(p.s) && !/^if\b/i.test(p.s.trim())).map((p) => p.y - p.h);
      return Math.min(start.y + 0.25, ...others, ...stop);
    };
    if (ifY) setAlt(inBand(ifY.y, end(ifY)).filter((f) => f.type !== "checkbox"), g, "yes");
    if (ifN) setAlt(inBand(ifN.y, end(ifN)).filter((f) => f.type !== "checkbox"), g, "no");
  });
  // "A ... OR B ..."
  phr.filter((p) => /^(or|ou|o)$/i.test(p.s.trim()) && p.x0 < 0.35).forEach((orp) => {
    const prev = phr.filter((p) => p.y < orp.y - 0.01 && p.x0 < 0.28 && /^([a-z]|\d{1,2})[).](\s|$)/i.test(p.s.trim())).sort((a, b) => b.y - a.y)[0];
    const next = phr.filter((p) => p.y > orp.y + 0.01 && p.x0 < 0.2 && /^\d{1,2}[).](\s|$)/.test(p.s.trim())).sort((a, b) => a.y - b.y)[0];
    const y0 = prev ? prev.y - prev.h : orp.y - 0.2, y2 = next ? next.y - next.h : orp.y + 0.15;
    const A = inBand(y0, orp.y - 0.005).filter((f) => !f.alt), B = inBand(orp.y, y2).filter((f) => !f.alt);
    if (A.length && B.length) { const g = `p${page}-or${++gi}`; setAlt(A, g, "a"); setAlt(B, g, "b"); }
  });
  // "please check one"
  phr.filter((p) => /check one|cochez une|select one/i.test(p.s)).forEach((p) => {
    const near = cbs.filter((c) => !c.alt && c.y > p.y - 0.01 && c.y < p.y + 0.2);
    if (near.length < 2) return;
    const col = near.filter((c) => Math.abs(c.x - near[0].x) < 0.04);
    if (col.length >= 2) { const g = `p${page}-co${++gi}`; col.forEach((c, i) => { c.alt = { g, b: "c" + i }; }); }
  });
  // "same as above" tick versus a separate address
  cbs.filter((c) => !c.alt && /same as|même que|igual/i.test(lab(c))).forEach((c) => {
    const nx = cbs.filter((d) => d !== c && !d.alt && d.y > c.y && d.y - c.y < 0.07).sort((a, b) => a.y - b.y)[0];
    if (!nx) return;
    const g = `p${page}-sa${++gi}`;
    c.alt = { g, b: "a" }; nx.alt = { g, b: "b" };
    setAlt(inBand(cy(nx) - 0.012, cy(nx) + 0.04).filter((f) => f.type !== "checkbox"), g, "b");
  });
  return list;
}

// Scanned pages have no text to read labels from, so read the picture (OCR) and name each blank from the words beside it.
let tessReady = null;
function ensureTesseract() {
  if (tessReady) return tessReady;
  tessReady = new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(window.Tesseract); return; }
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";
    sc.onload = () => resolve(window.Tesseract);
    sc.onerror = () => { tessReady = null; reject(new Error("OCR unavailable")); };
    document.head.appendChild(sc);
  });
  return tessReady;
}
async function dmOcrLabel(page, list) {
  if (!list.length) return list;
  let phrOut = null;
  try {
    const T = await ensureTesseract();
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2.5, 1700 / vp0.width) });
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    { // keep only dark ink so pale watermarks and shading don't confuse the reader
      const id = ctx.getImageData(0, 0, cv.width, cv.height), px = id.data;
      for (let i = 0; i < px.length; i += 4) { const v = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11 < 140 ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; }
      ctx.putImageData(id, 0, 0);
    }
    const worker = await T.createWorker("eng");
    let words = [];
    try {
      const { data } = await worker.recognize(cv);
      words = (data.words || []).filter((w) => w.text && w.confidence > 25 && !/^[_\-–—.|=~\s]+$/.test(w.text));
    } finally { try { await worker.terminate(); } catch (_) {} }
    // Group words on a row into phrases
    const W = cv.width, H = cv.height;
    const ws = words.map((w) => ({ s: w.text, x0: w.bbox.x0 / W, x1: w.bbox.x1 / W, y0: w.bbox.y0 / H, y1: w.bbox.y1 / H, cy: (w.bbox.y0 + w.bbox.y1) / 2 / H }))
      .filter((p) => !list.some((f) => f._box && p.x0 >= f.x - 0.02 && p.x1 <= f.x + f.w + 0.02 && p.cy > f.y && p.cy < f.y + f.h)) // stray marks from an empty box's own border
      .sort((a, b) => a.cy - b.cy);
    // "( )" typed as tick spots: OCR reads them as "()", "{}" or a lone "(" next to ")"
    {
      const isOpen = (t) => /^[({\[]$/.test(t), isClose = (t) => /^[)}\]]$/.test(t);
      const marks = [];
      for (let i = ws.length - 1; i >= 0; i--) {
        const w0 = ws[i];
        if (/^[({\[]\s*[)}\]]$/.test(w0.s)) { marks.push({ x0: w0.x0, x1: w0.x1, y0: w0.y0, y1: w0.y1 }); ws.splice(i, 1); continue; }
        if (isOpen(w0.s)) {
          const k = ws.findIndex((q) => q !== w0 && isClose(q.s) && Math.abs(q.cy - w0.cy) < 0.006 && q.x0 - w0.x1 >= -0.002 && q.x0 - w0.x1 < 0.02);
          if (k >= 0) { const q = ws[k]; marks.push({ x0: w0.x0, x1: q.x1, y0: Math.min(w0.y0, q.y0), y1: Math.max(w0.y1, q.y1) }); ws.splice(Math.max(i, k), 1); ws.splice(Math.min(i, k), 1); i = Math.min(i, ws.length); }
        }
      }
      let cn2 = list.filter((f) => f.type === "checkbox").length;
      marks.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).forEach((m) => {
        const side = Math.max((m.y1 - m.y0) * cv.height * 1.3, (m.x1 - m.x0) * cv.width * 1.3, 0.014 * cv.width);
        const bw = side / cv.width, bh = side / cv.height, mx = (m.x0 + m.x1) / 2, my = (m.y0 + m.y1) / 2;
        const cand = { type: "checkbox", label: "Checkbox " + (++cn2), x: mx - bw / 2, y: my - bh / 2, w: bw, h: bh };
        if (list.some((f) => f.type === "checkbox" && Math.abs(f.x - cand.x) < 0.02 && Math.abs(f.y - cand.y) < 0.012)) return;
        list.push(cand);
      });
    }
    // Group words into text lines first (columns side by side share a line), then split each line into phrases at wide gaps.
    const rows = [];
    ws.forEach((w) => {
      const hgt = w.y1 - w.y0;
      const r = rows.find((q) => Math.abs(q.cy - w.cy) < Math.max(0.0035, 0.45 * Math.min(hgt, q.h)));
      if (r) { r.items.push(w); r.cy = (r.cy * (r.items.length - 1) + w.cy) / r.items.length; r.h = Math.min(r.h, hgt); }
      else rows.push({ cy: w.cy, h: hgt, items: [w] });
    });
    const phr = [];
    rows.forEach((r) => {
      r.items.sort((a, b) => a.x0 - b.x0);
      let cur = null;
      r.items.forEach((w) => {
        if (cur && w.x0 - cur.x1 < 0.025) { cur.s += " " + w.s; cur.x1 = w.x1; cur.y = Math.max(cur.y, w.y1); cur.h = Math.max(cur.h, w.y1 - w.y0); }
        else { if (cur) phr.push(cur); cur = { s: w.s, x0: w.x0, x1: w.x1, y: w.y1, cy: r.cy, h: w.y1 - w.y0 }; }
      });
      if (cur) phr.push(cur);
    });
    phrOut = phr;
    const clean = (p) => dmCleanLabel(p.s);
    // Stacked rules with a small caption between them ("Production Company" / "Content Title"): each band between two rules is one blank,
    // typed to the RIGHT of its caption. The rules themselves are just row dividers.
    {
      const tf = list.filter((f) => f.type === "text").sort((a, b) => a.y - b.y);
      const bands = [];
      tf.forEach((top) => {
        const lt = top.y + top.h;
        const bot = tf.find((g) => g !== top && Math.abs(g.x - top.x) < 0.012 && Math.abs(g.w - top.w) < 0.02 && (g.y + g.h) - lt >= 0.014 && (g.y + g.h) - lt <= 0.05);
        if (!bot) return;
        const lb = bot.y + bot.h, span = lb - lt;
        const c = phr.filter((p) => p.x0 >= top.x - 0.01 && p.x0 <= top.x + 0.03 && p.x1 - p.x0 <= 0.45 * top.w && (p.cy - lt) / span >= 0.28 && (p.cy - lt) / span <= 0.8 && p.s.replace(/[^A-Za-z]/g, "").length >= 4)[0];
        if (!c) return;
        const rightSide = phr.some((p) => p !== c && p.x0 > c.x1 && p.x0 < top.x + top.w && Math.abs(p.cy - c.cy) < 0.012);
        if (rightSide) return;
        bands.push({ top, bot, c, lt, lb });
      });
      if (bands.length) {
        const used = new Set();
        bands.forEach((b) => { used.add(b.top); used.add(b.bot); });
        const made = bands.map((b) => {
          const x = Math.min(b.c.x1 + 0.012, b.top.x + b.top.w - 0.05);
          return { type: dmTypeFor(dmCleanLabel(b.c.s), "text"), label: dmCleanLabel(b.c.s), x, y: b.lt + 0.002, w: b.top.x + b.top.w - x, h: Math.max(0.012, b.lb - b.lt - 0.004), _band: true, _named: true };
        });
        for (let li = list.length - 1; li >= 0; li--) if (used.has(list[li])) list.splice(li, 1);
        list.push(...made);
      }
    }
    // one long rule shared by two captions printed beneath it (e.g. "(apt./number/street)" ... "(city/town)"): two blanks
    for (let li = list.length - 1; li >= 0; li--) {
      const f = list[li];
      if (f.type !== "text" || f.w < 0.25) continue;
      const bot = f.y + f.h;
      const caps = phr.filter((p) => p.y - bot > -0.004 && p.y - bot <= 0.045 && p.x0 >= f.x - 0.02 && p.x1 <= f.x + f.w + 0.005 && p.s.length <= 40 && p.s.replace(/[^A-Za-z]/g, "").length >= 4).sort((a, b) => a.x0 - b.x0);
      const sep = caps.filter((p, i) => i === 0 || p.x0 - caps[i - 1].x1 > 0.04);
      if (sep.length < 2 || sep.length > 4) continue;
      const parts = [];
      for (let i = 0; i < sep.length; i++) {
        const xa = i === 0 ? f.x : (sep[i - 1].x1 + sep[i].x0) / 2 + 0.005;
        const xb = i === sep.length - 1 ? f.x + f.w : (sep[i].x1 + sep[i + 1].x0) / 2 - 0.005;
        parts.push({ ...f, x: xa, w: xb - xa });
      }
      list.splice(li, 1, ...parts);
    }
    list.forEach((f) => {
      if (f._named) return;
      const isCheck = f.type === "checkbox";
      if (!/^(Blank|Checkbox) \d+$/.test(f.label || "")) return;
      const cyF = f.y + f.h / 2, x0 = f.x, x1 = f.x + f.w;
      let lab = "";
      {
        const rowY = isCheck ? cyF : f.y + f.h * 0.6, bot = f.y + f.h;
        const parts = [];
        { const rowL = phr.filter((p) => p.x1 <= x0 + 0.01 && x0 - p.x1 < 0.8 && Math.abs(p.cy - rowY) < 0.013).sort((a, b) => a.x0 - b.x0); if (rowL.length) parts.push(dmTail(dmCleanLabel(rowL.map((p) => p.s).join(" ")), 80)); }
        phr.filter((p) => p.y - bot > 0 && p.y - bot <= 0.05 && Math.min(p.x1, x1 + 0.15) - Math.max(p.x0, x0 - 0.15) > 0 && p.s.length <= 60).sort((a, b) => a.y - b.y).slice(0, 2).forEach((p) => parts.push(clean(p)));
        phr.filter((p) => f.y - p.y > 0 && f.y - p.y <= 0.045 && Math.min(p.x1, x1) - Math.max(p.x0, x0) > 0 && p.s.length <= 70).sort((a, b) => b.y - a.y).slice(0, 1).forEach((p) => parts.push(clean(p)));
        f.ctx = [...new Set(parts.filter(Boolean))].join(" | ").slice(0, 220);
      }
      if (isCheck) {
        const right = phr.filter((p) => p.x0 >= x1 - 0.004 && p.x0 - x1 < 0.05 && Math.abs(p.cy - cyF) < 0.014).sort((a, b) => a.x0 - b.x0)[0];
        if (right) lab = clean(right);
        else {
          const lf = phr.filter((p) => p.x1 <= f.x + 0.012 && f.x - p.x1 < 0.4 && Math.abs(p.cy - cyF) < 0.014).sort((a, b) => b.x1 - a.x1)[0];
          if (lf) lab = dmTail(clean(lf), 70);
        }
      } else {
        const row = f.y + f.h * 0.6;
        const capOf = (p) => /^[({\[]/.test(p.s.trim()) && list.some((g) => g !== f && g.type === "text" && Math.min(g.x + g.w, p.x1) - Math.max(g.x, p.x0) > 0.5 * (p.x1 - p.x0) && p.cy > g.y + g.h && p.cy - (g.y + g.h) <= 0.04);
        const left = phr.filter((p) => p.x1 <= x0 + 0.01 && x0 - p.x1 < 0.3 && Math.abs(p.cy - row) < 0.013 && !capOf(p)).sort((a, b) => b.x1 - a.x1)[0];
        if (left) lab = clean(left);
        {
          // a real caption printed under the line ("(Occupation)", "Name of Production") beats a weak word beside it ("of", "I,", "To wit")
          const bot0 = f.y + f.h;
          const cap = phr.filter((p) => p.y - bot0 > -0.004 && p.y - bot0 <= 0.045 && Math.min(p.x1, x1) - Math.max(p.x0, x0) > 0.3 * (p.x1 - p.x0) && p.s.length <= 80 && !capOf(p) && !/yyyy|mm\/dd|day\/month|jour\/mois|\bdd\b/i.test(p.s) && !list.some((g) => g !== f && g.type !== "checkbox" && g.x >= p.x1 - 0.01 && g.x - p.x1 < 0.3 && Math.abs(p.cy - (g.y + g.h * 0.6)) < 0.007)).sort((a, b) => a.y - b.y)[0];
          const letters = (t) => t.replace(/[^A-Za-z]/g, "").length;
          if (cap) {
            const ct = clean(cap);
            if ((letters(ct) >= 8 || (letters(ct) >= 4 && left && f.x - left.x1 > 0.04)) && (!lab || (left && f.x - left.x1 > 0.04) || letters(lab) < 6 || /^(to wit|of|and|the)\b/i.test(lab.trim()) && letters(lab) < 8)) lab = ct;
          }
        }
        if (!lab || lab.replace(/[^A-Za-z]/g, "").length < 5) {
          // a fragment (underlined words split the line): use the whole row of text left of the box
          const rowL = phr.filter((p) => p.x1 <= x0 + 0.01 && x0 - p.x1 < 0.8 && Math.abs(p.cy - row) < 0.013).sort((a, b) => a.x0 - b.x0);
          const chain = []; for (let i = rowL.length - 1; i >= 0; i--) { if (chain.length && chain[0].x0 - rowL[i].x1 > 0.03) break; chain.unshift(rowL[i]); }
          const joined = chain.length > 1 ? dmTail(dmCleanLabel(chain.map((p) => p.s).join(" ")), 80) : "";
          if (joined && joined.replace(/[^A-Za-z]/g, "").length >= 5) lab = joined;
        }
        if (!lab) {
          const bot = f.y + f.h;
          const below = phr.filter((p) => p.y - bot > 0 && p.y - bot <= 0.04 && Math.min(p.x1, x1) - Math.max(p.x0, x0) > 0 && p.s.length <= 80).sort((a, b) => a.y - b.y)[0];
          if (below) lab = clean(below);
        }
        if (!lab) {
          const above = phr.filter((p) => f.y - p.y > 0 && f.y - p.y <= 0.035 && Math.min(p.x1, x1) - Math.max(p.x0, x0) > 0 && p.s.length <= 45).sort((a, b) => b.y - a.y)[0];
          if (above) {
            // a caption that already sits right under another blank belongs to that blank; this line is just the closing rule
            const owned = list.some((g) => g !== f && g.type === "text" && Math.min(g.x + g.w, above.x1) - Math.max(g.x, above.x0) > 0 && (g.y + g.h) < above.cy && above.y - (g.y + g.h) <= 0.045 && (g.y + g.h) < f.y + f.h);
            if (owned) { if (f.y + f.h - above.y <= 0.03) f._drop = true; /* else: a real blank whose caption the OCR missed; keep it unnamed */ } else lab = clean(above);
          }
        }
      }
      if (lab && lab.length > 1) {
        f.label = lab;
        if (!isCheck) {
          f.type = dmTypeFor(lab, "text");
          if (f.type === "signature" || f.type === "countersignature") { const nh = 0.045; f.y -= nh - f.h; f.h = nh; }
        }
      }
    });
  } catch (_) { /* keep "Blank n": the admin can name them in the editor */ }
  // a blank must not sit on top of the caption printed just above it
  if (phrOut) list.forEach((f) => {
    if (f.type !== "text" && f.type !== "date") return;
    const above = phrOut.filter((p) => p.y > f.y + 0.002 && p.y < f.y + f.h * 0.9 && Math.min(p.x1, f.x + f.w) - Math.max(p.x0, f.x) > 0.3 * (p.x1 - p.x0) && p.cy < f.y + f.h * 0.5).sort((a, b) => b.y - a.y)[0];
    if (above) { const ny2 = above.y + 0.002, bottom = f.y + f.h; if (bottom - ny2 >= 0.012) { f.y = ny2; f.h = bottom - ny2; } }
  });
  if (list.some((f) => f._drop)) { const keepL = list.filter((f) => !f._drop); keepL._phr = phrOut; return keepL; }
  list._phr = phrOut;
  return list;
}

async function dmDetectPage(page, pdfjs) {
  const blanks = [];
  const phr = await tsPagePhrases(page, { blanks });
  dmStats.text += phr.length;
  if (phr.length < 15) { const r = await dmDetectRaster(page); dmStats.raster = (dmStats.raster || 0) + 1; return await dmOcrLabel(page, r); }
  const { shapes, W, H } = await dmPageShapes(page, pdfjs);
  const sc = W / 612;
  const fh = 17 * sc / H, sigH = 38 * sc / H;
  const nx = (v) => v / W, ny = (v) => v / H;
  const cands = []; // { shape, x0, x1, y (bottom/baseline), box?: {y0,y1} }

  // Lines of underscores typed into the text, and checkbox glyphs
  blanks.forEach((b) => {
    if (b.kind === "line") cands.push({ shape: "line", x0: b.x0, x1: b.x1, y: b.y + 0.002 });
    else cands.push({ shape: "checkbox", x0: b.x0, x1: b.x1, y0: b.y - b.h * 0.85, y1: b.y + b.h * 0.1 });
  });
  // Drawn lines
  shapes.h.forEach((l) => {
    const len = (l.x1 - l.x0);
    if (len < 40 * sc || len > 0.8 * W) return;
    const x0 = nx(l.x0), x1 = nx(l.x1), y = ny(l.y);
    if (y > DM_FOOTER_Y) return;
    // a table's border or an underlined word, not a blank to write on
    const hit = (x) => shapes.v.some((v) => Math.abs(v.x - x) < 2 && v.y0 - 2 <= l.y && v.y1 + 2 >= l.y);
    if (hit(l.x0) && hit(l.x1)) return;
    const under = phr.some((p) => {
      const ov = Math.min(p.x1, x1) - Math.max(p.x0, x0);
      return ov / (x1 - x0) > 0.6 && y - p.y >= -0.1 * p.h && y - p.y <= 0.45 * p.h;
    });
    if (under) return;
    cands.push({ shape: "line", x0, x1, y });
  });
  // Drawn boxes: checkboxes (small squares) and empty boxes to type in
  shapes.rect.forEach((r) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (w > 0.7 * W || h > 0.7 * H) return;
    const x0 = nx(r.x0), x1 = nx(r.x1), y0 = ny(r.y0), y1 = ny(r.y1);
    if (y1 > DM_FOOTER_Y) return;
    if (w >= 6 * sc && w <= 26 * sc && h >= 6 * sc && h <= 26 * sc && Math.abs(w - h) <= 0.25 * Math.max(w, h)) {
      cands.push({ shape: "checkbox", x0, x1, y0, y1 }); return;
    }
    if (h >= 10 * sc && h <= 50 * sc && w >= 45 * sc) {
      const hasText = phr.some((p) => p.cx > x0 && p.cx < x1 && p.cy > y0 && p.cy < y1);
      if (hasText) return;
      // box made of lines drawn separately would already be skipped; this is a filled/stroked empty rectangle
      cands.push({ shape: "box", x0, x1, y0, y1, y: y1 });
    }
  });

  // Drop duplicates (e.g. underscores over a drawn line)
  const keep = [];
  cands.forEach((c) => {
    const cy = c.shape === "line" ? c.y : (c.y0 + c.y1) / 2;
    const dup = keep.find((k) => {
      const ky = k.shape === "line" ? k.y : (k.y0 + k.y1) / 2;
      const ov = Math.min(k.x1, c.x1) - Math.max(k.x0, c.x0);
      return k.shape === c.shape && ov > 0.5 * Math.min(k.x1 - k.x0, c.x1 - c.x0) && Math.abs(ky - cy) < 0.012;
    });
    if (!dup) keep.push(c);
  });

  const near = (p, row, tol) => Math.abs(p.y - row) <= tol;
  const labelFor = (c) => {
    const text = (p) => dmCleanLabel(p.s);
    if (c.shape === "checkbox") {
      const mid = (c.y0 + c.y1) / 2;
      const right = phr.filter((p) => p.x0 >= c.x1 - 0.004 && p.x0 - c.x1 < 0.05 && Math.abs(p.cy - mid) < 0.014).sort((a, b) => a.x0 - b.x0)[0];
      if (right) return text(right);
      const left = phr.filter((p) => p.x1 <= c.x0 + 0.004 && c.x0 - p.x1 < 0.4 && Math.abs(p.cy - mid) < 0.014).sort((a, b) => b.x1 - a.x1)[0];
      return left ? text(left) : "";
    }
    const row = c.shape === "box" ? (c.y0 + c.y1) / 2 : c.y - 0.006;
    const left = phr.filter((p) => p.x1 <= c.x0 + 0.01 && c.x0 - p.x1 < 0.3 && Math.abs(p.cy - row) < 0.013).sort((a, b) => b.x1 - a.x1)[0];
    if (left) return text(left);
    const top = c.shape === "box" ? c.y0 : c.y;
    const below = phr.filter((p) => p.y - c.y > 0 && p.y - c.y <= 0.06 && Math.min(p.x1, c.x1) - Math.max(p.x0, c.x0) > 0 && p.s.length <= 40).sort((a, b) => a.y - b.y)[0];
    if (below && c.shape === "line") return text(below);
    const above = phr.filter((p) => top - p.y > 0 && top - p.y <= 0.04 && Math.min(p.x1, c.x1) - Math.max(p.x0, c.x0) > 0 && p.s.length <= 45).sort((a, b) => b.y - a.y)[0];
    if (above && c.shape === "line") {
      // caption already sitting under another line: this line is just the closing rule
      const owned = keep.some((k) => k !== c && k.shape === "line" && Math.min(k.x1, above.x1) - Math.max(k.x0, above.x0) > 0 && k.y < above.cy && above.y - k.y <= 0.045);
      if (owned) { c._drop = true; return ""; }
    }
    return above ? text(above) : "";
  };

  // The wording around a blank (same row to its left, the caption just below, the line above), so a vague label can be understood later.
  const ctxFor = (c) => {
    const row = c.shape === "line" || c.shape === "box" ? (c.shape === "box" ? (c.y0 + c.y1) / 2 : c.y - 0.006) : (c.y0 + c.y1) / 2;
    const x0 = c.x0, x1 = c.x1, bot = c.shape === "box" ? c.y1 : (c.y1 !== undefined ? c.y1 : c.y), top = c.shape === "box" ? c.y0 : (c.y0 !== undefined ? c.y0 : c.y);
    const parts = [];
    { const rowL = phr.filter((p) => p.x1 <= x0 + 0.01 && x0 - p.x1 < 0.8 && Math.abs(p.cy - row) < 0.013).sort((a, b) => a.x0 - b.x0); if (rowL.length) parts.push(dmTail(dmCleanLabel(rowL.map((p) => p.s).join(" ")), 80)); }
    phr.filter((p) => p.y - bot > 0 && p.y - bot <= 0.05 && Math.min(p.x1, x1 + 0.15) - Math.max(p.x0, x0 - 0.15) > 0 && p.s.length <= 60).sort((a, b) => a.y - b.y).slice(0, 2).forEach((p) => parts.push(dmCleanLabel(p.s)));
    phr.filter((p) => top - p.y > 0 && top - p.y <= 0.045 && Math.min(p.x1, x1) - Math.max(p.x0, x0) > 0 && p.s.length <= 70).sort((a, b) => b.y - a.y).slice(0, 1).forEach((p) => parts.push(dmCleanLabel(p.s)));
    return [...new Set(parts.filter(Boolean))].join(" | ").slice(0, 220);
  };
  const fields = [];
  keep.forEach((c) => {
    const label = labelFor(c);
    if (c._drop) return;
    const type = dmTypeFor(label, c.shape);
    if (c.shape === "checkbox") {
      const side = Math.min(Math.max(c.x1 - c.x0, 8 * sc / W), 22 * sc / W), cyc = (c.y0 + c.y1) / 2;
      fields.push({ type, label: label || "Checkbox", x: (c.x0 + c.x1) / 2 - side / 2, y: cyc - side * (W / H) / 2, w: side, h: side * (W / H), _u: !label, ctx: ctxFor(c) });
    } else if (c.shape === "box") {
      const isSig = type === "signature" || type === "countersignature";
      fields.push({ type, label: label || FIELD_KINDS[type].label, x: c.x0 + 0.002, y: c.y0 + 0.002, w: Math.max(0.03, c.x1 - c.x0 - 0.004), h: Math.max(0.012, c.y1 - c.y0 - 0.004), _u: !label, ctx: ctxFor(c) });
    } else {
      const isSig = type === "signature" || type === "countersignature";
      const h = isSig ? sigH : fh;
      const w = Math.min(c.x1 - c.x0, isSig ? 0.4 : 0.6);
      fields.push({ type, label: label || FIELD_KINDS[type].label, x: c.x0, y: c.y - h + 0.003, w, h, _u: !label, ctx: ctxFor(c) });
    }
  });

  // Cues with no drawn blank: "AGREED TO AND ACCEPTED:" with empty space beneath,
  // or "Name:" with nothing after it
  const overlapsField = (x, y, w, h) => fields.some((f) => Math.min(f.x + f.w, x + w) - Math.max(f.x, x) > 0 && Math.min(f.y + f.h, y + h) - Math.max(f.y, y) > 0);
  const body = phr.filter((p) => p.y < DM_FOOTER_Y);
  body.forEach((p) => {
    const s = p.s.trim();
    const endsColon = /:\s*$/.test(s);
    const rowRight = body.some((q) => q !== p && Math.abs(q.cy - p.cy) < 0.6 * p.h && q.x0 >= p.x1 - 0.002 && q.x0 - p.x1 < 0.4);
    if (DM_SIG_RE.test(s) && (endsColon || s.length < 36) && !rowRight) {
      const nextBelow = body.filter((q) => q.y - p.y > p.h * 0.5 && Math.min(q.x1, p.x0 + 0.4) > p.x0 && q.x0 < p.x0 + 0.4).sort((a, b) => a.y - b.y)[0];
      const room = (nextBelow ? nextBelow.y - p.h : DM_FOOTER_Y) - p.y;
      if (room < sigH + 0.01) return;
      const x = p.x0, y = p.y + 0.012, w = 0.34;
      if (overlapsField(x, y, w, sigH) || overlapsField(p.x0, p.y - 0.07, 0.3, 0.07)) return;
      const type = DM_COUNTER_RE.test(s) && !/employee|contractor|crew|acknowledg/i.test(s) ? "countersignature" : "signature";
      fields.push({ type, label: type === "signature" ? "Employee signature" : "Company signature", x, y, w, h: sigH });
      if (!overlapsField(x + w + 0.04, y, 0.16, fh) && !phr.some((q) => /\bdate\b/i.test(q.s) && Math.abs(q.y - (y + sigH)) < 0.05)) {
        fields.push({ type: "date", label: "Date", x: x + w + 0.04, y: y + sigH - fh, w: 0.16, h: fh });
      }
    } else if (endsColon && s.length <= 32 && s.split(/\s+/).length <= 4 && /^[A-Z#]/.test(s) && !/^(\d+|[A-Za-z])[.)]\s/.test(s) && !rowRight && p.x1 < 0.8 && !/^(note|notes|terms|schedule)\b/i.test(s) && !DM_SIG_RE.test(s)) {
      const x = p.x1 + 0.01, w = Math.min(0.32, 0.93 - x), y = p.y - fh + 0.004;
      if (w < 0.1 || overlapsField(x, y, w, fh)) return;
      const label = dmCleanLabel(s);
      const type = dmTypeFor(label, "text");
      // "Label:" followed by a normal paragraph line is not a blank; require clear space below too
      fields.push({ type, label, x, y, w, h: fh });
    }
  });

  // Page full of unlabelled blanks is almost certainly a table or decoration
  const unlabelled = fields.filter((f) => f._u).length;
  const outF = fields.filter((f) => !(unlabelled > 12 && f._u)).slice(0, 60).map((f) => { delete f._u; return f; });
  outF._phr = phr;
  return outF;
}

// Forms that already have fillable boxes use those exact positions.
async function dmDetectAcro(bytes) {
  const L = await ensurePdfLib();
  let doc, form;
  try { doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true }); form = doc.getForm(); } catch (_) { return []; }
  const pages = doc.getPages();
  const out = [];
  for (const field of form.getFields()) {
    const isCheck = field instanceof L.PDFCheckBox, isText = field instanceof L.PDFTextField;
    const isSigField = field.constructor && field.constructor.name === "PDFSignature";
    if (!isCheck && !isText && !isSigField) continue;
    const name = field.getName();
    const label = dmCleanLabel(name.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
    const type = isCheck ? "checkbox" : dmTypeFor(label, "text") === "signature" || isSigField ? "signature" : dmTypeFor(label, "text");
    for (const w of field.acroField.getWidgets()) {
      const r = w.getRectangle();
      let pi = pages.findIndex((pg) => w.P() && pg.ref.toString() === w.P().toString());
      if (pi < 0) pi = 0;
      const { width: W, height: H } = pages[pi].getSize();
      out.push({ type, label: label || FIELD_KINDS[type].label, page: pi, x: r.x / W, y: 1 - (r.y + r.height) / H, w: r.width / W, h: r.height / H });
    }
  }
  return out;
}

let dmLastErr = "";
async function dmDetectFields(pdf, bytes) {
  dmLastErr = ""; Object.assign(dmStats, { h: 0, v: 0, rect: 0, ops: 0, text: 0 });
  let found = await dmDetectAcro(bytes);
  if (found.length < 2) {
    const pdfjs = await ensurePdfJs();
    found = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      let list = [];
      try { list = await dmDetectPage(page, pdfjs); } catch (e) { dmLastErr = e && e.message || String(e); }
      list = dmFindAlternatives(list, list._phr, n - 1);
      list.forEach((f) => found.push({ ...f, page: n - 1 }));
    }
  }
  return found.map((f) => {
    const x = clamp(f.x, 0, 0.99), y = clamp(f.y, 0, 0.99);
    return { ...f, id: "f" + Math.random().toString(36).slice(2, 8), auto: true, bind: dmGuessBind(f.label, f.type) || undefined, x, y, w: clamp(f.w, 0.015, 1 - x), h: clamp(f.h, 0.008, 1 - y) };
  });
}

async function autoPlaceFields() {
  const pdfjs = await ensurePdfJs();
  const pdf = await pdfjs.getDocument({ data: tplPdf.bytes.slice(0) }).promise;
  const found = await dmDetectFields(pdf, tplPdf.bytes);
  tplPdf.fields = tplPdf.fields.filter((f) => !f.auto).concat(found);
  drawEditorFields();
  return found.length;
}
async function runAutoPlace(msgEl) {
  msgEl.innerHTML = `<div class="msg ok">Looking for the blanks on your PDF (scanned pages take a little longer while the labels are read)…</div>`;
  try {
    const n = await autoPlaceFields();
    const hasSig = tplPdf.fields.some((f) => f.type === "signature");
    msgEl.innerHTML = n
      ? `<div class="msg ok">Placed ${n} field${n === 1 ? "" : "s"} automatically. Drag to nudge, resize from the corner, or Remove any that are wrong.${hasSig ? "" : " No employee signature spot was found. Add one with the Employee signature button."}</div>`
      : `<div class="msg ok">Couldn't spot any blanks on this PDF${dmLastErr ? ` (${escHtml(dmLastErr)})` : ` (${dmStats.raster ? "this looks like a scanned page. " : ""}read ${dmStats.text} text pieces, ${dmStats.h} lines, ${dmStats.rect} boxes)`}. Click the page to add fields yourself.</div>`;
  } catch (err) {
    msgEl.innerHTML = `<div class="msg error">Auto-detect failed (${escHtml(err.message || "unknown error")}). You can still add fields by clicking the page.</div>`;
  }
}
// Keeps the admin's boxes and names, but adds surrounding context and rewrites vague names.
async function dmRefreshWording() {
  const pdfjs = await ensurePdfJs();
  const pdf = await pdfjs.getDocument({ data: tplPdf.bytes.slice(0) }).promise;
  const found = await dmDetectFields(pdf, tplPdf.bytes);
  let n = 0, n2 = 0;
  tplPdf.fields.forEach((f) => {
    const c = found.find((g) => g.page === f.page && g.type === f.type && Math.abs((g.x + g.w / 2) - (f.x + f.w / 2)) < 0.04 && Math.abs((g.y + g.h / 2) - (f.y + f.h / 2)) < 0.025);
    if (c && c.alt && !f.alt) { f.alt = c.alt; n2++; }
    if (f.type !== "text" && f.type !== "date") return;
    if (c && c.ctx) f.ctx = c.ctx;
    const lab = dmCleanLabel(f.label).replace(/\s*\((optional|facultatif)\)\s*$/i, "");
    if (dmVague(lab) || /^blank \d+$/i.test(lab) || /^(text|date)$/i.test(lab)) {
      const r = dmResolveField(f);
      const nl = r.label.en || "";
      if (nl && nl !== lab && !r.skip) { f.label = nl; n++; }
      else if (r.skip && r.key === "sin") { f.label = "Social insurance number (S.I.N.)"; n++; }
    }
  });
  dmAltLinked = n2;
  return n;
}
let dmAltLinked = 0;
// ---- end auto-place ----
