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

## Shared staging environment (for the whole team)

Everyone, on every device, tests against one Supabase project (`htdydskyvduyroswpmee`) and one
hosted site, so a record one person creates is what everyone else sees.

| Piece | How it works |
|---|---|
| Database, auth, storage | The staging Supabase project. Ask the owner to invite you to the Buzzflix organization. |
| Schema changes | Add a file to `supabase/migrations/` (name it `YYYYMMDDHHMMSS_name.sql`, later than the last one) and merge to `main`. `.github/workflows/deploy-supabase.yml` runs `supabase db push` and redeploys the Edge Functions. Pull requests get a dry run. Never change tables in the dashboard or apply migrations by hand. |
| Hosted site | Vercel builds `main` to the staging URL and every pull request to a preview URL, with `sh scripts/write-config.sh` and `APP_ENV=staging`. |
| Local copy | Copy `src/js/config.example.js` to `src/js/config.js` with the staging URL and publishable key (Project Settings > API). Ask a teammate for `testLoginKey`. |
| Sign-in emails | Supabase's built-in sender. It only delivers to members of the Supabase organization, a few an hour, so use test mode or demo mode for most testing. |
| Invite emails | Resend, from `onboarding@resend.dev` until a domain is verified. That sender only delivers to the Resend account owner; use **Copy Invite** for everyone else. |
| Shared test data | Demo mode (`demo@demo.example.com`, Reset demo puts it back) and test mode (`@example.com`, local only). |

**Who can sign up:** while `public.signup_allowlist_settings.enabled` is true, new accounts are only
created for addresses in `public.signup_allowlist`, anyone with a pending invite, and the reserved
`@example.com` / `@demo.example.com` test addresses. Everyone who already had an account was added.

```sql
insert into public.signup_allowlist (email, note) values ('name@company.com', 'Developer');
```

The check is the Postgres function `public.hook_signup_allowlist`, turned on under
**Authentication > Hooks > Before User Created**. Turn it off for production:
`update public.signup_allowlist_settings set enabled = false;`

Test mode stays off on hosted sites: `write-config.sh` never writes `testLoginKey`.

## Backend

Everything the database needs is in `supabase/`:

| Path | What it is |
|---|---|
| `supabase/migrations/` | Tables, row-level security, app functions, storage buckets, audit log. Apply in order. |
| `supabase/functions/delete-user/` | Deletes auth accounts (needs the service-role key, so it runs server-side). |
| `supabase/functions/send-invite-email/` | Emails invites through Resend. |
| `supabase/functions/send-reminder/` | Emails crew (and posts a notification) listing what they still owe for onboarding. Uses the same Resend secrets. |
| `supabase/functions/passkey/` | Registers passkeys and signs people in with them. Deployed without JWT verification (it checks callers itself). |
| `supabase/functions/test-login/` | Local test mode: signs in `@example.com` addresses without email (see "Test mode"). |
| `supabase/functions/demo/` | Demo mode: signs in the demo accounts and resets the demo production (see "Demo mode"). |
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

## Admin overview and Company Settings

