-- Core schema for the HR Intake Portal.
-- Every company-owned row carries company_id. A person can belong to several
-- companies (company_memberships); profiles.company_id is the one they are
-- currently working in, and row-level security scopes reads to it.

-- ---------- Companies, people and roles ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text,
  primary_color text,
  accent_color text,
  logo_path text,
  background_path text,
  background_opacity numeric not null default 0.4,
  background_pos_x numeric not null default 50,
  background_pos_y numeric not null default 50,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  company_id uuid references public.companies (id) on delete set null,  -- active company
  created_at timestamptz not null default now()
);
create index profiles_company_id_idx on public.profiles (company_id);
create index profiles_email_idx on public.profiles (lower(email));

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);
create index company_memberships_company_id_idx on public.company_memberships (company_id);

create table public.superadmins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Helpers used by policies and functions ----------
create function public.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.profiles where user_id = auth.uid()
$$;

create function public.is_superadmin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.superadmins where user_id = auth.uid())
$$;

-- Admin of the given company (default: the caller's active company).
create function public.is_company_admin(p_company uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = auth.uid()
      and m.company_id = coalesce(p_company, public.current_company_id())
      and m.role = 'admin'
  )
$$;

create function public.is_company_member(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = auth.uid() and m.company_id = p_company
  )
$$;

-- Is p_user a member of the caller's active company?
create function public.is_member_of_current(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = p_user and m.company_id = public.current_company_id()
  )
$$;

-- Role in the active company. A view so the app's `user_roles` reads keep working.
create view public.user_roles with (security_invoker = true) as
  select m.user_id, m.role
  from public.company_memberships m
  where m.company_id = public.current_company_id();

-- ---------- Forms ----------
create table public.esign_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  type text not null check (type in ('deal_memo', 'safety')),
  name text not null,
  deal_points jsonb not null default '[]',
  terms_text text not null default '',
  source_pdf_path text,
  fields jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index esign_templates_company_id_idx on public.esign_templates (company_id);

create table public.timesheet_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  name text not null,
  union_name text,
  source_pdf_path text not null,
  fields jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index timesheet_templates_company_id_idx on public.timesheet_templates (company_id);

-- ---------- Invites ----------
-- One invite per email (the app upserts on email). It stays after sign-up with used = true,
-- because it carries the person's department, role, dates and kit fee.
create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  email text not null unique,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  full_name text,
  phone text,
  department text,
  crew_role text,
  start_date date,
  end_date date,
  kit_fee_enabled boolean not null default false,
  kit_fee_rate numeric,
  requested_documents text[] not null default '{}',
  deal_memo_template_id uuid references public.esign_templates (id) on delete set null,
  safety_template_id uuid references public.esign_templates (id) on delete set null,
  timesheet_template_id uuid references public.timesheet_templates (id) on delete set null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index company_invites_company_id_idx on public.company_invites (company_id);

create table public.department_heads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  department text not null,
  head_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, department, head_user_id)
);
create index department_heads_head_user_id_idx on public.department_heads (head_user_id);

create function public.heads_department(p_company uuid, p_department text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.department_heads h
    where h.company_id = p_company and h.department = p_department and h.head_user_id = auth.uid()
  )
$$;

-- Does the caller head any department in their active company?
create function public.is_dept_head() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.department_heads h
    where h.head_user_id = auth.uid() and h.company_id = public.current_company_id()
  )
$$;

-- ---------- Submissions ----------
-- user_id references auth.users without cascade on purpose: deleting an account that still
-- owns records fails, and the app then offers to purge them (see the delete-user function).
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  file_path text not null,
  doc_type text,
  approval_step integer not null default 1,
  created_at timestamptz not null default now()
);
create index documents_company_id_idx on public.documents (company_id);
create index documents_user_id_idx on public.documents (user_id);

create table public.approval_chain (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  step_order integer not null,
  approver_email text not null,
  label text,
  created_at timestamptz not null default now()
);
create index approval_chain_company_id_idx on public.approval_chain (company_id);

create table public.document_approvals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  step_order integer not null,
  approver_id uuid references auth.users (id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index document_approvals_document_id_idx on public.document_approvals (document_id);

-- Timesheets and contractor invoices (an invoice has entries = {"invoice": {...}} and no week_start).
create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  file_path text not null,
  week_start date,
  entries jsonb,
  total_hours numeric,
  kit_days integer not null default 0,
  kit_rate numeric not null default 0,
  kit_total numeric not null default 0,
  template_id uuid references public.timesheet_templates (id) on delete set null,
  form_values jsonb,
  signature text,
  -- Stamped from the invite when submitted:
  department text,
  employee_name text,
  employee_email text,
  dept_status text not null default 'pending' check (dept_status in ('pending', 'approved', 'rejected')),
  dept_reviewed_by uuid references auth.users (id) on delete set null,
  dept_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index timesheets_company_id_idx on public.timesheets (company_id);
create index timesheets_user_id_idx on public.timesheets (user_id);
create index timesheets_company_department_idx on public.timesheets (company_id, department);

create table public.paystubs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  status text not null default 'issued',
  file_path text not null,
  created_at timestamptz not null default now()
);
create index paystubs_company_id_idx on public.paystubs (company_id);
create index paystubs_user_id_idx on public.paystubs (user_id);

