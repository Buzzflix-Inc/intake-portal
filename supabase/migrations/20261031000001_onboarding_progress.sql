-- Onboarding progress: each crew member's steps at their production (joined, documents uploaded and
-- approved, forms signed and countersigned). When the last step is done, admins and the person's
-- department heads get a "Fully onboarded" notification to review them.

alter table public.company_memberships add column onboarded_at timestamptz;

-- The steps for one person at one production, in order: [{key, label, done, count?, total?}].
-- Steps that don't apply (no documents requested, no forms assigned) are left out.
create function public.onboarding_steps(p_user uuid, p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  em text; inv public.company_invites; req text[]; up int; ok int; forms int; signed int; counter int;
  steps jsonb := jsonb_build_array(jsonb_build_object('key', 'joined', 'label', 'Joined', 'done', true));
begin
  select lower(email) into em from public.profiles where user_id = p_user;
  select * into inv from public.company_invites where email = em and company_id = p_company;

  select coalesce(array_agg(d), '{}') into req
    from unnest(coalesce(inv.requested_documents, '{}')) d where d <> '__contractor__';
  if cardinality(req) > 0 then
    select count(*) filter (where exists (select 1 from public.documents x where x.user_id = p_user and x.company_id = p_company and x.doc_type = r and x.status <> 'rejected')),
           count(*) filter (where exists (select 1 from public.documents x where x.user_id = p_user and x.company_id = p_company and x.doc_type = r and x.status = 'approved'))
      into up, ok from unnest(req) r;
    steps := steps
      || jsonb_build_object('key', 'uploaded', 'label', 'Documents uploaded', 'done', up = cardinality(req), 'count', up, 'total', cardinality(req))
      || jsonb_build_object('key', 'approved', 'label', 'Documents approved', 'done', ok = cardinality(req), 'count', ok, 'total', cardinality(req));
  end if;

  -- Forms: the invite's deal memo and safety form (unless an admin revoked them without reissuing),
  -- plus anything sent since. Each counts by its latest copy that isn't revoked.
  with t as (
    select tid from unnest(array[inv.deal_memo_template_id, inv.safety_template_id]) tid
     where tid is not null
       and (exists (select 1 from public.esign_records r where r.user_id = p_user and r.template_id = tid and r.status <> 'revoked')
            or not exists (select 1 from public.esign_records r where r.user_id = p_user and r.template_id = tid))
    union
    select r.template_id from public.esign_records r
     where r.user_id = p_user and r.company_id = p_company and r.status <> 'revoked'
  ), s as (
    select (select r.status from public.esign_records r
             where r.user_id = p_user and r.template_id = t.tid and r.status <> 'revoked'
             order by r.created_at desc limit 1) st
    from t
  )
  select count(*), count(*) filter (where st in ('awaiting_countersignature', 'countersigned')), count(*) filter (where st = 'countersigned')
    into forms, signed, counter from s;
  if forms > 0 then
    steps := steps
      || jsonb_build_object('key', 'signed', 'label', 'Forms signed', 'done', signed = forms, 'count', signed, 'total', forms)
      || jsonb_build_object('key', 'countersigned', 'label', 'Forms countersigned', 'done', counter = forms, 'count', counter, 'total', forms);
  end if;
  return steps;
end $$;

create function public.onboarding_complete(p_steps jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_array_length(p_steps) > 1
     and not exists (select 1 from jsonb_array_elements(p_steps) e where not (e ->> 'done')::boolean)
$$;

-- Records when someone finishes (or stops being finished, e.g. a document was rejected afterwards),
-- and lets the admins and their department heads know when they finish.
create function public.refresh_onboarding(p_user uuid, p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare was timestamptz; done boolean; nm text; dept text; em text; msg text;
begin
  select onboarded_at into was from public.company_memberships where user_id = p_user and company_id = p_company;
  if not found then return; end if;
  done := public.onboarding_complete(public.onboarding_steps(p_user, p_company));
  if done and was is null then
    update public.company_memberships set onboarded_at = now() where user_id = p_user and company_id = p_company;
    nm := public.member_name(p_user, p_company);
    msg := nm || ' finished onboarding: documents approved and forms countersigned. Ready for your review.';
    perform public.notify_admins(p_company, p_user, 'onboarded', 'Fully onboarded', msg, 'admin:employees');
    select lower(email) into em from public.profiles where user_id = p_user;
    select department into dept from public.company_invites where email = em and company_id = p_company;
    insert into public.notifications (user_id, company_id, kind, title, body, view)
    select h.head_user_id, p_company, 'onboarded', 'Fully onboarded', msg, 'dept'
      from public.department_heads h
     where h.company_id = p_company and h.department = dept and h.head_user_id <> p_user
       and not exists (select 1 from public.company_memberships m
                        where m.user_id = h.head_user_id and m.company_id = p_company and m.role = 'admin');
  elsif not done and was is not null then
    update public.company_memberships set onboarded_at = null where user_id = p_user and company_id = p_company;
  end if;
end $$;

create function public.onboarding_record_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record := coalesce(new, old);
begin
  perform public.refresh_onboarding(r.user_id, r.company_id);
  return null;
end $$;

create trigger documents_onboarding after insert or update of status, doc_type or delete on public.documents
  for each row execute function public.onboarding_record_changed();
create trigger esign_records_onboarding after insert or update of status or delete on public.esign_records
  for each row execute function public.onboarding_record_changed();

create function public.onboarding_invite_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  select user_id into uid from public.profiles where lower(email) = new.email and deleted_at is null;
  if uid is not null then perform public.refresh_onboarding(uid, new.company_id); end if;
  return null;
end $$;

create trigger company_invites_onboarding
  after update of requested_documents, deal_memo_template_id, safety_template_id on public.company_invites
  for each row execute function public.onboarding_invite_changed();

-- Admins: everyone at the active production with their steps.
create function public.crew_onboarding()
returns table (user_id uuid, steps jsonb, onboarded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_company_admin(cid) then raise exception 'Only admins can see onboarding progress.'; end if;
  return query
    select m.user_id, public.onboarding_steps(m.user_id, cid), m.onboarded_at
      from public.company_memberships m where m.company_id = cid;
end $$;

-- People who had already finished before this existed: mark them, without notifying anyone.
update public.company_memberships m set onboarded_at = now()
 where public.onboarding_complete(public.onboarding_steps(m.user_id, m.company_id));

revoke all on function public.onboarding_steps(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refresh_onboarding(uuid, uuid) from public, anon, authenticated;
revoke all on function public.onboarding_record_changed() from public, anon, authenticated;
revoke all on function public.onboarding_invite_changed() from public, anon, authenticated;
revoke all on function public.crew_onboarding() from public, anon;
grant execute on function public.crew_onboarding() to authenticated;
