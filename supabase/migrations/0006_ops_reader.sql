-- 0006: Atlas salt okunur operasyon erişimi (rol NOLOGIN olarak başlar)
--
-- NOT applied automatically. Paste into the Supabase SQL Editor as postgres.
--
-- One dedicated role may read ONLY operational status — Telegram job
-- states, automation run results, per-platform publish states — for ONE
-- scoped Atlas user. No content bodies, captions, instructions, topics,
-- image URLs, raw publish_results, error text, tokens, Vault, connected
-- accounts or auth data.
--
-- - The role starts NOLOGIN with no password; login is enabled separately
--   only after the password is set and the admin verification passes.
-- - Aborts without changing anything if the role or schema already exists.
-- - Existing roles, tables, functions and default privileges are not
--   changed; the revokes below apply only to objects created here.

begin;

-- Önceden var olan nesneyle karışmasın: varsa hiçbir şey yapmadan dur.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'atlas_ops_reader') then
    raise exception 'atlas_ops_reader already exists — aborting, nothing changed';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'ops') then
    raise exception 'schema ops already exists — aborting, nothing changed';
  end if;
end
$$;

-- ===== Rol: parola yok, giriş kapalı =====
create role atlas_ops_reader
  with nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 3;

-- Oturum varsayılanları (kolaylık; güvenlik sınırı aşağıdaki GRANT'lerdir)
alter role atlas_ops_reader set default_transaction_read_only = on;
alter role atlas_ops_reader set statement_timeout = '10s';
alter role atlas_ops_reader set lock_timeout = '2s';
alter role atlas_ops_reader set idle_in_transaction_session_timeout = '30s';
alter role atlas_ops_reader set search_path = ops;

-- ===== Şema (Data API'de açık değil) =====
create schema ops;
revoke all on schema ops from public, anon, authenticated, service_role;

-- ===== Satır kapsamı: tam olarak bir Atlas kullanıcısı (boşsa view'lar boş döner) =====
create table ops.reader_scope (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users (id) on delete cascade
);
alter table ops.reader_scope enable row level security;
revoke all on ops.reader_scope from public, anon, authenticated, service_role, atlas_ops_reader;

-- ===== Gönderi başına platform yayın durumu =====
create view ops.post_publish_status with (security_barrier = true) as
select
  g.id as post_id,
  g.status,
  g.created_at,
  case when g.metadata ->> 'outputMode' in ('carousel', 'single') then g.metadata ->> 'outputMode' end as output_mode,
  (position('TEST — YAYINLAMAYIN' in g.content) > 0
    or position('TEST — YAYINLAMAYIN' in coalesce(g.metadata #>> '{contentPackage,topic}', '')) > 0) as is_test,
  coalesce(g.metadata #>> '{review,state}' = 'rejected', false) as review_rejected,
  case
    when r.ig ->> 'state' in ('publishing', 'published', 'failed', 'uncertain') then r.ig ->> 'state'
    when r.ig is not null then 'unknown'
  end as instagram_state,
  case when r.ig ->> 'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    then (r.ig ->> 'at')::timestamptz end as instagram_state_at,
  coalesce(r.ig ? 'error', false) as instagram_has_error,
  coalesce(jsonb_typeof(g.metadata -> 'instagramMediaId') = 'string', false) as instagram_media_recorded,
  case
    when r.fb ->> 'state' in ('publishing', 'published', 'failed', 'uncertain') then r.fb ->> 'state'
    when r.fb is not null then 'unknown'
  end as facebook_state,
  case when r.fb ->> 'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    then (r.fb ->> 'at')::timestamptz end as facebook_state_at,
  coalesce(r.fb ? 'error', false) as facebook_has_error,
  coalesce(jsonb_typeof(r.fb -> 'postId') = 'string', false) as facebook_post_recorded
from public.generated_posts g
join ops.reader_scope s on s.user_id = g.user_id
cross join lateral (
  select
    case when jsonb_typeof(g.metadata #> '{publishResults,instagram}') = 'object' then g.metadata #> '{publishResults,instagram}' end as ig,
    case when jsonb_typeof(g.metadata #> '{publishResults,facebook}') = 'object' then g.metadata #> '{publishResults,facebook}' end as fb
) r;

-- ===== Telegram iş durumu =====
create view ops.telegram_job_status with (security_barrier = true) as
select
  j.id as job_id,
  j.post_id,
  j.state,
  j.revision,
  case
    when j.publish_results ->> 'instagram' in ('sending', 'published', 'failed', 'uncertain') then j.publish_results ->> 'instagram'
    when jsonb_typeof(j.publish_results) = 'object' and j.publish_results ? 'instagram' then 'unknown'
  end as instagram_state,
  case
    when j.publish_results ->> 'facebook' in ('sending', 'published', 'failed', 'uncertain') then j.publish_results ->> 'facebook'
    when jsonb_typeof(j.publish_results) = 'object' and j.publish_results ? 'facebook' then 'unknown'
  end as facebook_state,
  j.error is not null as has_error,
  j.created_at,
  j.updated_at
from public.telegram_jobs j
join ops.reader_scope s on s.user_id = j.user_id;

-- ===== Otomasyon çalışmaları =====
create view ops.automation_run_status with (security_barrier = true) as
select
  a.id as run_id,
  case when a.run_key like 'test-compose:%' or a.slot_label = 'TEST' then 'test' else 'scheduled' end as run_kind,
  case when a.run_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then a.run_key::date end as run_date,
  a.status,
  a.post_id,
  a.error is not null as has_error,
  a.started_at,
  a.finished_at
from public.automation_runs a
join ops.reader_scope s on s.user_id = a.user_id;

-- ===== Yetkiler: yalnız bu üç view, yalnız SELECT =====
revoke all on ops.post_publish_status, ops.telegram_job_status, ops.automation_run_status
  from public, anon, authenticated, service_role;
grant usage on schema ops to atlas_ops_reader;
grant select on ops.post_publish_status, ops.telegram_job_status, ops.automation_run_status to atlas_ops_reader;

commit;

-- Sonraki adımlar (her biri ayrı, onayla; hiçbiri git'e girmez):
-- 1. insert into ops.reader_scope (user_id) values ('<ATLAS_AUTOMATION_USER_ID>');
-- 2. alter role atlas_ops_reader password '<scripts/ops-reader-password.mjs çıktısındaki SCRAM verifier>';
-- 3. supabase/ops/0006_verify_admin.sql (postgres olarak) — rolcanlogin = false beklenir.
-- 4. Yalnız 3 temizse: alter role atlas_ops_reader login;
-- 5. supabase/ops/0006_verify_reader.sql (psql, atlas_ops_reader olarak).
