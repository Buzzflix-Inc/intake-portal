# CLAUDE.md

Team rules for the HR Intake Portal. Everyone working on this repo (and their Claude sessions)
shares one Supabase project, one Vercel staging site and this GitHub repo, so a mistake here
affects everyone at once. Read the README for how features work; this file is how we work.

## Where things live

| What | Where |
|---|---|
| Repository (source of truth) | `github.com/jackbuzzflix/intake-portal`, branch `main` |
| Database, auth, storage, Edge Functions | Supabase project `htdydskyvduyroswpmee` (shared staging) |
| Staging site (`main`) | https://intake-portal-staging-buzzflix.vercel.app |
| Preview sites | Vercel builds every branch/PR; the Vercel bot comments the URL on the PR |
| Schema | `supabase/migrations/` |
| Edge Functions | `supabase/functions/<name>/index.ts` |

`EthanHeinze/intake-portal` is the original single-file version. Don't push or open PRs there.

## Claiming work (so two people don't build the same thing)

GitHub Issues are the only way to claim work. Before starting anything:

```bash
gh issue list --repo jackbuzzflix/intake-portal --state open
gh pr list --repo jackbuzzflix/intake-portal --state open
```

- Don't start work that's assigned to someone else or already has an open PR. If it overlaps,
  stop and say so instead of building a second version.
- No issue yet? Create one (`gh issue create --title "..." --body "..."`), then claim it:
  `gh issue edit <number> --add-assignee @me`.
- Right away, push your branch and open a **draft** PR named after the issue, with
  `Closes #<number>` in the body: `gh pr create --draft --title "<issue title>" --body "Closes #<number>"`.
  The draft PR is the signal that the work is in progress, and gives it a preview URL.
- If you stop working on something, unassign yourself and close or comment on the draft PR so
  someone else can pick it up.
- Claude sessions: if the user asks for work that matches someone else's issue or PR, tell them
  before starting.

## Git workflow

- Never commit or push to `main` directly. Branch from the latest `main` as `<yourname>/<short-topic>`
  (Claude sessions: `claude/<short-topic>`), push the branch, open a PR against `main` early
  (draft is fine) so the preview URL exists.
- One topic per PR. Merge only after the other developer has looked at the preview and the
  "Deploy Supabase (staging)" check passes.
- Merging to `main` is a deploy: GitHub Actions applies new migrations and redeploys every Edge
  Function, and Vercel updates the staging site within a minute or two.
- Don't rewrite shared history (no force-push to `main`, no rebasing other people's branches).

## Database rules (most important)

The database is shared by every laptop, every preview and the staging site.

- **Schema changes are migration files only.** Add `supabase/migrations/YYYYMMDDHHMMSS_snake_name.sql`
  with a timestamp later than the newest file. It is applied when the PR merges.
- **Never** change schema with the Supabase MCP (`apply_migration`), the dashboard, the SQL editor or
  `supabase db push` from a laptop. Doing that records a different version than the file and breaks
  the deploy workflow for everyone.
- **Never edit or rename a migration that's already on `main`.** Fix forward with a new migration.
- **Additive changes only** while code that uses the old shape is still deployed. Previews and `main`
  run against the same tables, so a drop or rename breaks everyone immediately. Add the new column or
  table first, ship the code that uses it, and remove the old one in a later PR.
- Every new table gets row-level security in the same migration (`enable row level security` plus
  policies, or a comment saying it's service-role only). Follow the patterns in existing migrations.
- Reading data with SQL to debug is fine. Writing data by hand is only for your own test records
  (see "Test data"); ask before changing anything else, and never delete real accounts or another
  person's productions.

## Edge Functions

- Changes deploy automatically on merge. Don't deploy functions by hand from a branch; previews
  share the same functions, so an unmerged deploy changes behaviour for everyone.
- `passkey`, `test-login` and `demo` check callers themselves and are deployed with
  `--no-verify-jwt`; `delete-user` and `send-invite-email` keep JWT verification. A new function goes
  in the right list in `.github/workflows/deploy-supabase.yml`.
- Secrets (`RESEND_API_KEY`, `INVITE_FROM`, `PORTAL_URL`, `PASSKEY_ORIGINS`) live in Supabase >
  Edge Functions > Secrets. Never put them in the repo or the browser.

## Front-end conventions

- No build step and no npm (it doesn't work on every developer machine). The site is `index.html`
  plus plain `<script>` files that share one global scope. Load order in `index.html` matters: a file
  can only use what earlier files define. Add new files to `index.html` in the right place.
- External libraries load from a CDN `<script>` tag, not a package manager.
- `src/js/config.js` is gitignored and holds the Supabase URL, publishable key and optional
  `testLoginKey`. Copy `src/js/config.example.js` to start; on Vercel it's written by
  `scripts/write-config.sh` from environment variables. Only the publishable key goes in the
  browser, never the service-role key.
- **Escape everything from the database before it goes into HTML.** Use `escHtml()` from
  `src/js/lib/utils.js` (or `textContent`). Names, notes, deal terms and typed signatures are user
  input. Existing unescaped `innerHTML` is a known issue; fix it when you touch that code.
- Match the surrounding style: small functions, comments only where something isn't obvious,
  CSS in the matching `src/styles/*.css` file using the existing variables.

## Running locally

```bash
python3 -m http.server 5173
```

Ports 5173–5176 are allowed for passkeys and listed in `.claude/launch.json` (use another of them if
one is busy). A local copy talks to the shared staging database, so local testing follows the same
data rules.

## Test data

- Use made-up people only. Test addresses end in `@example.com` (test mode, local only, needs
  `testLoginKey` from a teammate) or `@demo.example.com` (demo mode). These domains can't belong to
  real people.
- Make your own test production named after yourself (e.g. "Jack Test", "Ethan Test") and keep your
  experiments in it. Don't change someone else's.
- Demo mode: sign in as `demo@demo.example.com` for the shared "Silver Harbour" production; "Reset demo"
  rebuilds it. Its crew are the `PEOPLE` list in `supabase/functions/demo/index.ts`.
- New real accounts are limited by the sign-up allowlist. Add a developer with:
  `insert into public.signup_allowlist (email, note) values ('name@company.com', 'Developer');`
  (this is data, not schema, so the SQL editor is fine).

## Email

- Sign-in codes use Supabase's built-in sender, which only reaches members of the Supabase organization
  and only a few per hour. Use test or demo mode for most testing.
- Invite emails go through Resend from `onboarding@resend.dev`, which only reaches the Resend account
  owner. Use **Copy Invite** to test invites with anyone else.

## Before opening a PR

- Load the preview (or local copy) and check the browser console for errors.
- If you added a migration, the PR's "check" job shows the dry run; make sure it lists only your file.
- Update the README when behaviour, setup or a secret changes.
- Say in the PR what to click to test it, so the other developer can check it on the preview.
- When the PR is ready (not a draft), the "Claude review" workflow posts a review comment against
  these rules and updates it on each push. Fix or answer its findings; it doesn't block merging.
