-- Self-serve onboarding: anyone can create a production, accept the Terms and Privacy notice,
-- keep backup codes for two-step sign-in, and register passkeys.

-- ---------- Productions people set up themselves ----------
alter table public.companies
  add column setup_done boolean not null default false,
  add column created_by uuid references auth.users (id) on delete set null,
  add column production_type text,
  add column start_date date,
  add column wrap_date date,
  add column province text,
  add column union_status text;
-- Existing companies were set up by a super admin already.
update public.companies set setup_done = true;
create index companies_created_by_idx on public.companies (created_by);

alter table public.profiles
  add column terms_version text,
  add column terms_accepted_at timestamptz;

-- Record that the caller accepted this version of the Terms and Privacy notice.
create function public.accept_terms(p_version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if coalesce(trim(p_version), '') = '' then raise exception 'Missing terms version.'; end if;
  update public.profiles set terms_version = trim(p_version), terms_accepted_at = now() where user_id = auth.uid();
end $$;

-- Create a production; the caller becomes its first admin and it becomes their active one.
create function public.create_production(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cid uuid; nm text := trim(coalesce(p_name, ''));
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if nm = '' then raise exception 'Enter a production name.'; end if;
  if length(nm) > 120 then raise exception 'Keep the name under 120 characters.'; end if;
  if not exists (select 1 from public.profiles where user_id = uid and terms_accepted_at is not null) then
    raise exception 'Accept the Terms and Privacy notice first.';
  end if;
  insert into public.companies (name, created_by) values (nm, uid) returning id into cid;
  insert into public.company_memberships (user_id, company_id, role) values (uid, cid, 'admin');
  update public.profiles set company_id = cid where user_id = uid;
  return cid;
end $$;

-- The caller's own name, department and crew role on their active production.
-- Stored like a used invite so timesheets and the crew lists pick it up. Invites are unique per
-- email, so a record that belongs to another production is left alone.
create function public.set_my_crew_role(p_full_name text, p_department text, p_crew_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cid uuid := public.current_company_id(); em text; r text;
begin
  if uid is null or cid is null then raise exception 'No active production.'; end if;
  select lower(email) into em from public.profiles where user_id = uid;
  select role into r from public.company_memberships where user_id = uid and company_id = cid;
  if r is null then raise exception 'You are not part of this production.'; end if;
  insert into public.company_invites (company_id, email, role, full_name, department, crew_role, used)
  values (cid, em, r, nullif(trim(p_full_name), ''), nullif(p_department, ''), nullif(p_crew_role, ''), true)
  on conflict (email) do update
    set full_name = excluded.full_name, department = excluded.department, crew_role = excluded.crew_role
    where public.company_invites.company_id = cid;
end $$;

-- ---------- Backup codes for two-step sign-in ----------
-- Only hashes are stored; the codes are shown once when generated.
create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index mfa_recovery_codes_user_id_idx on public.mfa_recovery_codes (user_id);
alter table public.mfa_recovery_codes enable row level security;  -- no policies: functions only

create table public.mfa_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index mfa_recovery_attempts_user_id_idx on public.mfa_recovery_attempts (user_id, created_at);
alter table public.mfa_recovery_attempts enable row level security;  -- no policies: functions only

-- Ten new codes (replacing any old ones). Needs a session that has just passed two-step sign-in,
-- so someone with only email access can't mint codes and use them to remove the authenticator.
create function public.generate_recovery_codes() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 characters, no I/O/0/1
  codes text[] := '{}'; raw bytea; c text; i int; j int;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'Enter your authenticator code first.'; end if;
  delete from public.mfa_recovery_codes where user_id = uid;
  for i in 1..10 loop
    raw := extensions.gen_random_bytes(10);
    c := '';
    for j in 0..9 loop
      c := c || substr(alphabet, (get_byte(raw, j) % 32) + 1, 1);
    end loop;
    insert into public.mfa_recovery_codes (user_id, code_hash)
    values (uid, encode(extensions.digest(c, 'sha256'), 'hex'));
    codes := codes || (substr(c, 1, 5) || '-' || substr(c, 6, 5));
  end loop;
  return codes;
end $$;

create function public.recovery_codes_left() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.mfa_recovery_codes where user_id = auth.uid() and used_at is null
$$;

-- Use one backup code: it is spent, and the caller's authenticator apps are removed so they can
-- set up a new one. At most 5 wrong tries per 15 minutes.
create function public.use_recovery_code(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); hit uuid;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if (select count(*) from public.mfa_recovery_attempts where user_id = uid and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many tries. Wait 15 minutes and try again.';
  end if;
  update public.mfa_recovery_codes set used_at = now()
   where id = (select id from public.mfa_recovery_codes
                where user_id = uid and used_at is null and code_hash = encode(extensions.digest(norm, 'sha256'), 'hex')
                limit 1)
  returning id into hit;
  if hit is null then
    insert into public.mfa_recovery_attempts (user_id) values (uid);
    return false;
  end if;
  delete from public.mfa_recovery_attempts where user_id = uid;
  delete from auth.mfa_factors where user_id = uid;
  return true;
end $$;

-- ---------- Passkeys ----------
-- Written by the passkey Edge Function (service role). People can see and remove their own.
create table public.passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_user_id_idx on public.passkeys (user_id);
alter table public.passkeys enable row level security;
create policy "read own passkeys" on public.passkeys
  for select to authenticated using (user_id = (select auth.uid()));
create policy "remove own passkeys" on public.passkeys
  for delete to authenticated using (user_id = (select auth.uid()));

create table public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('register', 'login')),
  challenge text not null,
  created_at timestamptz not null default now()
);
create index passkey_challenges_user_id_idx on public.passkey_challenges (user_id);
alter table public.passkey_challenges enable row level security;  -- no policies: service role only

-- ---------- Who can call what ----------
revoke execute on function public.accept_terms(text) from public, anon;
revoke execute on function public.create_production(text) from public, anon;
revoke execute on function public.set_my_crew_role(text, text, text) from public, anon;
revoke execute on function public.generate_recovery_codes() from public, anon;
revoke execute on function public.recovery_codes_left() from public, anon;
revoke execute on function public.use_recovery_code(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;
grant execute on function public.create_production(text) to authenticated;
grant execute on function public.set_my_crew_role(text, text, text) to authenticated;
grant execute on function public.generate_recovery_codes() to authenticated;
grant execute on function public.recovery_codes_left() to authenticated;
grant execute on function public.use_recovery_code(text) to authenticated;
