// ---- Configuration ----
const SUPABASE_URL = "https://wywlcvnlzeylmaglfkod.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lgGcPg15iVBslMSbCK_zZw_gZhoLbYI";
// -----------------------

const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
