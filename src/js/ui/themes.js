// ---- Themes: preset colour palettes, each with a light and a dark version ----
// A company stores its preset (companies.theme) and companies.dark_mode. applyTheme() sets every
// colour token in base.css, so buttons, links, highlights, the top bar and the page itself follow
// the theme. The last theme is remembered in this browser so the page doesn't flash on load.
const THEME_PRESETS = [
  { id: "classic", name: "Classic", primary: "#1a1a1a", accent: "#b4550b", bar: "#ffd23f", warm: true, dark: { primary: "#c4651a", link: "#f0a35e", bar: "#ffd23f" } },
  { id: "midnight", name: "Midnight", primary: "#111827", accent: "#4f46e5", bar: "#818cf8", dark: { primary: "#5b54e8", link: "#a5b4fc", bar: "#818cf8" } },
  { id: "forest", name: "Forest", primary: "#14321f", accent: "#2f7d4a", bar: "#7ccf96", dark: { primary: "#2f8a52", link: "#86d6a0", bar: "#7ccf96" } },
  { id: "ocean", name: "Ocean", primary: "#0b2a3c", accent: "#0e7490", bar: "#5fd0e6", dark: { primary: "#0f86a6", link: "#6fd3e8", bar: "#5fd0e6" } },
  { id: "crimson", name: "Crimson", primary: "#2a0f12", accent: "#b42332", bar: "#f29aa3", dark: { primary: "#c4303f", link: "#f5a3ab", bar: "#f29aa3" } },
  { id: "plum", name: "Plum", primary: "#2b1630", accent: "#8b3fa8", bar: "#d4a3e6", dark: { primary: "#9a4dba", link: "#d9abec", bar: "#d4a3e6" } },
];
const THEME_KEY = "intake_theme";

