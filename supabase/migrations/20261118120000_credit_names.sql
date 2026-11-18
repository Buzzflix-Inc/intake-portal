-- Preferred name for screen credits, asked for once at sign-up and editable in Account.
-- Kept on the profile (one per person, across productions), separate from the legal name on the
-- invite that deal memos and payroll use. Admins already read their crew's profiles (RLS on
-- profiles is unchanged); people change their own only through set_my_credit_name.

alter table public.profiles
  add column credit_first_name text,
  add column credit_last_name text;

create function public.set_my_credit_name(p_first text, p_last text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  fn text := nullif(trim(coalesce(p_first, '')), '');
  ln text := nullif(trim(coalesce(p_last, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if fn is null or ln is null then raise exception 'Enter a first and last name for your credit.'; end if;
  if length(fn) > 60 or length(ln) > 60 then raise exception 'That''s too long.'; end if;
  update public.profiles set credit_first_name = fn, credit_last_name = ln where user_id = auth.uid();
end $$;

revoke all on function public.set_my_credit_name(text, text) from public, anon;
grant execute on function public.set_my_credit_name(text, text) to authenticated;
