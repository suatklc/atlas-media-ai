-- Run AS atlas_ops_reader (password from pgpass, never typed or shown):
--   node scripts/ops-psql.mjs -f supabase/ops/0006_verify_reader.sql
-- Prints only booleans, counts and PASS/FAIL/SKIP lines — never row values.
-- Write probes match zero rows (WHERE false) inside a transaction that is
-- always rolled back, so no production row can change.
--
-- Result labels:
--   PASS (denied)  42501 insufficient_privilege
--   SKIP           the probed relation/function does not exist here
--   FAIL           the probe was allowed, or failed for an unexpected reason
-- View write probes are not judged by error code alone: a join view is not
-- auto-updatable, so Postgres rejects INSERT with 55000 BEFORE checking
-- privileges. The privilege metadata block below is the authority for
-- view writes; 55000 counts as PASS only when that metadata also shows no
-- write privilege.

\set ON_ERROR_STOP on

select current_user = 'atlas_ops_reader' as connected_as_reader;

-- Allowed reads: counts only
select
  (select count(*) from ops.post_publish_status) as posts,
  (select count(*) from ops.telegram_job_status) as telegram_jobs,
  (select count(*) from ops.automation_run_status) as automation_runs;

-- View write privileges from metadata (expect all false; granted = SELECT only)
select v as view,
       has_table_privilege(current_user, v, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as any_table_write,
       has_any_column_privilege(current_user, v, 'INSERT,UPDATE,REFERENCES') as any_column_write,
       (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.table_privileges t
         where t.table_schema = 'ops' and 'ops.' || t.table_name = v and t.grantee = current_user) as granted
from unnest(array['ops.post_publish_status', 'ops.telegram_job_status', 'ops.automation_run_status']) v;

begin read write;
do $$
declare
  -- {probe SQL, object it needs (relation or function signature)}
  probes text[][] := array[
    ['select 1 from public.generated_posts limit 0', 'public.generated_posts'],
    ['select 1 from public.telegram_jobs limit 0', 'public.telegram_jobs'],
    ['select 1 from public.telegram_updates limit 0', 'public.telegram_updates'],
    ['select 1 from public.automation_runs limit 0', 'public.automation_runs'],
    ['select 1 from public.notifications limit 0', 'public.notifications'],
    ['select 1 from public.connected_accounts limit 0', 'public.connected_accounts'],
    ['select 1 from public.profiles limit 0', 'public.profiles'],
    ['select 1 from ops.reader_scope limit 0', 'ops.reader_scope'],
    ['select 1 from auth.users limit 0', 'auth.users'],
    ['select 1 from vault.secrets limit 0', 'vault.secrets'],
    ['select 1 from vault.decrypted_secrets limit 0', 'vault.decrypted_secrets'],
    ['select 1 from storage.objects limit 0', 'storage.objects'],
    ['update public.generated_posts set status = status where false', 'public.generated_posts'],
    ['update public.telegram_jobs set state = state where false', 'public.telegram_jobs'],
    ['delete from public.automation_runs where false', 'public.automation_runs'],
    ['insert into ops.reader_scope (user_id) select null::uuid where false', 'ops.reader_scope'],
    ['insert into ops.post_publish_status (post_id) select null::uuid where false', 'ops.post_publish_status'],
    ['update ops.telegram_job_status set state = state where false', 'ops.telegram_job_status'],
    ['delete from ops.automation_run_status where false', 'ops.automation_run_status'],
    ['create table ops.ops_reader_probe (x int)', 'ops'],
    ['create table public.ops_reader_probe (x int)', 'public'],
    ['create schema ops_reader_probe', ''],
    ['select public.get_connected_account_credential(null::uuid)', 'public.get_connected_account_credential(uuid)'],
    ['select public.get_connected_account_credential_for_user(null::uuid, null::uuid)', 'public.get_connected_account_credential_for_user(uuid, uuid)'],
    ['select public.store_connected_account_credential(null::uuid, null::text)', 'public.store_connected_account_credential(uuid, text)'],
    ['select public.disconnect_connected_account(null::uuid)', 'public.disconnect_connected_account(uuid)']
  ];
  probe text;
  needs text;
  present boolean;
  view_write boolean;
  i int;
begin
  for i in 1 .. array_length(probes, 1) loop
    probe := probes[i][1];
    needs := probes[i][2];
    -- Existence via catalog lookup. A lookup into a schema the reader cannot
    -- use raises 42501 itself: that object is treated as present, so the
    -- probe still runs and must be denied.
    begin
      present := case
        when needs = '' then true
        when needs like '%(%' then to_regprocedure(needs) is not null
        when needs like '%.%' then to_regclass(needs) is not null
        else to_regnamespace(needs) is not null
      end;
    exception when insufficient_privilege then
      present := true;
    end;
    if not present then
      raise notice 'SKIP (does not exist): %', probe;
      continue;
    end if;
    begin
      execute probe;
      raise notice 'FAIL (allowed): %', probe;
    exception
      when insufficient_privilege then
        raise notice 'PASS (denied): %', probe;
      when object_not_in_prerequisite_state then
        -- 55000: view not auto-updatable; judge by privilege metadata.
        view_write := has_table_privilege(current_user, needs, 'INSERT,UPDATE,DELETE,TRUNCATE')
                      or has_any_column_privilege(current_user, needs, 'INSERT,UPDATE');
        if view_write then
          raise notice 'FAIL (55000 but write privilege granted): %', probe;
        else
          raise notice 'PASS (not updatable + no write privilege): %', probe;
        end if;
      when undefined_table or undefined_function then
        raise notice 'SKIP (does not exist, sqlstate %): %', sqlstate, probe;
      when others then
        raise notice 'FAIL (unexpected sqlstate %): %', sqlstate, probe;
    end;
  end loop;
end
$$;
rollback;
