-- In-app notification records. Paired with a real Resend email send at the
-- same call site (see lib/notifications/send.ts) — this table is the
-- in-app half, not a queue Resend reads from.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());

-- The only user-initiated write in the whole app that isn't service-role
-- gated: marking your own notification read is safe for any authenticated
-- user to do directly, scoped to rows they already own.
create policy "notifications_update_own_read_at" on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
