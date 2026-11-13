-- Removes everything 0006 created. Run as postgres in the SQL Editor.
-- Touches no existing table, row or role other than atlas_ops_reader.

-- Immediate kill switch (no data change), if needed before full removal:
--   alter role atlas_ops_reader nologin;

begin;
alter role atlas_ops_reader nologin;
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'atlas_ops_reader';
revoke all on all tables in schema ops from atlas_ops_reader;
revoke all on schema ops from atlas_ops_reader;
drop view if exists ops.post_publish_status, ops.telegram_job_status, ops.automation_run_status;
drop table if exists ops.reader_scope;
drop schema if exists ops restrict; -- refuses if anything unexpected remains in ops
drop role if exists atlas_ops_reader;
commit;

-- Check (expect both false):
-- select exists (select 1 from pg_roles where rolname = 'atlas_ops_reader') as role_exists,
--        exists (select 1 from pg_namespace where nspname = 'ops') as schema_exists;
-- Locally: delete the atlas_ops_reader line from %APPDATA%\postgresql\pgpass.conf.
