-- Account panel: people edit their own name and phone, leave productions, and delete their account.
-- Deleting an account removes the login and every membership; the records each production holds
-- (documents, timesheets, paystubs, signed memos) stay with that production.

alter table public.profiles add column deleted_at timestamptz;

-- Is someone the only admin of a production that still has other people in it?
create function public.is_last_admin_with_crew(p_user uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_memberships
                  where user_id = p_user and company_id = p_company and role = 'admin')
     and not exists (select 1 from public.company_memberships
                      where company_id = p_company and role = 'admin' and user_id <> p_user)
     and exists (select 1 from public.company_memberships
                  where company_id = p_company and user_id <> p_user)
$$;

-- The caller's name and phone. They live on the person's invite (one per email), which is where
-- forms, timesheets and the crew lists read them from.
create function public.update_my_contact(p_full_name text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); cid uuid := public.current_company_id(); em text; r text;
  nm text := nullif(trim(coalesce(p_full_name, '')), '');
  ph text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if nm is null then raise exception 'Enter your full name.'; end if;
  if length(nm) > 120 or length(coalesce(ph, '')) > 40 then raise exception 'That''s too long.'; end if;
  select lower(email) into em from public.profiles where user_id = uid;
  update public.company_invites set full_name = nm, phone = ph where email = em;
  if not found and cid is not null then
    select role into r from public.company_memberships where user_id = uid and company_id = cid;
    if r is not null then
      insert into public.company_invites (company_id, email, role, full_name, phone, used)
      values (cid, em, r, nm, ph, true);
    end if;
  end if;
end $$;

-- Leave a production. The production keeps everything the person submitted to it.
create function public.leave_company(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text; nm text; other uuid;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select email into em from public.profiles where user_id = uid;
  if public.is_demo_email(em) then raise exception 'Demo accounts can''t leave the demo production.'; end if;
  select c.name into nm from public.company_memberships m join public.companies c on c.id = m.company_id
   where m.user_id = uid and m.company_id = p_company;
  if nm is null then raise exception 'You''re not part of that production.'; end if;
  if public.is_last_admin_with_crew(uid, p_company) then
    raise exception 'You''re the only admin of %. Make someone else an admin there first.', nm;
  end if;
  delete from public.company_memberships where user_id = uid and company_id = p_company;
  delete from public.department_heads where head_user_id = uid and company_id = p_company;
  delete from public.notifications where user_id = uid and company_id = p_company;
  select company_id into other from public.company_memberships where user_id = uid order by created_at limit 1;
  update public.profiles set company_id = other where user_id = uid and company_id = p_company;
end $$;

-- Admins make someone at their production an admin, or take it away.
create function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.current_company_id(); em text;
begin
  if p_role not in ('admin', 'employee') then raise exception 'Unknown role.'; end if;
  if not public.is_company_admin(cid) then raise exception 'Only admins can change roles.'; end if;
  if p_user = auth.uid() then raise exception 'You can''t change your own role.'; end if;
  update public.company_memberships set role = p_role where user_id = p_user and company_id = cid;
  if not found then raise exception 'That person isn''t in this production.'; end if;
  select lower(email) into em from public.profiles where user_id = p_user;
  update public.company_invites set role = p_role where email = em and company_id = cid;
end $$;

-- Run by the delete-user Edge Function (service role) just before it removes the login.
-- Leaves every production; the records stay with them. Pending invitations are withdrawn, and
-- the profile keeps no email, so the address can sign up again as a new person.
create function public.prepare_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare em text; blocked text;
begin
  select email into em from public.profiles where user_id = p_user;
  if em is null then raise exception 'Account not found.'; end if;
  if public.is_demo_email(em) then raise exception 'Demo accounts can''t be deleted.'; end if;
  if exists (select 1 from public.superadmins where user_id = p_user) then
    raise exception 'Super admin accounts can''t be deleted here.';
  end if;
  select string_agg(c.name, ', ' order by c.name) into blocked
    from public.company_memberships m join public.companies c on c.id = m.company_id
   where m.user_id = p_user and public.is_last_admin_with_crew(p_user, m.company_id);
  if blocked is not null then
    raise exception 'You''re the only admin of %. Make someone else an admin there first.', blocked;
  end if;
  delete from public.company_invites where email = lower(em) and not used;
  delete from public.company_memberships where user_id = p_user;
  delete from public.department_heads where head_user_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.passkeys where user_id = p_user;
  delete from public.passkey_challenges where user_id = p_user;
  delete from public.mfa_recovery_codes where user_id = p_user;
  delete from public.mfa_recovery_attempts where user_id = p_user;
  update public.profiles
     set company_id = null, deleted_at = now(), email = 'deleted-' || p_user || '@deleted.invalid'
   where user_id = p_user;
end $$;

revoke all on function public.is_last_admin_with_crew(uuid, uuid) from public, anon, authenticated;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.update_my_contact(text, text) from public, anon;
revoke all on function public.leave_company(uuid) from public, anon;
revoke all on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
grant execute on function public.update_my_contact(text, text) to authenticated;
grant execute on function public.leave_company(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, text) to authenticated;