create table public.esign_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id),
  template_id uuid not null references public.esign_templates (id),
  type text not null check (type in ('deal_memo', 'safety')),
  status text not null default 'awaiting_signature'
    check (status in ('awaiting_signature', 'awaiting_countersignature', 'countersigned', 'revoked')),
  field_values jsonb,
  employee_signature text,
  employee_signed_at timestamptz,
  admin_signature text,
  admin_signed_at timestamptz,
  admin_id uuid references auth.users (id) on delete set null,
  final_pdf_path text,
  reject_reason text,
  revoke_reason text,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index esign_records_company_id_idx on public.esign_records (company_id);
create index esign_records_user_id_idx on public.esign_records (user_id);
create index esign_records_template_id_idx on public.esign_records (template_id);

-- ---------- Triggers ----------
-- Make someone a member of the invite's company and mark the invite used.
create function public.accept_invite(p_user uuid, p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.company_invites;
begin
  select * into inv from public.company_invites where id = p_invite;
  if not found then return; end if;
  insert into public.company_memberships (user_id, company_id, role)
  values (p_user, inv.company_id, inv.role)
  on conflict (user_id, company_id) do update
    set role = case when excluded.role = 'admin' then 'admin' else public.company_memberships.role end;
  update public.profiles set company_id = coalesce(company_id, inv.company_id) where user_id = p_user;
  update public.company_invites set used = true where id = p_invite;
end $$;

-- New account: create its profile and accept any waiting invite for that email.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv_id uuid;
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email))
  on conflict (user_id) do nothing;
  for inv_id in select id from public.company_invites where email = lower(new.email) and not used loop
    perform public.accept_invite(new.id, inv_id);
  end loop;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Invites are stored lower-case so they match sign-up emails.
create function public.normalize_invite() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

create trigger company_invites_normalize
  before insert or update on public.company_invites
  for each row execute function public.normalize_invite();

-- Inviting someone who already has an account adds them straight away.
create function public.invite_existing_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if new.used then return null; end if;
  select user_id into uid from public.profiles where lower(email) = new.email;
  if uid is not null then perform public.accept_invite(uid, new.id); end if;
  return null;
end $$;

create trigger company_invites_accept_existing
  after insert or update of email, company_id, used on public.company_invites
  for each row execute function public.invite_existing_user();

-- Timesheets: stamp department, name, email and kit rate from the invite, server-side.
create function public.stamp_timesheet() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.company_invites; em text;
begin
  select email into em from public.profiles where user_id = new.user_id;
  select * into inv from public.company_invites
    where email = lower(em) and company_id = new.company_id
    order by created_at desc limit 1;
  new.employee_email := em;
  new.employee_name := coalesce(inv.full_name, em);
  new.department := inv.department;
  new.kit_rate := case when coalesce(inv.kit_fee_enabled, false) then coalesce(inv.kit_fee_rate, 0) else 0 end;
  new.kit_total := coalesce(new.kit_days, 0) * new.kit_rate;
  new.status := 'pending';
  new.dept_status := 'pending';
  new.dept_reviewed_by := null;
  new.dept_reviewed_at := null;
  return new;
end $$;

create trigger timesheets_stamp
  before insert on public.timesheets
  for each row execute function public.stamp_timesheet();

-- E-sign records take their company from the template.
create function public.stamp_esign_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select company_id into new.company_id from public.esign_templates where id = new.template_id;
  return new;
end $$;

create trigger esign_records_stamp
  before insert on public.esign_records
  for each row execute function public.stamp_esign_record();

-- Employees may only sign their own waiting form; everything else stays as it was.
create function public.guard_esign_record_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_company_admin(old.company_id) then return new; end if;
  if old.user_id is distinct from auth.uid() then
    raise exception 'Not allowed to change this form.';
  end if;
  if old.status <> 'awaiting_signature' or new.status <> 'awaiting_countersignature' then
    raise exception 'You can only sign a form that is waiting for your signature.';
  end if;
  if coalesce(trim(new.employee_signature), '') = '' then
    raise exception 'Type your full name to sign.';
  end if;
  new.id := old.id;
  new.company_id := old.company_id;
  new.user_id := old.user_id;
  new.template_id := old.template_id;
  new.type := old.type;
  new.admin_signature := old.admin_signature;
  new.admin_signed_at := old.admin_signed_at;
  new.admin_id := old.admin_id;
  new.final_pdf_path := old.final_pdf_path;
  new.revoke_reason := old.revoke_reason;
  new.notified_at := old.notified_at;
  new.created_at := old.created_at;
  new.employee_signed_at := now();
  return new;
end $$;

create trigger esign_records_guard
  before update on public.esign_records
  for each row execute function public.guard_esign_record_update();

-- Live status toasts for employees.
alter publication supabase_realtime add table public.documents;
