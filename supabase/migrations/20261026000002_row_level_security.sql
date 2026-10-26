-- Row-level security. The browser only holds the publishable key, so these
-- policies are what actually keep each company's data private.
-- "own"   = the caller's rows in their active company
-- "admin" = an admin of the caller's active company, for rows in that company

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_memberships enable row level security;
alter table public.superadmins enable row level security;
alter table public.esign_templates enable row level security;
alter table public.timesheet_templates enable row level security;
alter table public.company_invites enable row level security;
alter table public.department_heads enable row level security;
alter table public.documents enable row level security;
alter table public.approval_chain enable row level security;
alter table public.document_approvals enable row level security;
alter table public.timesheets enable row level security;
alter table public.paystubs enable row level security;
alter table public.esign_records enable row level security;

-- ---------- Companies ----------
create policy "members read their companies" on public.companies
  for select to authenticated
  using (public.is_company_member(id) or (select public.is_superadmin()));
create policy "admins update their company" on public.companies
  for update to authenticated
  using (public.is_company_admin(id)) with check (public.is_company_admin(id));

-- ---------- Profiles ----------
create policy "read own profile or company members" on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or ((select public.is_company_admin()) and public.is_member_of_current(user_id))
    or (select public.is_superadmin())
  );

-- ---------- Memberships ----------
create policy "read own memberships or company members" on public.company_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_company_admin(company_id)
    or (select public.is_superadmin())
  );

-- ---------- Super admins ----------
create policy "read own super admin row" on public.superadmins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Templates (members read, admins write) ----------
create policy "members read templates" on public.esign_templates
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "admins insert templates" on public.esign_templates
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.is_company_admin()));
create policy "admins update templates" on public.esign_templates
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
  with check (company_id = (select public.current_company_id()));

create policy "members read timesheet forms" on public.timesheet_templates
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "admins insert timesheet forms" on public.timesheet_templates
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.is_company_admin()));
create policy "admins update timesheet forms" on public.timesheet_templates
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
  with check (company_id = (select public.current_company_id()));
create policy "admins delete timesheet forms" on public.timesheet_templates
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()));

-- ---------- Invites ----------
create policy "admins and the invitee read invites" on public.company_invites
  for select to authenticated
  using (
    (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
    or email = lower((select auth.jwt()) ->> 'email')
  );
create policy "admins insert invites" on public.company_invites
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.is_company_admin()));
create policy "admins update invites" on public.company_invites
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
  with check (company_id = (select public.current_company_id()));
create policy "admins delete invites" on public.company_invites
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()));

-- ---------- Department heads ----------
create policy "members read department heads" on public.department_heads
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "admins add department heads" on public.department_heads
  for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_company_admin())
    and public.is_member_of_current(head_user_id)
  );
create policy "admins remove department heads" on public.department_heads
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()));

-- ---------- Documents ----------
create policy "read own or company documents" on public.documents
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (user_id = (select auth.uid()) or (select public.is_company_admin()))
  );
create policy "upload own documents" on public.documents
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and company_id = (select public.current_company_id())
    and status = 'pending'
  );
create policy "admins review documents" on public.documents
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
  with check (company_id = (select public.current_company_id()));
create policy "remove own rejected or any as admin" on public.documents
  for delete to authenticated
  using (
    company_id = (select public.current_company_id())
    and ((user_id = (select auth.uid()) and status = 'rejected') or (select public.is_company_admin()))
  );

create policy "admins manage approval chain" on public.approval_chain
  for all to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
  with check (company_id = (select public.current_company_id()) and (select public.is_company_admin()));

create policy "admins read approvals" on public.document_approvals
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and d.company_id = (select public.current_company_id())
      and (select public.is_company_admin())
  ));
create policy "admins record approvals" on public.document_approvals
  for insert to authenticated
  with check (
    approver_id = (select auth.uid())
    and exists (
      select 1 from public.documents d
      where d.id = document_id and d.company_id = (select public.current_company_id())
        and (select public.is_company_admin())
    )
  );

-- ---------- Timesheets ----------
create policy "read own, department or company timesheets" on public.timesheets
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      user_id = (select auth.uid())
      or (select public.is_company_admin())
      or public.heads_department(company_id, department)
    )
  );
create policy "submit own timesheets" on public.timesheets
  for insert to authenticated
  with check (user_id = (select auth.uid()) and company_id = (select public.current_company_id()));
create policy "admins review timesheets" on public.timesheets
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()))
  with check (company_id = (select public.current_company_id()));
create policy "remove own unapproved or any as admin" on public.timesheets
  for delete to authenticated
  using (
    company_id = (select public.current_company_id())
    and ((user_id = (select auth.uid()) and status <> 'approved') or (select public.is_company_admin()))
  );

-- ---------- Paystubs ----------
create policy "read own or company paystubs" on public.paystubs
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (user_id = (select auth.uid()) or (select public.is_company_admin()))
  );
create policy "admins issue paystubs" on public.paystubs
  for insert to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (select public.is_company_admin())
    and public.is_member_of_current(user_id)
  );
create policy "admins remove paystubs" on public.paystubs
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_company_admin()));

-- ---------- Deal memos & safety forms ----------
create policy "read own or company forms" on public.esign_records
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (user_id = (select auth.uid()) or (select public.is_company_admin()))
  );
-- Employees open their own record for a template assigned to them; it always starts unsigned.
create policy "open own form" on public.esign_records
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'awaiting_signature'
    and employee_signature is null
    and exists (
      select 1 from public.esign_templates t
      where t.id = template_id and t.company_id = (select public.current_company_id())
    )
  );
-- Signing (employee) and countersigning (admin). The guard trigger limits what employees can change.
create policy "sign own or countersign company forms" on public.esign_records
  for update to authenticated
  using (
    company_id = (select public.current_company_id())
    and (user_id = (select auth.uid()) or (select public.is_company_admin()))
  )
  with check (company_id = (select public.current_company_id()));
