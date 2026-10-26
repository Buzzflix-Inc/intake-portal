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
| `supabase/functions/passkey/` | Registers passkeys and signs people in with them. Deployed without JWT verification (it checks callers itself). |
| `supabase/functions/test-login/` | Local test mode: signs in `@example.com` addresses without email (see "Test mode"). |
| `supabase/templates/sign-in-code.html` | Email template with the 6-digit sign-in code (see below). |

## Sign-in: emailed codes and passkeys (no passwords)

People sign in with a 6-digit code (or the link in the same email), or a passkey. New emails
get an account automatically, accept the Terms and Privacy Notice, then either create a
production (and are walked through setting it up) or wait for an invite.

One-time setup in the Supabase dashboard:

1. **Authentication > Emails:** paste `supabase/templates/sign-in-code.html` into both the
   **Magic link or OTP** and **Confirm sign up** templates, with the subject
   `Your HR Intake Portal code: {{ .Token }}`. Without this the emails only contain a link.
2. **Authentication > Providers > Email:** set **Email OTP length** to 6.
3. **Authentication > URL Configuration:** the Site URL and redirect URLs must include where
   the portal runs (e.g. `http://localhost:5173`).
4. Before launch, set up custom SMTP (e.g. Resend) under **Authentication > Emails > SMTP**.
   Supabase's built-in sender only allows a few emails an hour.
5. Passkeys work on `localhost:5173`/`5174` and on `PORTAL_URL`. For other sites, set the
   `PASSKEY_ORIGINS` Edge Function secret (comma-separated origins).

Production admins must also use an authenticator app, and get 10 backup codes (copy or PDF).
A backup code removes a lost authenticator so a new one can be set up.

The Terms of Service and Privacy Notice are `terms.html` and `privacy.html`. They're drafts:
have them reviewed and fill in the bracketed details. When you change them, bump
`TERMS_VERSION` in `src/js/auth/onboarding.js` so everyone is asked to accept the new version.

## Test mode (local only, remove before production)

While email can only reach your own inbox, any address ending in `@example.com` (or `.org`/`.net`)
can sign in on your local copy instantly, without email: `crew1@example.com`, `producer@example.com`...
New addresses get a fresh account, so you can try creating and joining productions as many people.

How it's locked down: the `test-login` Edge Function only works while
`public.test_login_settings.enabled` is true, only for those reserved domains (nobody can own a
real account there), and only with the key in your gitignored `src/js/config.js` (`testLoginKey`),
whose SHA-256 hash is in that table. Real addresses always go through email.

- Turn it off: `update public.test_login_settings set enabled = false;`
- New key: put a random string in `testLoginKey`, then
  `update public.test_login_settings set key_hash = encode(extensions.digest('<key>', 'sha256'), 'hex'), enabled = true;`
- Before production: delete the `test-login` function and drop `public.test_login_settings`.

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

Sign in to the portal once, then in the Supabase SQL editor:
```sql
insert into public.superadmins (user_id)
select id from auth.users where email = 'you@example.com';
```
The All Companies tab then lets you create companies and invite their admins.
