function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function weekStartOf(d) { return addDays(d, -d.getDay()); }
function fmtShort(d) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function periodLabel(startStr) {
  const s = parseYmd(startStr), e = addDays(s, 6);
  return `${fmtShort(s)} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
function fmtTime(v) {
  if (!v) return "-";
  const [h, m] = v.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${pad2(m)} ${h < 12 ? "AM" : "PM"}`;
}
function fmtHours(mins) { return (mins / 60).toFixed(2); }
function toMinutes(v) { if (!v) return null; const [h, m] = v.split(":").map(Number); return h * 60 + m; }

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
