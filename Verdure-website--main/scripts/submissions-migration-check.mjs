// Fresh pending-migration replay inside a local-only rollback transaction.
// Existing data and migration history are restored even if a check fails.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const status = JSON.parse(execFileSync(`${root}node_modules/.bin/supabase`, ["status", "-o", "json"], { cwd: root, encoding: "utf8", env: process.env }));
assert.match(status.DB_URL, /^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\//);
const migration = readFileSync(new URL("../supabase/migrations/20261004090351_website_submissions.sql", import.meta.url), "utf8");
const sql = `begin;
drop function public.submit_website_request(text,text,text,jsonb);
drop function public.list_website_submissions(text,text,text,uuid,integer);
drop function public.handle_website_submission(text,uuid,text);
drop function public.list_submission_audit(text,uuid,uuid);
drop table public.website_submissions;
drop table public.submission_audit;
drop function verdure_private.prevent_submission_audit_changes();
${migration}
do $$ begin
  if exists(select 1 from pg_class where oid in ('public.website_submissions'::regclass,'public.submission_audit'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
  if exists(select 1 from pg_proc where proname in ('submit_website_request','list_website_submissions','handle_website_submission','list_submission_audit') and prosecdef) then raise exception 'Definer RPC'; end if;
  if has_table_privilege('anon','public.website_submissions','select') or has_table_privilege('authenticated','public.submission_audit','select') or has_table_privilege('service_role','public.submission_audit','update') then raise exception 'Public or mutable grants'; end if;
  begin
    insert into public.website_submissions(kind,contact_name,contact_email,payload,status,handled_at) values('support','Null fixture','null@example.test','{"subject":"Null check","message":"Local fixture only"}','handled',now());
    raise exception 'NULL accountability was accepted';
  exception when check_violation then null; end;
  begin
    perform public.list_website_submissions('fixture',null);
    raise exception 'NULL status was accepted';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;`;
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
console.log("PASS fresh migration replay, RLS, invoker grants, NULL accountability and filter rejection; transaction rolled back");
