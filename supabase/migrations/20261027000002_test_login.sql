-- Test mode for local development: the test-login Edge Function signs in @example.com
-- addresses without sending email, for whoever holds the key. Only its SHA-256 hash is stored
-- here; the key itself is in the developer's gitignored src/js/config.js (testLoginKey).
-- Turn it off with: update public.test_login_settings set enabled = false;
-- Drop this table and the function before going to production.
create table public.test_login_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  key_hash text,
  updated_at timestamptz not null default now()
);
alter table public.test_login_settings enable row level security;  -- no policies: service role only
insert into public.test_login_settings (id, enabled) values (1, false);