Admins land on **My Portal > Overview**: a summary of crew onboarding progress (how many are fully
onboarded, how many are at each stage, and who's still in progress). Branding and the approval chain live in their own **Company Settings** tab.

## Onboarding progress and files (Manage Crew > Employees)

Each person shows a progress bar of their onboarding steps: joined, documents uploaded, documents
approved, forms signed, forms countersigned (steps that don't apply to them are left out). When the
last step is done, admins and the person's department heads get a "Fully onboarded" notification in
the bell. The steps are worked out in the database (`onboarding_steps`), so they stay right however
the records change; `company_memberships.onboarded_at` records when someone finished.

Each person's overview lists all their files (documents, timesheets, invoices, paystubs, signed forms),
newest first, filterable by type and date and downloadable as a .zip. "Files by person" at the top of
Employees shows everyone's files grouped under each person's name (then by type), with a name search,
the same type and date filters, a .zip per person and one .zip for everyone with a folder per person.

## Onboarding tracker and reminders (Manage Crew > Onboarding tracker)

One list of everyone at the production, including people invited who haven't signed in: their stage
(the counts at the top filter the list), what they still owe (uploads, re-uploads of rejected
documents, forms to sign) or whether it's waiting on an admin, and when they were last reminded. Search
by name and filter by department. My Portal > Overview links to it.

**Email reminder** (one person) or **Remind everyone with items outstanding** (everyone in the current
filter) calls the `send-reminder` Edge Function. It works out each person's items in the database
(`onboarding_todo`), emails them through Resend and posts an "Onboarding reminder" notification, and
logs it in `onboarding_reminders`. Anyone reminded in the last 12 hours is skipped. While Resend only
reaches the account owner (staging), other people still get the notification; use **Copy** to send the
reminder yourself. People who haven't signed in get **Resend invite** / **Copy invite** instead.

## Payroll summary (Payroll tab)

One place for accounting to see what to pay for a week. Pick a week (Sunday to Saturday) to see the
total, the amount for each person, and their days (click a row). **Download PDF** gives the summary,
plus each person's days if that box is ticked. Payment itself is done in your payroll software; the
amounts are estimates before deductions.

- **Who sees it:** admins, and anyone an admin gives access with **Give payroll access** in
  Manage Crew > Employees (for an accountant who shouldn't see the rest of Manage Crew).
- **Ready or draft:** a week is ready once everyone expected is approved. Expected means crew who
  aren't admins or contractors and whose start and end dates overlap the week. Until then the summary
  lists who's still pending, rejected or hasn't submitted, and the PDF is marked DRAFT. When the last
  timesheet of a week is approved, everyone with payroll access gets a "Payroll ready" notification.
- **Rates:** set on each person's crew record, per hour, day or week: in the invite form, in their
  overview (Manage Crew > Employees > View), or in the Payroll tab by opening their row. Someone without a
  rate is left out of the total and flagged.
- **Overtime:** for hourly crew, from **Company Settings > Payroll rules** (default 1.5x after 8 hours a
  day, 2x after 12; optional weekly limit). Overtime typed on a timesheet (union forms) is used as entered.
  Day and weekly rates don't get overtime added.
- Kit fees come from the timesheet, and approved contractor invoices dated in the week are included.
- Data comes from the `payroll_week` and `payroll_weeks` database functions, which check access.

## Account pane

Clicking your name in the top right opens your account: your details (name, phone, address, used to
fill in forms), your productions (switch or leave), two-step sign-in (turn on, replace the
authenticator, make new backup codes), passkeys, sign out everywhere, download my data (.zip), the
Terms you accepted, and deleting your account. Emails can't be changed.

- Backup codes are only shown when they're made; only hashes are stored. Making new ones cancels the old.
- Leaving a production, or deleting an account, keeps everything the person submitted with each
  production. The only admin of a production with other people in it must first make someone else an
  admin (Manage Crew > Make admin).
- Deleting needs a fresh check (the authenticator code, or an emailed code for people without one),
  then removes the login with a soft delete in the `delete-user` function, so records still point at it.
  The same email can sign up again later as a new account.

## Demo mode (for showing the portal off)

Sign in as **`demo@demo.example.com`**: no email, no code, no two-step sign-in. It's the admin of
**Silver Harbour**, a demo production whose crew are at different stages of onboarding: fully
onboarded department heads, a deal memo waiting for countersignature, a rejected ID upload, a memo
sent back to re-sign, timesheets at department-head and final review, a contractor with invoices,
paystubs, announcements, and two people who were invited but haven't signed in yet.

While signed in as a demo account, a bar at the bottom of the screen lets you:

- **Switch person:** sign in as any of the demo crew to show their side (sign a memo, upload a
  document, submit a timesheet), then switch back to the admin to approve it. Picking an invited
  person (Olivia or Marcus) walks through the new-hire flow from the Terms screen.
- **Reset demo:** puts everything back to the starting state (takes about 20 seconds), so the demo
  can be run again.

How it's contained: every demo address is `@demo.example.com` (a reserved domain), the `demo` Edge
Function only signs in the accounts it defines, the demo production can only invite demo addresses
(and they can't be invited anywhere else), demo accounts can't create productions, and reset deletes
the demo production and rebuilds it with only made-up data. The crew and their stages are the `PEOPLE`
list in `supabase/functions/demo/index.ts`.

- Turn it off: `update public.demo_settings set enabled = false;`

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
| `RESEND_API_KEY`, `INVITE_FROM`, `PORTAL_URL`, `PASSKEY_ORIGINS` | Supabase Edge Function secrets | No. Set with `supabase secrets set ...` or in the dashboard under Edge Functions > Secrets. |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | GitHub repository secrets (used by the deploy workflow) | No. Settings > Secrets and variables > Actions. |

## Hosting (Cloudflare Pages, Netlify, Vercel)

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and optionally `PORTAL_URL` and `APP_ENV` as environment
variables on the host, use `sh scripts/write-config.sh` as the build command, and serve the
repository root. Add the site's URL to Supabase under Authentication > URL Configuration.

## First super admin

Sign in to the portal once, then in the Supabase SQL editor:
```sql
insert into public.superadmins (user_id)
select id from auth.users where email = 'you@example.com';
```
The All Companies tab then lets you create companies and invite their admins.
