-- In-app notifications (the bell) and production announcements.
-- Notifications are one row per person; they're only written by the functions and triggers
-- below, and people can only read their own and mark them read.

-- ---------- Announcements ----------
-- departments null = the whole production. Admins can post to everyone or chosen departments;
-- department heads only to the departments they head.
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  author_name text,
  title text not null,
  body text not null default '',
  departments text[],
  recipient_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index announcements_company_id_idx on public.announcements (company_id, created_at desc);

-- ---------- Notifications ----------
-- view says where clicking it goes in the app, e.g. 'portal:deals', 'dept', 'admin:countersign'.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  view text,
  announcement_id uuid references public.announcements (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, company_id, created_at desc);
create index notifications_announcement_id_idx on public.notifications (announcement_id);

alter table public.announcements enable row level security;
alter table public.notifications enable row level security;

create policy "admins and authors read announcements" on public.announcements
  for select to authenticated
  using (author_id = (select auth.uid()) or (select public.is_company_admin(company_id)));
create policy "admins and authors remove announcements" on public.announcements
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_company_admin(company_id)));

create policy "read own notifications" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Helpers ----------
-- Name to show for someone: their name from the invite, else their email.
create function public.member_name(p_user uuid, p_company uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select i.full_name from public.company_invites i
      where i.company_id = p_company and i.email = lower(p.email) and coalesce(i.full_name, '') <> ''
      order by i.created_at desc limit 1),
    p.email)
  from public.profiles p where p.user_id = p_user
$$;

create function public.notify(p_user uuid, p_company uuid, p_kind text, p_title text, p_body text, p_view text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, company_id, kind, title, body, view)
  select p_user, p_company, p_kind, p_title, coalesce(p_body, ''), p_view
  where p_user is not null and p_company is not null
$$;

-- Everyone at a production who is an admin.
create function public.notify_admins(p_company uuid, p_except uuid, p_kind text, p_title text, p_body text, p_view text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, company_id, kind, title, body, view)
  select m.user_id, p_company, p_kind, p_title, coalesce(p_body, ''), p_view
  from public.company_memberships m
  where m.company_id = p_company and m.role = 'admin' and m.user_id is distinct from p_except
$$;

