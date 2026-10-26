-- Functions the app calls with client.rpc(). Each re-checks who is calling.

-- ---------- Company switcher ----------
create function public.my_companies()
returns table (id uuid, name text, role text, active boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, m.role, c.id = public.current_company_id()
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
  order by c.name
$$;

create function public.switch_company(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_company_member(p_company) then
    raise exception 'You are not a member of that company.';
  end if;
  update public.profiles set company_id = p_company where user_id = auth.uid();
end $$;

-- ---------- Department heads ----------
create function public.dept_review_timesheet(p_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare ts public.timesheets;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;
  select * into ts from public.timesheets where id = p_id for update;
  if not found or not public.heads_department(ts.company_id, ts.department)
     or ts.company_id is distinct from public.current_company_id() then
    raise exception 'You do not head this timesheet''s department.';
  end if;
  if ts.user_id = auth.uid() then
    raise exception 'You can''t review your own timesheet.';
  end if;
  if ts.status <> 'pending' or ts.dept_status <> 'pending' then
    raise exception 'This timesheet has already been reviewed.';
  end if;
  update public.timesheets
     set dept_status = p_decision,
         dept_reviewed_by = auth.uid(),
         dept_reviewed_at = now(),
         status = case when p_decision = 'rejected' then 'rejected' else status end
   where id = p_id;
end $$;

-- ---------- Deal memos & safety forms (admin) ----------
create function public.admin_send_deal(p_user uuid, p_template uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.esign_templates; rec public.esign_records;
begin
  select * into t from public.esign_templates where id = p_template;
  if not found or not public.is_company_admin(t.company_id) or t.company_id is distinct from public.current_company_id() then
    raise exception 'Template not found.';
  end if;
  if not exists (select 1 from public.company_memberships where user_id = p_user and company_id = t.company_id) then
    raise exception 'That person is not in this company.';
  end if;
  select * into rec from public.esign_records
   where user_id = p_user and template_id = p_template and status <> 'revoked'
   order by created_at desc limit 1;
  if found then
    if rec.status in ('awaiting_countersignature', 'countersigned') then
      return 'already_signed';
    end if;
    update public.esign_records set notified_at = now() where id = rec.id;
    return 'resent';
  end if;
  insert into public.esign_records (user_id, template_id, type, status, notified_at)
  values (p_user, p_template, t.type, 'awaiting_signature', now());
  return 'sent';
end $$;

create function public.admin_notify_template(p_template uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  select company_id into cid from public.esign_templates where id = p_template;
  if cid is null or not public.is_company_admin(cid) then
    raise exception 'Template not found.';
  end if;
  update public.esign_records set notified_at = now()
   where template_id = p_template and status = 'awaiting_signature';
end $$;

-- Returns the template id so the app can send a fresh copy.
create function public.admin_revoke_deal(p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec public.esign_records;
begin
  select * into rec from public.esign_records where id = p_id;
  if not found or not public.is_company_admin(rec.company_id) then
    raise exception 'Form not found.';
  end if;
  if rec.status = 'revoked' then
    raise exception 'This form is already revoked.';
  end if;
  update public.esign_records set status = 'revoked', revoke_reason = p_reason where id = p_id;
  return rec.template_id;
end $$;

-- Returns the signed PDF's storage path (if any) so the app can remove the file.
create function public.admin_delete_revoked_deal(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare rec public.esign_records;
begin
  select * into rec from public.esign_records where id = p_id;
  if not found or not public.is_company_admin(rec.company_id) then
    raise exception 'Form not found.';
  end if;
  if rec.status <> 'revoked' then
    raise exception 'Only revoked forms can be removed.';
  end if;
  delete from public.esign_records where id = p_id;
  return rec.final_pdf_path;
end $$;

-- Sends a signed form back to the employee with a reason; their signature is cleared.
create function public.admin_reject_countersign(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare rec public.esign_records;
begin
  select * into rec from public.esign_records where id = p_id;
  if not found or not public.is_company_admin(rec.company_id) then
    raise exception 'Form not found.';
  end if;
  if rec.status <> 'awaiting_countersignature' then
    raise exception 'Only forms waiting for countersignature can be sent back.';
  end if;
  update public.esign_records
     set status = 'awaiting_signature',
         employee_signature = null,
         employee_signed_at = null,
         reject_reason = p_reason,
         notified_at = now()
   where id = p_id;
end $$;

-- Deletes a template and anyone's unsigned copies. Refuses if someone has signed it.
create function public.admin_delete_template(p_template uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  select company_id into cid from public.esign_templates where id = p_template;
  if cid is null or not public.is_company_admin(cid) then
    raise exception 'Template not found.';
  end if;
  if exists (
    select 1 from public.esign_records
    where template_id = p_template and status in ('awaiting_countersignature', 'countersigned')
  ) then
    raise exception 'Someone has already signed this template, so it can''t be deleted.';
  end if;
  delete from public.esign_records where template_id = p_template;
  delete from public.esign_templates where id = p_template;
end $$;

-- ---------- Removing people ----------
-- 'removed' = taken out of this company only (they belong to another).
-- 'last'    = this was their only company; the app then deletes the account via the delete-user function.
create function public.remove_from_company(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.current_company_id(); other uuid;
begin
  if not public.is_company_admin(cid) then
    raise exception 'Only admins can remove people.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t remove yourself.';
  end if;
  if not exists (select 1 from public.company_memberships where user_id = p_user and company_id = cid) then
    raise exception 'That person is not in this company.';
  end if;
  select company_id into other from public.company_memberships
   where user_id = p_user and company_id <> cid order by created_at limit 1;
  if other is null then
    return 'last';
  end if;
  delete from public.company_memberships where user_id = p_user and company_id = cid;
  delete from public.department_heads where head_user_id = p_user and company_id = cid;
  update public.profiles set company_id = other where user_id = p_user and company_id = cid;
  return 'removed';
end $$;

-- ---------- Super admin ----------
create function public.superadmin_overview() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_superadmin() then raise exception 'Super admins only.'; end if;
  return coalesce((
    select json_agg(row_to_json(x) order by x.name)
    from (
      select c.id, c.name,
        (select count(*) from public.company_memberships m where m.company_id = c.id)::int as member_count,
        coalesce((
          select json_agg(json_build_object('email', p.email) order by p.email)
          from public.company_memberships m join public.profiles p on p.user_id = m.user_id
          where m.company_id = c.id and m.role = 'admin'
        ), '[]') as admins,
        coalesce((
          select json_agg(json_build_object('email', i.email) order by i.email)
          from public.company_invites i
          where i.company_id = c.id and i.role = 'admin' and not i.used
        ), '[]') as pending
      from public.companies c
    ) x
  ), '[]');
end $$;

-- Makes p_email an admin of p_company: 'added' if they already have an account, else 'invited'.
create function public.superadmin_invite_admin(p_company uuid, p_email text, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; em text := lower(trim(p_email));
begin
  if not public.is_superadmin() then raise exception 'Super admins only.'; end if;
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'Company not found.'; end if;
  select user_id into uid from public.profiles where lower(email) = em;
  if uid is not null then
    insert into public.company_memberships (user_id, company_id, role) values (uid, p_company, 'admin')
    on conflict (user_id, company_id) do update set role = 'admin';
    update public.profiles set company_id = coalesce(company_id, p_company) where user_id = uid;
    return 'added';
  end if;
  insert into public.company_invites (company_id, email, role, full_name, used)
  values (p_company, em, 'admin', p_name, false)
  on conflict (email) do update
    set company_id = excluded.company_id, role = 'admin', full_name = excluded.full_name, used = false;
  return 'invited';
end $$;

create function public.superadmin_create_company(p_name text, p_admin_email text, p_admin_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if not public.is_superadmin() then raise exception 'Super admins only.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a company name.'; end if;
  insert into public.companies (name) values (trim(p_name)) returning id into cid;
  return public.superadmin_invite_admin(cid, p_admin_email, p_admin_name);
end $$;

-- 'cancelled' = a pending invite was withdrawn; 'removed' = admin taken off this company
-- (account kept); 'deleted' = it was their only company, so the account was deleted too.
create function public.superadmin_remove_admin(p_company uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; em text := lower(trim(p_email));
begin
  if not public.is_superadmin() then raise exception 'Super admins only.'; end if;
  select user_id into uid from public.profiles where lower(email) = em;
  if uid is null or not exists (
    select 1 from public.company_memberships where user_id = uid and company_id = p_company and role = 'admin'
  ) then
    delete from public.company_invites where company_id = p_company and email = em and not used;
    return 'cancelled';
  end if;
  if uid = auth.uid() then raise exception 'You can''t remove yourself.'; end if;
  delete from public.company_memberships where user_id = uid and company_id = p_company;
  delete from public.department_heads where head_user_id = uid and company_id = p_company;
  update public.profiles
     set company_id = (select company_id from public.company_memberships where user_id = uid order by created_at limit 1)
   where user_id = uid and company_id = p_company;
  if exists (select 1 from public.company_memberships where user_id = uid)
     or exists (select 1 from public.superadmins where user_id = uid) then
    return 'removed';
  end if;
  -- Their last company: delete the account so the address can sign up fresh.
  -- If they still own records (uploads, timesheets...) the delete is blocked; keep the account unassigned.
  begin
    delete from auth.users where id = uid;
    return 'deleted';
  exception when foreign_key_violation then
    return 'removed';
  end;
end $$;

create function public.superadmin_delete_company(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_superadmin() then raise exception 'Super admins only.'; end if;
  if exists (select 1 from public.company_memberships where company_id = p_company and role = 'admin') then
    raise exception 'Remove every admin first. A company can only be deleted when it has none.';
  end if;
  delete from public.companies where id = p_company;
end $$;

-- ---------- Permissions ----------
-- Only signed-in users may call these; anon and public get nothing.
do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
