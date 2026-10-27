// ---- Configuration ----
// Values come from src/js/config.js (gitignored); see config.example.js.
const APP_CONFIG = window.APP_CONFIG || {};
const SUPABASE_URL = APP_CONFIG.supabaseUrl;
const SUPABASE_ANON_KEY = APP_CONFIG.supabasePublishableKey;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  document.getElementById("authMsg").innerHTML =
    `<div class="msg error">The portal isn't configured. Copy src/js/config.example.js to src/js/config.js and add your Supabase URL and publishable key.</div>`;
  throw new Error("Missing src/js/config.js");
}
// -----------------------

// Shared test environment: a tag in the corner so nobody mistakes it for the real portal.
if (APP_CONFIG.environment) {
  const tag = document.createElement("div");
  tag.className = "env-tag";
  tag.textContent = APP_CONFIG.environment;
  document.body.appendChild(tag);
}

const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
