-- Shared staging: only listed people can create an account while this is on.
-- Enforced by the "Before User Created" auth hook (Authentication > Hooks in the dashboard,
-- Postgres function public.hook_signup_allowlist). Existing accounts keep signing in as before.
-- Allowed: addresses in public.signup_allowlist, anyone with a pending invite, and the reserved
-- test/demo domains (test-login and the demo function create those).
-- Add a developer: insert into public.signup_allowlist (email, note) values ('name@company.com', 'Dev');
-- Turn it off (production): update public.signup_allowlist_settings set enabled = false;
create table public.signup_allowlist_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.signup_allowlist_settings enable row level security;  -- no policies: service role only
insert into public.signup_allowlist_settings (id, enabled) values (1, true);

create table public.signup_allowlist (
  email text primary key check (email = lower(email)),
  note text,
  added_at timestamptz not null default now()
);
alter table public.signup_allowlist enable row level security;  -- no policies: service role only

insert into public.signup_allowlist (email, note)
select lower(email), 'Existing account' from auth.users
where email is not null and email !~ '@(demo\.)?example\.(com|org|net)$'
on conflict do nothing;

create or replace function public.hook_signup_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if not coalesce((select enabled from public.signup_allowlist_settings where id = 1), false) then
    return '{}'::jsonb;
  end if;
  if em = '' then
    return '{}'::jsonb;  -- phone/anonymous sign-ups aren't used; nothing to check
  end if;
  if em ~ '@(demo\.)?example\.(com|org|net)$'
     or exists (select 1 from public.signup_allowlist where email = em)
     or exists (select 1 from public.company_invites where lower(email) = em) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This is a test site. Ask the team to add your email to the allowlist.'));
end;
$$;

revoke execute on function public.hook_signup_allowlist(jsonb) from public, anon, authenticated;
grant execute on function public.hook_signup_allowlist(jsonb) to supabase_auth_admin;
