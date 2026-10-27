-- Onboarding reminders: what each crew member still has to do themselves (upload, re-upload, sign),
-- and a log of the reminders admins send them. Reminders are sent by the send-reminder Edge Function,
-- which writes the log with the service role.

create table public.onboarding_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_by uuid references auth.users (id) on delete set null,
  items jsonb not null default '[]',
  emailed boolean not null default false,
  created_at timestamptz not null default now()
);
create index onboarding_reminders_company_user_idx on public.onboarding_reminders (company_id, user_id, created_at desc);
create index onboarding_reminders_user_id_idx on public.onboarding_reminders (user_id);
create index onboarding_reminders_sent_by_idx on public.onboarding_reminders (sent_by);

alter table public.onboarding_reminders enable row level security;
-- Admins read their production's log. Rows are only written by the send-reminder Edge Function.
create policy "admins read reminders" on public.onboarding_reminders
  for select to authenticated
  using ((select public.is_company_admin(company_id)));

-- What the person still has to do at the production, in order: [{kind, label}], kind is
-- 'upload', 'reupload' (their upload was rejected) or 'sign'. Uses the same forms as onboarding_steps.
create function public.onboarding_todo(p_user uuid, p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare em text; inv public.company_invites; docs jsonb; forms jsonb;
begin
  select lower(email) into em from public.profiles where user_id = p_user;
  select * into inv from public.company_invites where email = em and company_id = p_company;

  select coalesce(jsonb_agg(jsonb_build_object('kind', case when m.rejected then 'reupload' else 'upload' end, 'label', m.d) order by m.ord), '[]')
    into docs
    from (select u.d, u.ord,
                 exists (select 1 from public.documents x where x.user_id = p_user and x.company_id = p_company and x.doc_type = u.d and x.status = 'rejected') rejected
            from unnest(coalesce(inv.requested_documents, '{}')) with ordinality u(d, ord)
           where u.d <> '__contractor__'
             and not exists (select 1 from public.documents x where x.user_id = p_user and x.company_id = p_company and x.doc_type = u.d and x.status <> 'rejected')) m;

  with t as (
    select tid from unnest(array[inv.deal_memo_template_id, inv.safety_template_id]) tid
     where tid is not null
       and (exists (select 1 from public.esign_records r where r.user_id = p_user and r.template_id = tid and r.status <> 'revoked')
            or not exists (select 1 from public.esign_records r where r.user_id = p_user and r.template_id = tid))
    union
    select r.template_id from public.esign_records r
     where r.user_id = p_user and r.company_id = p_company and r.status <> 'revoked'
  ), s as (
    select t.tid, (select r.status from public.esign_records r
                    where r.user_id = p_user and r.template_id = t.tid and r.status <> 'revoked'
                    order by r.created_at desc limit 1) st
    from t
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'sign', 'label',
           coalesce(et.name, case et.type when 'safety' then 'Safety acknowledgment' else 'Deal memo' end)) order by et.type, et.name), '[]')
    into forms
    from s left join public.esign_templates et on et.id = s.tid
   where s.st is null or s.st = 'awaiting_signature';

  return docs || forms;
end $$;

-- Admins: everyone at the active production with their steps, what they still owe and when they
-- were last reminded.
create function public.crew_onboarding_status()
returns table (user_id uuid, steps jsonb, onboarded_at timestamptz, todo jsonb, last_reminded_at timestamptz, reminders int)
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_company_admin(cid) then raise exception 'Only admins can see onboarding progress.'; end if;
  return query
    select m.user_id, public.onboarding_steps(m.user_id, cid), m.onboarded_at, public.onboarding_todo(m.user_id, cid),
           (select max(r.created_at) from public.onboarding_reminders r where r.company_id = cid and r.user_id = m.user_id),
           (select count(*)::int from public.onboarding_reminders r where r.company_id = cid and r.user_id = m.user_id)
      from public.company_memberships m where m.company_id = cid;
end $$;

revoke all on function public.onboarding_todo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.onboarding_todo(uuid, uuid) to service_role;
revoke all on function public.crew_onboarding_status() from public, anon;
grant execute on function public.crew_onboarding_status() to authenticated;
