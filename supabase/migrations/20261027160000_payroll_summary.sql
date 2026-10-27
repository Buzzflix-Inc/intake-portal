-- Weekly payroll summary for accounting: pay rates on crew records, overtime rules per
-- production, and a payroll-access flag so an accountant who isn't an admin can see it.
-- The summary is an estimate to check before paying through the payroll software.

-- Pay rate on the crew record (the invite), next to the kit fee. Null rate = not set yet.
alter table public.company_invites
  add column pay_rate numeric check (pay_rate is null or pay_rate >= 0),
  add column pay_unit text not null default 'hour' check (pay_unit in ('hour', 'day', 'week'));

-- Overtime for hourly crew. A null threshold turns that rule off.
-- Daily: hours past ot_daily_after are overtime, past dt_daily_after double time.
-- Weekly: regular hours past ot_weekly_after in a week are overtime.
alter table public.companies
  add column ot_daily_after numeric default 8 check (ot_daily_after is null or ot_daily_after > 0),
  add column dt_daily_after numeric default 12 check (dt_daily_after is null or dt_daily_after > 0),
  add column ot_weekly_after numeric check (ot_weekly_after is null or ot_weekly_after > 0),
  add column ot_multiplier numeric not null default 1.5 check (ot_multiplier >= 1),
  add column dt_multiplier numeric not null default 2 check (dt_multiplier >= 1);

-- Admins can always see payroll; anyone else needs this flag.
alter table public.company_memberships
  add column payroll_access boolean not null default false;

create function public.can_view_payroll(p_company uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = auth.uid()
      and m.company_id = coalesce(p_company, public.current_company_id())
      and (m.role = 'admin' or m.payroll_access)
  )
$$;

-- Admins give or take away payroll access.
create function public.set_payroll_access(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.current_company_id();
begin
  if not public.is_company_admin(cid) then raise exception 'Only admins can change payroll access.'; end if;
  update public.company_memberships set payroll_access = coalesce(p_on, false)
   where user_id = p_user and company_id = cid;
  if not found then raise exception 'That person isn''t in this production.'; end if;
end $$;

-- Weeks that have timesheets, newest first, with how many are at each stage.
create function public.payroll_weeks() returns json
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := public.current_company_id();
begin
  if not public.can_view_payroll(cid) then raise exception 'You don''t have payroll access.'; end if;
  return coalesce((
    select json_agg(w order by w.week_start desc) from (
      select t.week_start,
             count(*) filter (where t.status = 'approved')::int as approved,
             count(*) filter (where t.status = 'pending')::int as pending,
             count(*) filter (where t.status = 'rejected')::int as rejected
        from public.timesheets t
       where t.company_id = cid and t.week_start is not null
       group by t.week_start
    ) w
  ), '[]'::json);
end $$;

-- Everything the summary needs for one week (Sunday to Saturday): the crew with their rates,
-- that week's timesheets, contractor invoices dated that week, and the overtime rules.
create function public.payroll_week(p_week date) returns json
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := public.current_company_id();
begin
  if not public.can_view_payroll(cid) then raise exception 'You don''t have payroll access.'; end if;
  return json_build_object(
    'company', (
      select json_build_object('name', c.name, 'ot_daily_after', c.ot_daily_after, 'dt_daily_after', c.dt_daily_after,
        'ot_weekly_after', c.ot_weekly_after, 'ot_multiplier', c.ot_multiplier, 'dt_multiplier', c.dt_multiplier)
        from public.companies c where c.id = cid
    ),
    'crew', coalesce((
      select json_agg(json_build_object(
        'user_id', m.user_id, 'role', m.role, 'email', p.email,
        'name', coalesce(i.full_name, p.email), 'department', i.department, 'crew_role', i.crew_role,
        'start_date', i.start_date, 'end_date', i.end_date,
        'pay_rate', i.pay_rate, 'pay_unit', coalesce(i.pay_unit, 'hour'),
        'kit_fee_rate', case when i.kit_fee_enabled then i.kit_fee_rate end,
        'contractor', coalesce('__contractor__' = any (i.requested_documents), false),
        'has_invite', i.id is not null))
        from public.company_memberships m
        join public.profiles p on p.user_id = m.user_id
        left join lateral (
          select * from public.company_invites ci
           where ci.company_id = cid and ci.email = lower(p.email)
           order by ci.created_at desc limit 1
        ) i on true
       where m.company_id = cid
    ), '[]'::json),
    'timesheets', coalesce((
      select json_agg(json_build_object(
        'id', t.id, 'user_id', t.user_id, 'status', t.status, 'dept_status', t.dept_status,
        'entries', t.entries, 'total_hours', t.total_hours, 'kit_days', t.kit_days, 'kit_rate', t.kit_rate,
        'kit_total', t.kit_total, 'department', t.department, 'employee_name', t.employee_name,
        'employee_email', t.employee_email, 'created_at', t.created_at) order by t.created_at)
        from public.timesheets t
       where t.company_id = cid and t.week_start = p_week
    ), '[]'::json),
    'invoices', coalesce((
      select json_agg(json_build_object(
        'id', t.id, 'user_id', t.user_id, 'status', t.status, 'invoice', t.entries -> 'invoice',
        'employee_name', t.employee_name, 'employee_email', t.employee_email, 'created_at', t.created_at) order by t.created_at)
        from public.timesheets t
       where t.company_id = cid and t.week_start is null and t.entries ? 'invoice'
         and (t.entries -> 'invoice' ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
         and (t.entries -> 'invoice' ->> 'date')::date between p_week and p_week + 6
    ), '[]'::json)
  );
end $$;

revoke all on function public.can_view_payroll(uuid) from public, anon;
revoke all on function public.set_payroll_access(uuid, boolean) from public, anon;
revoke all on function public.payroll_weeks() from public, anon;
revoke all on function public.payroll_week(date) from public, anon;
grant execute on function public.can_view_payroll(uuid) to authenticated;
grant execute on function public.set_payroll_access(uuid, boolean) to authenticated;
grant execute on function public.payroll_weeks() to authenticated;
grant execute on function public.payroll_week(date) to authenticated;
