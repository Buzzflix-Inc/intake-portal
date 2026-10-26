-- Private storage buckets. Files are only reachable through signed URLs,
-- and these policies decide who can create those URLs.
--   documents, timesheets  <user_id>/<file>        the person, plus admins/department heads of their company
--   paystubs               <user_id>/<file>        the person; admins upload and remove
--   branding               <company_id>/<file>     company members read; admins write
--   deal-memos             <company_id>/templates/ members read; admins write
--                          <company_id>/final/     admins, plus the person who signed it

insert into storage.buckets (id, name, public)
values
  ('documents', 'documents', false),
  ('timesheets', 'timesheets', false),
  ('paystubs', 'paystubs', false),
  ('branding', 'branding', false),
  ('deal-memos', 'deal-memos', false)
on conflict (id) do nothing;

-- Can the caller see files in a person's folder?
create function public.can_view_user_files(p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner = auth.uid()::text
    or (
      (public.is_company_admin() or public.is_dept_head())
      and exists (
        select 1 from public.company_memberships m
        where m.user_id::text = p_owner and m.company_id = public.current_company_id()
      )
    )
$$;

-- Can the caller manage files for a person (admin of a company the person belongs to)?
create function public.can_manage_user_files(p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_company_admin()
    and exists (
      select 1 from public.company_memberships m
      where m.user_id::text = p_owner and m.company_id = public.current_company_id()
    )
$$;

create function public.is_company_member_text(p_company text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = auth.uid() and m.company_id::text = p_company
  )
$$;

create function public.is_company_admin_text(p_company text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = auth.uid() and m.company_id::text = p_company and m.role = 'admin'
  )
$$;

revoke all on function public.can_view_user_files(text) from public, anon;
revoke all on function public.can_manage_user_files(text) from public, anon;
revoke all on function public.is_company_member_text(text) from public, anon;
revoke all on function public.is_company_admin_text(text) from public, anon;
grant execute on function public.can_view_user_files(text) to authenticated, service_role;
grant execute on function public.can_manage_user_files(text) to authenticated, service_role;
grant execute on function public.is_company_member_text(text) to authenticated, service_role;
grant execute on function public.is_company_admin_text(text) to authenticated, service_role;

-- ---------- documents & timesheets ----------
create policy "read own or company submissions" on storage.objects
  for select to authenticated
  using (bucket_id in ('documents', 'timesheets') and public.can_view_user_files((storage.foldername(name))[1]));
create policy "upload own submissions" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('documents', 'timesheets') and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "remove own or company submissions" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('documents', 'timesheets')
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_manage_user_files((storage.foldername(name))[1]))
  );

-- ---------- paystubs ----------
create policy "read own or company paystubs" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'paystubs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_manage_user_files((storage.foldername(name))[1]))
  );
create policy "admins upload paystubs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'paystubs' and public.can_manage_user_files((storage.foldername(name))[1]));
create policy "admins remove paystubs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'paystubs' and public.can_manage_user_files((storage.foldername(name))[1]));

-- ---------- branding ----------
create policy "members read branding" on storage.objects
  for select to authenticated
  using (bucket_id = 'branding' and public.is_company_member_text((storage.foldername(name))[1]));
create policy "admins upload branding" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and public.is_company_admin_text((storage.foldername(name))[1]));
create policy "admins replace branding" on storage.objects
  for update to authenticated
  using (bucket_id = 'branding' and public.is_company_admin_text((storage.foldername(name))[1]))
  with check (bucket_id = 'branding' and public.is_company_admin_text((storage.foldername(name))[1]));
create policy "admins remove branding" on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding' and public.is_company_admin_text((storage.foldername(name))[1]));

-- ---------- deal-memos (deal memo, safety and timesheet form PDFs) ----------
create policy "read form templates and own signed forms" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deal-memos'
    and (
      public.is_company_admin_text((storage.foldername(name))[1])
      or ((storage.foldername(name))[2] = 'templates' and public.is_company_member_text((storage.foldername(name))[1]))
      or exists (
        select 1 from public.esign_records r
        where r.final_pdf_path = name and r.user_id = (select auth.uid())
      )
    )
  );
create policy "admins upload forms" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'deal-memos' and public.is_company_admin_text((storage.foldername(name))[1]));
create policy "admins replace forms" on storage.objects
  for update to authenticated
  using (bucket_id = 'deal-memos' and public.is_company_admin_text((storage.foldername(name))[1]))
  with check (bucket_id = 'deal-memos' and public.is_company_admin_text((storage.foldername(name))[1]));
create policy "admins remove forms" on storage.objects
  for delete to authenticated
  using (bucket_id = 'deal-memos' and public.is_company_admin_text((storage.foldername(name))[1]));
