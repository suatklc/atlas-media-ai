-- Atlas AI — connected publishing accounts (Vault-backed credentials)
-- Run this once in the Supabase SQL Editor (or via `supabase db push` if you
-- have the project linked with the Supabase CLI).
--
-- Revision note: this replaces an earlier plaintext-token draft of this
-- same 0003 migration with a Supabase Vault-backed design. Edited in place
-- (not split into a 0004) because this migration has never been applied to
-- a live database — no application code path has ever executed an insert
-- against connected_accounts; the OAuth callback that would do so
-- (src/app/api/meta/callback/route.ts) still intentionally returns 501.
--
-- Persists per-user, per-destination publishing connections (a Facebook
-- Page, or the Instagram professional account linked to one). One generic
-- table for every provider/platform Atlas will ever connect to, rather
-- than a separate table per platform.
--
-- CREDENTIAL STORAGE: the raw access token is NEVER stored in this table.
-- connected_accounts.credential_secret_id is only a reference to an
-- encrypted secret in Supabase Vault (the built-in supabase_vault/pgsodium
-- extension) — real encryption-at-rest, not application-invented crypto.
-- The only code allowed to read/write vault.secrets is the three
-- SECURITY DEFINER functions below; anon/authenticated have no direct
-- grant on vault.secrets or vault.decrypted_secrets.

-- Pre-installed on Supabase projects by default; `if not exists` keeps
-- this migration idempotent and safe to re-run.
create extension if not exists supabase_vault;

create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('meta')),
  platform text not null check (platform in ('instagram', 'facebook')),
  external_account_id text not null,
  external_account_name text,
  -- Reference only. Nullable: a row may briefly exist before a credential
  -- has been stored. Never selected/inserted directly by application
  -- code — only store_connected_account_credential() ever writes it, and
  -- only get_connected_account_credential() ever resolves it to a secret.
  credential_secret_id uuid references vault.secrets (id) on delete set null,
  token_expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, platform, external_account_id)
);

create index if not exists connected_accounts_user_id_idx
  on public.connected_accounts (user_id);

alter table public.connected_accounts enable row level security;

-- Same owner-only pattern as generated_posts (0002) — auth.uid() = user_id,
-- one policy per operation. No public/anon read policy exists; this table
-- is never intended to be queried directly from a "use client" component.
drop policy if exists "Connected accounts are viewable by owner" on public.connected_accounts;
create policy "Connected accounts are viewable by owner"
  on public.connected_accounts for select
  using (auth.uid() = user_id);

drop policy if exists "Connected accounts are insertable by owner" on public.connected_accounts;
create policy "Connected accounts are insertable by owner"
  on public.connected_accounts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Connected accounts are updatable by owner" on public.connected_accounts;
create policy "Connected accounts are updatable by owner"
  on public.connected_accounts for update
  using (auth.uid() = user_id);

drop policy if exists "Connected accounts are deletable by owner" on public.connected_accounts;
create policy "Connected accounts are deletable by owner"
  on public.connected_accounts for delete
  using (auth.uid() = user_id);

-- Defined here rather than reused from 0001_init.sql's public.set_updated_at()
-- so this migration does not depend on migration execution order: applying
-- 0003 must not require that 0001 has already been run against this
-- database. Functionally identical to 0001's helper; given its own name so
-- it never redefines or collides with it.
create or replace function public.set_connected_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_connected_accounts_updated_at on public.connected_accounts;
create trigger set_connected_accounts_updated_at
  before update on public.connected_accounts
  for each row execute function public.set_connected_accounts_updated_at();

-- RLS on connected_accounts alone is not enough for the functions below:
-- SECURITY DEFINER functions run with the FUNCTION OWNER's privileges and
-- bypass RLS entirely, which is exactly why they can reach vault.secrets
-- (a table anon/authenticated have no grant on at all, revoked explicitly
-- just below). Each function therefore re-verifies auth.uid() = user_id
-- itself, as its own independent ownership boundary, before touching
-- anything in Vault.
revoke all on vault.secrets from anon, authenticated;
revoke all on vault.decrypted_secrets from anon, authenticated;

-- ============================================================
-- store_connected_account_credential(connected_account_id, secret)
-- Creates the Vault secret on first connection, or rotates it in place on
-- reconnect (same vault.secrets row updated, never a second orphaned
-- secret left behind for the same connection). Ownership is verified by
-- requiring the target row's user_id to equal auth.uid() — a caller can
-- only ever act on their OWN connected_accounts row; there is no way to
-- pass an arbitrary vault secret id in, only a connected_accounts id.
-- ============================================================
create or replace function public.store_connected_account_credential(
  p_connected_account_id uuid,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
begin
  select credential_secret_id into v_existing_secret_id
  from public.connected_accounts
  where id = p_connected_account_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Connected account not found or not owned by the caller.';
  end if;

  if v_existing_secret_id is not null then
    perform vault.update_secret(v_existing_secret_id, p_secret);
  else
    v_new_secret_id := vault.create_secret(p_secret);
    update public.connected_accounts
      set credential_secret_id = v_new_secret_id
      where id = p_connected_account_id
        and user_id = auth.uid();
  end if;
end;
$$;

revoke all on function public.store_connected_account_credential(uuid, text) from public;
grant execute on function public.store_connected_account_credential(uuid, text) to authenticated;

-- ============================================================
-- get_connected_account_credential(connected_account_id)
-- The ONLY sanctioned way anywhere in this project to obtain a decrypted
-- token. Takes a connected_accounts id, never a raw vault secret id — a
-- caller cannot name/guess a vault UUID to reach someone else's secret,
-- since this function only ever resolves the id through a row it has
-- independently confirmed belongs to auth.uid(). Returns null (never a
-- distinguishing error) for "not found", "not owned by caller", and "no
-- credential stored yet" alike, so this can't be used to probe whether an
-- id exists that belongs to someone else.
-- ============================================================
create or replace function public.get_connected_account_credential(
  p_connected_account_id uuid
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
    and user_id = auth.uid();

  if not found or v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_decrypted
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_decrypted;
end;
$$;

revoke all on function public.get_connected_account_credential(uuid) from public;
grant execute on function public.get_connected_account_credential(uuid) to authenticated;

-- ============================================================
-- disconnect_connected_account(connected_account_id)
-- Removes both the Vault secret and the connected_accounts row for one
-- connection the caller owns. For future "Disconnect" functionality and
-- for a reconnect flow that fully replaces rather than rotates a
-- connection. Not wired into any route/UI in this task.
-- ============================================================
create or replace function public.disconnect_connected_account(
  p_connected_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select credential_secret_id into v_secret_id
  from public.connected_accounts
  where id = p_connected_account_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Connected account not found or not owned by the caller.';
  end if;

  delete from public.connected_accounts
    where id = p_connected_account_id
      and user_id = auth.uid();

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

revoke all on function public.disconnect_connected_account(uuid) from public;
grant execute on function public.disconnect_connected_account(uuid) to authenticated;
