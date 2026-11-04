-- Automation V1 (Handoff 10): scheduled draft generation + notifications.
-- Both tables are written by the cron route with the service-role key
-- (server-only, never reaches the browser) and read by the owner through
-- RLS. Nothing here publishes anything: a generated draft still needs
-- explicit approval, then the explicit "Seçili Platformlarda Yayınla".

-- One row per scheduled run (user + Turkey-local date). The unique key is
-- the duplicate/concurrency lock: a second invocation for the same day
-- cannot insert its own row, so at most one draft is produced per day.
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_key text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  slot_label text,
  topic text,
  post_id uuid references public.generated_posts (id) on delete set null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, run_key)
);

alter table public.automation_runs enable row level security;

drop policy if exists "Automation runs are viewable by owner" on public.automation_runs;
create policy "Automation runs are viewable by owner"
  on public.automation_runs for select
  using (auth.uid() = user_id);

-- In-app notifications (dashboard bell) + the Telegram delivery state of
-- each one. telegram_error holds a short reason only, never a token.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('draft_ready', 'run_failed')),
  title text not null,
  body text,
  link text,
  post_id uuid references public.generated_posts (id) on delete set null,
  telegram_status text not null default 'pending' check (telegram_status in ('pending', 'sent', 'failed', 'skipped')),
  telegram_error text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Notifications are viewable by owner" on public.notifications;
create policy "Notifications are viewable by owner"
  on public.notifications for select
  using (auth.uid() = user_id);

-- The owner may only mark notifications read (column-level grant below).
drop policy if exists "Notifications are updatable by owner" on public.notifications;
create policy "Notifications are updatable by owner"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Table privileges, on top of RLS (Supabase grants every role ALL on new
-- public tables by default). Writes come only from the service role.
--   anon:          nothing.
--   authenticated: SELECT on both tables; UPDATE of notifications.read_at
--                  only. No INSERT, DELETE, TRUNCATE, REFERENCES or TRIGGER.
revoke all on public.automation_runs from anon, authenticated;
revoke all on public.notifications from anon, authenticated;

grant select on public.automation_runs to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
