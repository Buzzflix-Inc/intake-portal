-- Audit log: who changed what, and when. Written by triggers, readable by super admins only.

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  table_name text not null,
  action text not null,
  row_id text,
  company_id uuid,
  summary text,
  changed text[]
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_table_name_idx on public.audit_log (table_name);

alter table public.audit_log enable row level security;
create policy "super admins read the audit log" on public.audit_log
  for select to authenticated
  using ((select public.is_superadmin()));

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  ch text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into ch
    from jsonb_object_keys(n) as k
    where n -> k is distinct from o -> k;
    if ch is null then return new; end if;
  end if;
  insert into public.audit_log (actor_id, actor_email, table_name, action, row_id, company_id, changed)
  values (
    auth.uid(),
    auth.jwt() ->> 'email',
    tg_table_name,
    lower(tg_op),
    r ->> 'id',
    case when tg_table_name = 'companies' then (r ->> 'id')::uuid else (r ->> 'company_id')::uuid end,
    ch
  );
  return coalesce(new, old);
end $$;

revoke all on function public.audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'company_memberships', 'company_invites', 'department_heads',
    'documents', 'approval_chain', 'timesheets', 'paystubs',
    'esign_templates', 'esign_records', 'timesheet_templates'
  ] loop
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$s
         for each row execute function public.audit_row()', t);
  end loop;
end $$;
