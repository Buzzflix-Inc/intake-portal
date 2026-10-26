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

const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
