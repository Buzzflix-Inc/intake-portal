// Copy this file to src/js/config.js and fill in your Supabase project's values
// (Supabase dashboard > Project Settings > API). config.js is gitignored.
//
// Only the publishable key belongs here: it is meant to be visible in the browser,
// and row-level security in supabase/migrations decides what it can reach.
// Never put the service-role key or any other secret in this file.
window.APP_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabasePublishableKey: "sb_publishable_...",
  // Where people open the portal; used in invite links. Defaults to the current page.
  portalUrl: "",
};