-- ---------- Posting and reading ----------
create function public.post_announcement(p_title text, p_body text, p_departments text[] default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cid uuid := public.current_company_id();
  ttl text := trim(coalesce(p_title, ''));
  bdy text := trim(coalesce(p_body, ''));
  depts text[];
  admin boolean;
  aid uuid;
  n integer;
begin
  if uid is null or cid is null or not public.is_company_member(cid) then
    raise exception 'No active production.';
  end if;
  if ttl = '' then raise exception 'Add a title.'; end if;
  if length(ttl) > 120 then raise exception 'Keep the title under 120 characters.'; end if;
  if length(bdy) > 4000 then raise exception 'Keep the message under 4000 characters.'; end if;

  select array_agg(distinct d order by d) into depts
  from unnest(coalesce(p_departments, '{}')) as d where trim(d) <> '';

  admin := public.is_company_admin(cid);
  if not admin then
    if depts is null then
      raise exception 'Pick the department this is for.';
    end if;
    if exists (select 1 from unnest(depts) d where not public.heads_department(cid, d)) then
      raise exception 'You can only post to departments you head.';
    end if;
  end if;

  insert into public.announcements (company_id, author_id, author_name, title, body, departments)
  values (cid, uid, public.member_name(uid, cid), ttl, bdy, depts)
  returning id into aid;

  -- Recipients: everyone, or people in those departments plus those departments' heads.
  insert into public.notifications (user_id, company_id, kind, title, body, view, announcement_id)
  select m.user_id, cid, 'announcement', ttl, bdy, null, aid
  from public.company_memberships m
  join public.profiles p on p.user_id = m.user_id
  where m.company_id = cid
    and m.user_id <> uid
    and (
      depts is null
      or exists (select 1 from public.company_invites i
                  where i.company_id = cid and i.email = lower(p.email) and i.department = any (depts))
      or exists (select 1 from public.department_heads h
                  where h.company_id = cid and h.head_user_id = m.user_id and h.department = any (depts))
    );
  get diagnostics n = row_count;
  update public.announcements set recipient_count = n where id = aid;
  return aid;
end $$;

-- Mark the given notifications read, or all of them on the active production when p_ids is null.
create function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null
    and (case when p_ids is null then company_id = public.current_company_id() else id = any (p_ids) end)
$$;

-- ---------- Notifications from what happens in the portal ----------
create function public.notify_document_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare what text := coalesce(nullif(new.doc_type, ''), regexp_replace(new.file_path, '^.*/', ''));
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify(new.user_id, new.company_id, 'document_' || new.status,
      'Document ' || new.status,
      'Your ' || what || ' was ' || new.status || '.' ||
        case when new.status = 'rejected' then ' Please upload a new copy.' else '' end,
      'portal:deals');
  end if;
  return null;
end $$;

create trigger documents_notify
  after update of status on public.documents
  for each row execute function public.notify_document_review();

create function public.notify_timesheet() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_invoice boolean := new.week_start is null;
  what text := case when new.week_start is null then 'invoice'
                    else 'timesheet for the week of ' || to_char(new.week_start, 'FMMon FMDD') end;
  who text;
begin
  if tg_op = 'INSERT' then
    -- New submission: let the department's heads know.
    if new.department is not null then
      who := coalesce(new.employee_name, new.employee_email, 'Someone');
      insert into public.notifications (user_id, company_id, kind, title, body, view)
      select h.head_user_id, new.company_id, 'timesheet_submitted',
             case when is_invoice then 'Invoice to review' else 'Timesheet to review' end,
             who || ' submitted their ' || what || ' (' || new.department || ').', 'dept'
      from public.department_heads h
      where h.company_id = new.company_id and h.department = new.department and h.head_user_id <> new.user_id;
    end if;
    return null;
  end if;

  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify(new.user_id, new.company_id, 'timesheet_' || new.status,
      case when is_invoice then 'Invoice ' else 'Timesheet ' end || new.status,
      'Your ' || what || ' was ' || new.status || '.' ||
        case when new.status = 'rejected' then ' You can fix it and submit it again.' else '' end,
      'portal:time');
  elsif new.dept_status = 'approved' and old.dept_status is distinct from 'approved' and new.status = 'pending' then
    perform public.notify_admins(new.company_id, null, 'timesheet_ready',
      'Ready for final approval',
      coalesce(new.employee_name, new.employee_email, 'Someone') || '''s ' || what ||
        ' was approved by their department head.',
      'admin:timesheets');
  end if;
  return null;
end $$;

create trigger timesheets_notify
  after insert or update of status, dept_status on public.timesheets
  for each row execute function public.notify_timesheet();

create function public.notify_paystub() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify(new.user_id, new.company_id, 'paystub', 'New paystub',
    'Payroll issued you a paystub. You can view and download it now.', 'portal:pay');
  return null;
end $$;

create trigger paystubs_notify
  after insert on public.paystubs
  for each row execute function public.notify_paystub();

create function public.notify_esign() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  form text := case when new.type = 'safety' then 'safety acknowledgment' else 'deal memo' end;
  form_cap text := case when new.type = 'safety' then 'Safety acknowledgment' else 'Deal memo' end;
begin
  if tg_op = 'INSERT' then
    if new.status = 'awaiting_signature' then
      perform public.notify(new.user_id, new.company_id, 'deal_sent', form_cap || ' to sign',
        'You have a new ' || form || ' to review and sign.', 'portal:deals');
    end if;
    return null;
  end if;

  if new.status = 'awaiting_countersignature' and old.status is distinct from new.status then
    perform public.notify_admins(new.company_id, new.user_id, 'deal_signed', 'Ready to countersign',
      public.member_name(new.user_id, new.company_id) || ' signed their ' || form || '.', 'admin:countersign');
  elsif new.status = 'countersigned' and old.status is distinct from new.status then
    perform public.notify(new.user_id, new.company_id, 'deal_countersigned', form_cap || ' fully signed',
      'Your ' || form || ' was countersigned. The final copy is in Deal Memos.', 'portal:deals');
  elsif new.status = 'awaiting_signature' and old.status = 'awaiting_countersignature' then
    perform public.notify(new.user_id, new.company_id, 'deal_returned', form_cap || ' sent back',
      'Please sign your ' || form || ' again.' ||
        case when coalesce(new.reject_reason, '') <> '' then ' Reason: ' || new.reject_reason else '' end,
      'portal:deals');
  elsif new.status = 'awaiting_signature' and old.status = 'awaiting_signature'
        and new.notified_at is distinct from old.notified_at then
    perform public.notify(new.user_id, new.company_id, 'deal_reminder', 'Reminder: ' || form || ' to sign',
      'Your ' || form || ' is still waiting for your signature.', 'portal:deals');
  end if;
  return null;
end $$;

create trigger esign_records_notify
  after insert or update of status, notified_at on public.esign_records
  for each row execute function public.notify_esign();

-- ---------- Permissions, audit and live updates ----------
revoke all on function public.member_name(uuid, uuid) from public, anon, authenticated;
revoke all on function public.notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_admins(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_document_review() from public, anon, authenticated;
revoke all on function public.notify_timesheet() from public, anon, authenticated;
revoke all on function public.notify_paystub() from public, anon, authenticated;
revoke all on function public.notify_esign() from public, anon, authenticated;
revoke all on function public.post_announcement(text, text, text[]) from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.post_announcement(text, text, text[]) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create trigger audit_announcements after insert or update or delete on public.announcements
  for each row execute function public.audit_row();

alter publication supabase_realtime add table public.notifications;
