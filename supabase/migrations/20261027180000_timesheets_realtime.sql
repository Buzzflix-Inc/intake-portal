-- Live timesheet updates: employees' lists refresh when a timesheet is approved or rejected (#22).
-- Realtime only delivers rows the subscriber can select, so the existing RLS on timesheets applies.
-- replica identity full: handleReviewUpdate() in src/js/ui/notifications.js compares payload.old.status;
-- without it `old` only carries the primary key and every update would reload the list.
alter table public.timesheets replica identity full;

alter publication supabase_realtime add table public.timesheets;
