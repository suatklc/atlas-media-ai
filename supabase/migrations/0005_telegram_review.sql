-- Telegram review flow (instruction -> draft -> Onayla / Düzelt / Reddet ->
-- explicit publish). Written and read only by the server with the
-- service-role key (/api/telegram/webhook, after its secret + chat checks).
-- Nothing here publishes by itself; publishing still goes through the
-- existing publishToSelectedPlatforms after an explicit Telegram choice.

-- Telegram re-delivers an update until it gets a 200; the primary key makes
-- every update_id processed at most once.
create table if not exists public.telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

-- One row per instruction. `revision` changes on every correction, and
-- every button carries the revision it was sent with, so a button from an
-- earlier preview (or a second tap) can never approve or publish.
create table if not exists public.telegram_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instruction text not null,
  post_id uuid references public.generated_posts (id) on delete set null,
  state text not null check (state in (
    'generating', 'awaiting_review', 'awaiting_correction', 'approved', 'publishing', 'published', 'rejected', 'failed'
  )),
  revision integer not null default 1,
  publish_results jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_jobs_user_id_updated_at_idx
  on public.telegram_jobs (user_id, updated_at desc);

alter table public.telegram_updates enable row level security;
alter table public.telegram_jobs enable row level security;

-- Server-only tables: no browser role gets anything.
revoke all on public.telegram_updates from anon, authenticated;
revoke all on public.telegram_jobs from anon, authenticated;

-- get_connected_account_credential (0003) checks auth.uid(), which is empty
-- for the server's service-role client, so a Telegram-approved publish
-- could not read the publishing token. This variant takes the owner id
-- explicitly and is executable ONLY by service_role (never anon /
-- authenticated); it still only returns the credential of a connected
-- account that belongs to that user.
create or replace function public.get_connected_account_credential_for_user(
  p_connected_account_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_decrypted text;
begin
  select credential_secret_id into v_secret_id
  from public.connected_accounts
  where id = p_connected_account_id
    and user_id = p_user_id;

  if not found or v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_decrypted
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_decrypted;
end;
$$;

revoke all on function public.get_connected_account_credential_for_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_connected_account_credential_for_user(uuid, uuid) to service_role;
