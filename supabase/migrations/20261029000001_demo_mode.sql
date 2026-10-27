-- Demo mode: a ready-made production ("Silver Harbour") for showing the portal off.
-- The demo Edge Function signs in its accounts (all @demo.example.com, a reserved domain no real
-- person can own) without email or two-step sign-in, and resets everything back to the start.
-- The demo production is sealed off: it can only invite @demo.example.com addresses, those
-- addresses can't be invited anywhere else, and demo accounts can't create productions.
-- Turn it off with: update public.demo_settings set enabled = false;
create table public.demo_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  last_reset_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.demo_settings enable row level security;  -- no policies: service role only
insert into public.demo_settings (id, enabled) values (1, true);

-- The demo production always has this id, so a reset brings back the same production.
create function public.demo_company_id() returns uuid
language sql immutable set search_path = '' as $$
  select 'd0000000-0000-4000-8000-000000000001'::uuid
$$;

create function public.is_demo_email(p_email text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(trim(coalesce(p_email, ''))) like '%@demo.example.com'
$$;

create function public.guard_demo_invite() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.company_id = public.demo_company_id() and not public.is_demo_email(new.email) then
    raise exception 'The demo production can only invite @demo.example.com addresses.';
  end if;
  if new.company_id <> public.demo_company_id() and public.is_demo_email(new.email) then
    raise exception '@demo.example.com addresses belong to the demo production.';
  end if;
  return new;
end $$;

create trigger company_invites_demo_guard
  before insert or update on public.company_invites
  for each row execute function public.guard_demo_invite();

create function public.guard_demo_company() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null and new.id <> public.demo_company_id()
     and exists (select 1 from public.profiles where user_id = new.created_by and public.is_demo_email(email)) then
    raise exception 'Demo accounts can''t create productions.';
  end if;
  return new;
end $$;

create trigger companies_demo_guard
  before insert on public.companies
  for each row execute function public.guard_demo_company();

revoke all on function public.guard_demo_invite() from public, anon, authenticated;
revoke all on function public.guard_demo_company() from public, anon, authenticated;
