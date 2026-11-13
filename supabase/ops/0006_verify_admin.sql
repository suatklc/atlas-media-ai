-- 0006 admin verification — run as postgres in the Supabase SQL Editor.
-- Stage: after migration + reader_scope insert, BEFORE password/LOGIN.
-- One SELECT; returns only metadata, booleans, counts and names.
-- No row values, secrets or function bodies; calls no user function.
-- PUBLIC grants are read from ACLs (aclexplode grantee = 0, NULL ACL ->
-- acldefault). Effective reader privileges use has_*_privilege on the
-- real role atlas_ops_reader (which includes what PUBLIC grants it).
with
rr as (select * from pg_roles where rolname = 'atlas_ops_reader'),
ops_ns as (select oid, nspacl, nspowner from pg_namespace where nspname = 'ops'),
ops_rel as (
  select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.reloptions, c.relrowsecurity
  from pg_class c
  where c.relnamespace = (select oid from ops_ns) and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
),
rel_priv as (
  select n.nspname || '.' || c.relname as rel,
         has_table_privilege('atlas_ops_reader', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as write_like,
         -- object privilege alone is not usable access: the schema must be usable too
         has_schema_privilege('atlas_ops_reader', n.oid, 'USAGE') as schema_access
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'v', 'm', 'f', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and (has_table_privilege('atlas_ops_reader', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege('atlas_ops_reader', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
),
ops_acl as (
  select 'ops' as obj, a.grantee, a.privilege_type
  from ops_ns, aclexplode(coalesce(ops_ns.nspacl, acldefault('n', ops_ns.nspowner))) a
  union all
  select 'ops.' || r.relname, a.grantee, a.privilege_type
  from ops_rel r, aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) a
),
checks as (
  -- ===== Role =====
  select 1 as ord, 'role exists' as check_name, 'true' as expected,
         ((select count(*) from rr) = 1)::text as actual
  union all select 2, 'role can login (stage: before password)', 'false', (select rolcanlogin::text from rr)
  union all select 3, 'super/createrole/createdb/replication/bypassrls', 'false/false/false/false/false',
         (select format('%s/%s/%s/%s/%s', rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls) from rr)
  union all select 4, 'role inherit', 'false', (select rolinherit::text from rr)
  union all select 5, 'connection limit', '3', (select rolconnlimit::text from rr)
  union all select 6, 'role setting names (values not shown)',
         'default_transaction_read_only,idle_in_transaction_session_timeout,lock_timeout,search_path,statement_timeout',
         (select string_agg(split_part(c, '=', 1), ',' order by split_part(c, '=', 1)) from rr, unnest(rr.rolconfig) c)
  union all select 7, 'roles the reader is a member of', '0',
         (select count(*)::text from pg_auth_members m where m.member = (select oid from rr))
  union all select 8, 'roles that are members of the reader', '(info) only the creator, if any',
         coalesce((select string_agg(pg_get_userbyid(m.member) || case when m.admin_option then ' (admin)' else '' end, ', ')
                   from pg_auth_members m where m.roleid = (select oid from rr)), 'none')

  -- ===== Database =====
  union all select 10, 'reader CREATE on database', 'false',
         has_database_privilege('atlas_ops_reader', current_database(), 'CREATE')::text
  union all select 11, 'PUBLIC grants on database (grantee=0)', '(info) known limit: CONNECT,TEMPORARY',
         coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                   from pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
                   where d.datname = current_database() and a.grantee = 0), 'none')

  -- ===== Schemas =====
  union all select 20, 'schemas where reader has CREATE', 'none',
         coalesce((select string_agg(nspname, ',' order by nspname) from pg_namespace
                   where has_schema_privilege('atlas_ops_reader', oid, 'CREATE')), 'none')
  union all select 21, 'schemas where reader has USAGE', '(info) ops + PUBLIC-usable schemas',
         (select string_agg(nspname, ',' order by nspname) from pg_namespace
          where nspname not like 'pg_toast%' and nspname not like 'pg_temp%'
            and has_schema_privilege('atlas_ops_reader', oid, 'USAGE'))
  union all select 22, 'reader USAGE on vault/auth/storage', 'false/false/false',
         format('%s/%s/%s',
           coalesce(has_schema_privilege('atlas_ops_reader', to_regnamespace('vault'), 'USAGE'), false),
           coalesce(has_schema_privilege('atlas_ops_reader', to_regnamespace('auth'), 'USAGE'), false),
           coalesce(has_schema_privilege('atlas_ops_reader', to_regnamespace('storage'), 'USAGE'), false))

  -- ===== Relations =====
  union all select 30, 'relations with an OBJECT privilege (incl. via PUBLIC), schema not checked',
         '(info) may include objects in schemas the reader cannot use',
         coalesce((select string_agg(rel || case when schema_access then '' else ' [schema closed]' end, ',' order by rel)
                   from rel_priv), 'none')
  union all select 31, 'relations USABLE by the reader (object privilege + schema USAGE)',
         'ops.automation_run_status,ops.post_publish_status,ops.telegram_job_status',
         coalesce((select string_agg(rel, ',' order by rel) from rel_priv where schema_access), 'none')
  union all select 34, 'usable write-like privilege on any relation', 'false',
         coalesce((select bool_or(write_like) from rel_priv where schema_access), false)::text
  union all select 32, 'sequences usable by reader', '0',
         (select count(*)::text from pg_class c where c.relkind = 'S'
            and has_sequence_privilege('atlas_ops_reader', c.oid, 'USAGE,SELECT,UPDATE'))
  union all select 33, 'SELECT on sensitive/base tables', 'all false',
         (select string_agg(t || '=' || coalesce(has_table_privilege('atlas_ops_reader', to_regclass(t), 'SELECT'), false)::text, ', ')
          from unnest(array['vault.secrets', 'vault.decrypted_secrets', 'auth.users', 'public.connected_accounts',
                            'public.generated_posts', 'public.telegram_jobs', 'public.telegram_updates',
                            'public.automation_runs', 'public.notifications', 'public.profiles', 'ops.reader_scope']) t)

  -- ===== Functions =====
  union all select 40, 'SECURITY DEFINER functions reader can execute (usable schema)', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
            and has_schema_privilege('atlas_ops_reader', n.oid, 'USAGE')
            and has_function_privilege('atlas_ops_reader', p.oid, 'EXECUTE'))
  union all select 41, 'credential fns executable: get/get_for_user/store/disconnect', 'false/false/false/false',
         format('%s/%s/%s/%s',
           coalesce(has_function_privilege('atlas_ops_reader', to_regprocedure('public.get_connected_account_credential(uuid)'), 'EXECUTE'), false),
           coalesce(has_function_privilege('atlas_ops_reader', to_regprocedure('public.get_connected_account_credential_for_user(uuid, uuid)'), 'EXECUTE'), false),
           coalesce(has_function_privilege('atlas_ops_reader', to_regprocedure('public.store_connected_account_credential(uuid, text)'), 'EXECUTE'), false),
           coalesce(has_function_privilege('atlas_ops_reader', to_regprocedure('public.disconnect_connected_account(uuid)'), 'EXECUTE'), false))

  -- ===== Grants on the new ops objects =====
  union all select 50, 'ops grants to PUBLIC (grantee=0)/anon/authenticated/service_role', 'none',
         coalesce((select string_agg(obj || ':' || case when grantee = 0 then 'PUBLIC' else pg_get_userbyid(grantee) end
                                     || ':' || privilege_type, ', ' order by obj)
                   from ops_acl
                   where grantee = 0 or pg_get_userbyid(grantee) in ('anon', 'authenticated', 'service_role')), 'none')
  union all select 51, 'reader grants inside ops',
         'ops.automation_run_status:SELECT,ops.post_publish_status:SELECT,ops.telegram_job_status:SELECT,ops:USAGE',
         coalesce((select string_agg(obj || ':' || privilege_type, ',' order by obj || ':' || privilege_type)
                   from ops_acl where grantee = (select oid from rr)), 'none')
  union all select 52, 'pg_default_acl entries for ops', '0',
         (select count(*)::text from pg_default_acl where defaclnamespace = (select oid from ops_ns))

  -- ===== ops objects =====
  union all select 60, 'ops relations', 'automation_run_status:v,post_publish_status:v,reader_scope:r,telegram_job_status:v',
         (select string_agg(relname || ':' || relkind, ',' order by relname) from ops_rel)
  union all select 61, 'views with security_barrier=true', '3',
         (select count(*)::text from ops_rel where relkind = 'v' and 'security_barrier=true' = any(reloptions))
  union all select 62, 'view owner', 'postgres',
         (select string_agg(distinct pg_get_userbyid(relowner), ',') from ops_rel where relkind = 'v')
  union all select 63, 'reader_scope RLS enabled', 'true',
         (select relrowsecurity::text from ops_rel where relname = 'reader_scope')
  union all select 64, 'reader_scope row count', '1', (select count(*)::text from ops.reader_scope)
  union all select 65, 'ops in PostgREST db_schemas (authenticator config)', 'false',
         coalesce((select bool_or(cfg ~ '(=|,|\s)ops(,|\s|$)') from pg_roles, unnest(coalesce(rolconfig, '{}')) cfg
                   where rolname = 'authenticator' and cfg like 'pgrst.db_schemas=%'), false)::text

  -- ===== Columns (names only) =====
  union all select 70, 'columns post_publish_status',
         'post_id,status,created_at,output_mode,is_test,review_rejected,instagram_state,instagram_state_at,instagram_has_error,instagram_media_recorded,facebook_state,facebook_state_at,facebook_has_error,facebook_post_recorded',
         (select string_agg(attname, ',' order by attnum) from pg_attribute
          where attrelid = to_regclass('ops.post_publish_status') and attnum > 0 and not attisdropped)
  union all select 71, 'columns telegram_job_status',
         'job_id,post_id,state,revision,instagram_state,facebook_state,has_error,created_at,updated_at',
         (select string_agg(attname, ',' order by attnum) from pg_attribute
          where attrelid = to_regclass('ops.telegram_job_status') and attnum > 0 and not attisdropped)
  union all select 72, 'columns automation_run_status',
         'run_id,run_kind,run_date,status,post_id,has_error,started_at,finished_at',
         (select string_agg(attname, ',' order by attnum) from pg_attribute
          where attrelid = to_regclass('ops.automation_run_status') and attnum > 0 and not attisdropped)

  -- ===== Row scope (counts only) =====
  union all select 80, 'post view count = scoped generated_posts count', 'true',
         ((select count(*) from ops.post_publish_status)
          = (select count(*) from public.generated_posts g join ops.reader_scope s using (user_id)))::text
  union all select 81, 'telegram view count = scoped telegram_jobs count', 'true',
         ((select count(*) from ops.telegram_job_status)
          = (select count(*) from public.telegram_jobs j join ops.reader_scope s using (user_id)))::text
  union all select 82, 'automation view count = scoped automation_runs count', 'true',
         ((select count(*) from ops.automation_run_status)
          = (select count(*) from public.automation_runs a join ops.reader_scope s using (user_id)))::text
)
select ord, check_name, expected, actual,
       case
         when expected like '(info)%' then null
         when ord = 33 then actual !~ '=true'
         else actual is not distinct from expected
       end as pass
from checks
order by ord;
