# HR Intake Portal

Onboarding, timesheets, deal memos and payroll for film and TV crews. A static site
(`index.html` + `src/`) backed by Supabase (database, auth, storage, Edge Functions).

## Run it locally

1. Copy the config template and fill in your Supabase project's URL and publishable key
   (Supabase dashboard > Project Settings > API):
   ```bash
   cp src/js/config.example.js src/js/config.js
   ```
2. Serve the folder (opening `index.html` from disk won't load the scripts):
   ```bash
   python3 -m http.server 5173
   ```
3. Open http://localhost:5173.

## Backend

Everything the database needs is in `supabase/`:

| Path | What it is |
|---|---|
| `supabase/migrations/` | Tables, row-level security, app functions, storage buckets, audit log. Apply in order. |
| `supabase/functions/delete-user/` | Deletes auth accounts (needs the service-role key, so it runs server-side). |
| `supabase/functions/send-invite-email/` | Emails invites through Resend. |

## Secrets: where each one lives

| Value | Where | Committed? |
|---|---|---|
| Supabase URL + **publishable** key | `src/js/config.js` (browser) | No (gitignored). Safe to expose by design; row-level security protects the data. |
| **Service-role** key | Supabase Edge Function runtime (provided automatically) | Never. Never put it in the browser or this repo. |
| `RESEND_API_KEY`, `INVITE_FROM`, `PORTAL_URL` | Supabase Edge Function secrets | No. Set with `supabase secrets set ...` or in the dashboard under Edge Functions > Secrets. |

## Hosting (Cloudflare Pages, Netlify, Vercel)

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and optionally `PORTAL_URL` as environment
variables on the host, use `sh scripts/write-config.sh` as the build command, and serve the
repository root. Add the site's URL to Supabase under Authentication > URL Configuration.

## First super admin

Sign up in the portal, then in the Supabase SQL editor:
```sql
insert into public.superadmins (user_id)
select id from auth.users where email = 'you@example.com';
```
The Super Admin tab then lets you create companies and invite their admins.