function hexToRgb(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// t of a, (1 - t) of b
function mixHex(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}

// Every colour token for a preset (or a legacy company with only custom colours) in light or dark.
function themePalette(themeId, dark, custom) {
  const p = THEME_PRESETS.find((t) => t.id === themeId);
  if (dark) {
    const d = p ? p.dark : { primary: (custom && custom.accent) || "#c4651a", link: mixHex((custom && custom.accent) || "#b4550b", "#ffffff", 0.55), bar: "#ffd23f" };
    const surface = "#1c1d21", page = "#131417";
    return {
      "--ink": "#ececef", "--ink-soft": "#b5b6bd", "--ink-faint": "#83858e", "--line": "#2f3137",
      "--surface": surface, "--page": page,
      "--accent": d.primary, "--accent-hover": mixHex(d.primary, "#ffffff", 0.85),
      "--link": d.link, "--link-hover": mixHex(d.link, "#ffffff", 0.8), "--on-link": "#101215",
      "--accent-soft": mixHex(d.primary, surface, 0.2), "--accent-soft-hover": mixHex(d.primary, surface, 0.32),
      "--brand-yellow": d.bar,
      "--error": "#f08b7c", "--error-soft": "#3a201d", "--ok": "#6ccf98", "--ok-soft": "#173022",
      "--warn": "#e7b064", "--warn-soft": "#382b17", "--info": d.link, "--info-soft": mixHex(d.primary, surface, 0.2),
      "--shadow": "0 1px 2px rgba(0,0,0,0.3), 0 1px 12px rgba(0,0,0,0.25)",
    };
  }
  const primary = p ? p.primary : (custom && custom.primary) || "#1a1a1a";
  const accent = p ? p.accent : (custom && custom.accent) || "#b4550b";
  const warm = p ? !!p.warm : true;
  return {
    "--ink": "#1a1a1a",
    "--ink-soft": warm ? "#5c5648" : "#52545c", "--ink-faint": warm ? "#9a927e" : "#8b8d96",
    "--line": warm ? "#ece4cf" : mixHex(accent, "#e6e7eb", 0.06),
    "--surface": "#ffffff", "--page": warm ? "#fbf8f0" : mixHex(accent, "#f7f7f9", 0.03),
    "--accent": primary, "--accent-hover": mixHex(primary, "#000000", 0.8),
    "--link": accent, "--link-hover": mixHex(accent, "#000000", 0.8), "--on-link": "#ffffff",
    "--accent-soft": p && p.id === "classic" ? "#fdf0cd" : mixHex(accent, "#ffffff", 0.13),
    "--accent-soft-hover": p && p.id === "classic" ? "#fbe4a6" : mixHex(accent, "#ffffff", 0.24),
    "--brand-yellow": p ? p.bar : "#ffd23f",
    "--error": "#b3402f", "--error-soft": "#fbebe8", "--ok": "#1f7a4d", "--ok-soft": "#e7f5ee",
    "--warn": "#a8681b", "--warn-soft": "#fbf1e2", "--info": accent,
    "--info-soft": p && p.id === "classic" ? "#fdf0cd" : mixHex(accent, "#ffffff", 0.13),
    "--shadow": "0 1px 2px rgba(20,24,28,0.04), 0 1px 12px rgba(20,24,28,0.05)",
  };
}

// The preset that matches a company's saved colours (companies made before presets existed).
function themeForCompany(company) {
  if (company && company.theme && THEME_PRESETS.some((t) => t.id === company.theme)) return company.theme;
  const m = company && THEME_PRESETS.find((t) => t.primary === company.primary_color && t.accent === company.accent_color);
  return m ? m.id : null;
}

function applyTheme(themeId, dark, custom, remember) {
  const vars = themePalette(themeId, !!dark, custom);
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.mode = dark ? "dark" : "light";
  if (remember) { try { localStorage.setItem(THEME_KEY, JSON.stringify({ themeId, dark: !!dark, custom: custom || null })); } catch (_) {} }
}
function applyCompanyTheme(company) {
  const id = themeForCompany(company);
  applyTheme(id, !!(company && company.dark_mode), id ? null : { primary: company && company.primary_color, accent: company && company.accent_color }, true);
}
function forgetTheme() {
  try { localStorage.removeItem(THEME_KEY); } catch (_) {}
}

// Theme picker: preset cards (previewed in the chosen mode) and a dark-mode switch.
// onChange({ themeId, dark }) runs on every change; the caller decides when to save.
function renderThemePicker(container, initial, onChange) {
  let state = { themeId: initial.themeId || "classic", dark: !!initial.dark };
  const draw = () => {
    container.innerHTML = `<div class="ob-themes">${THEME_PRESETS.map((t) => {
      const v = themePalette(t.id, state.dark);
      const on = t.id === state.themeId;
      return `<button type="button" class="ob-theme${on ? " on" : ""}" data-theme="${t.id}" aria-pressed="${on}">
        <span class="ob-theme-prev" style="--pg:${v["--page"]};--sf:${v["--surface"]};--ln:${v["--line"]};--bar:${v["--brand-yellow"]};--p:${v["--accent"]};--a:${v["--link"]};--soft:${v["--accent-soft"]}"><i></i><b><em></em><u></u></b></span>${t.name}</button>`;
    }).join("")}</div>
    <label class="theme-dark"><input type="checkbox" ${state.dark ? "checked" : ""} /><span class="theme-switch" aria-hidden="true"></span>Dark mode</label>`;
    container.querySelectorAll(".ob-theme").forEach((b) => b.addEventListener("click", () => { state = { ...state, themeId: b.dataset.theme }; draw(); onChange(state); }));
    container.querySelector(".theme-dark input").addEventListener("change", (e) => { state = { ...state, dark: e.target.checked }; draw(); onChange(state); });
  };
  draw();
  return () => state;
}

// Before anything else draws: the theme this browser last used.
(function () {
  try {
    const t = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
    if (t) applyTheme(t.themeId, t.dark, t.custom, false);
  } catch (_) {}
})();
