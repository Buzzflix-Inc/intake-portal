-- Internal functions must not be callable through the API (/rest/v1/rpc/...).
-- accept_invite in particular would let someone join a company with any invite id.
-- Trigger functions still run without EXECUTE grants.
revoke execute on function public.accept_invite(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.invite_existing_user() from public, anon, authenticated;
revoke execute on function public.normalize_invite() from public, anon, authenticated;
revoke execute on function public.stamp_timesheet() from public, anon, authenticated;
revoke execute on function public.stamp_esign_record() from public, anon, authenticated;
revoke execute on function public.guard_esign_record_update() from public, anon, authenticated;

-- The helpers (current_company_id, is_company_admin, can_view_user_files...) stay callable by
-- signed-in users because row-level security policies run them as the caller. They only answer
-- questions about the caller's own access.

-- Cover the remaining foreign keys.
create index company_invites_deal_memo_template_id_idx on public.company_invites (deal_memo_template_id);
create index company_invites_safety_template_id_idx on public.company_invites (safety_template_id);
create index company_invites_timesheet_template_id_idx on public.company_invites (timesheet_template_id);
create index document_approvals_approver_id_idx on public.document_approvals (approver_id);
create index esign_records_admin_id_idx on public.esign_records (admin_id);
create index timesheets_dept_reviewed_by_idx on public.timesheets (dept_reviewed_by);
create index timesheets_template_id_idx on public.timesheets (template_id);
