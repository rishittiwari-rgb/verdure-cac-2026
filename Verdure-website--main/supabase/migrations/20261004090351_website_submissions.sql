-- E2/E3 and B4. Only the website server has the service-role credential.
-- Every staff RPC is preceded by a canonical Firebase admin check on the server.
-- Supabase website accounts, anon keys and editable profile metadata grant no
-- inbox access. RPCs use invoker privileges, never SECURITY DEFINER.
create schema if not exists verdure_private;
-- Advisor found these two legacy constant SQL helpers had mutable paths.
-- They reference no tables or extensions; fixing the path preserves behavior.
alter function public.waitlist_notice_cap() set search_path = '';
alter function public.waitlist_list_limit() set search_path = '';
revoke all on schema verdure_private from public, anon, authenticated;

create table public.website_submissions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('support', 'organizer', 'merchant')),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 100),
  contact_email text not null check (length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  status text not null default 'pending' check (status in ('pending', 'handled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by text,
  handling_note text,
  constraint handled_requires_accountability check (
    (status = 'pending' and handled_at is null and handled_by is null and handling_note is null) or
    coalesce(status = 'handled' and handled_at is not null and length(btrim(handled_by)) between 1 and 128 and length(btrim(handling_note)) between 3 and 1000, false)
  ),
  constraint required_submission_fields check (case kind
    when 'support' then coalesce(length(btrim(payload->>'subject')) between 2 and 160 and length(btrim(payload->>'message')) between 10 and 4000, false)
    when 'organizer' then coalesce(length(btrim(payload->>'organization')) between 1 and 160 and length(btrim(payload->>'organizationType')) between 1 and 80 and
      jsonb_typeof(payload->'eventsPerMonth') = 'number' and (payload->>'eventsPerMonth')::numeric between 0 and 10000 and
      trunc((payload->>'eventsPerMonth')::numeric) = (payload->>'eventsPerMonth')::numeric and jsonb_typeof(payload->'publicCalendar') = 'boolean' and
      (not (payload->>'publicCalendar')::boolean or (length(payload->>'calendarURL') <= 1000 and payload->>'calendarURL' ~ '^https?://')), false)
    when 'merchant' then coalesce(length(btrim(payload->>'business')) between 1 and 160 and length(btrim(payload->>'category')) between 1 and 80 and
      length(btrim(payload->>'address')) between 1 and 300 and length(btrim(payload->>'offer')) between 3 and 2000, false)
    else false end)
);
create index website_submissions_status_kind_created_idx on public.website_submissions (status, kind, created_at, id);
create index website_submissions_status_created_idx on public.website_submissions (status, created_at, id);
alter table public.website_submissions enable row level security;
revoke all on public.website_submissions from public, anon, authenticated, service_role;
grant select, insert, update on public.website_submissions to service_role;

create table public.submission_audit (
  id uuid primary key default gen_random_uuid(),
  actor text not null check (length(btrim(actor)) between 1 and 128),
  action text not null,
  target text not null,
  occurred_at timestamptz not null default now(),
  before_state jsonb,
  after_state jsonb,
  reason text not null
);
alter table public.submission_audit enable row level security;
revoke all on public.submission_audit from public, anon, authenticated, service_role;
grant select, insert on public.submission_audit to service_role;
create function verdure_private.prevent_submission_audit_changes() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin raise exception 'Submission audit records are immutable.' using errcode = '42501'; end;
$$;
revoke all on function verdure_private.prevent_submission_audit_changes() from public, anon, authenticated;
create trigger submission_audit_immutable before update or delete on public.submission_audit
for each row execute function verdure_private.prevent_submission_audit_changes();

create function public.submit_website_request(p_kind text, p_contact_name text, p_contact_email text, p_payload jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare submission_id uuid;
begin
  insert into public.website_submissions(kind, contact_name, contact_email, payload)
  values(p_kind, btrim(p_contact_name), lower(btrim(p_contact_email)), p_payload) returning id into submission_id;
  return submission_id;
end;
$$;
revoke all on function public.submit_website_request(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_website_request(text, text, text, jsonb) to service_role;

create function public.list_website_submissions(p_actor text, p_status text default 'pending', p_kind text default null,
  p_after_id uuid default null, p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare cursor_time timestamptz; output jsonb;
begin
  if p_actor is null or length(btrim(p_actor)) not between 1 and 128 or p_status is null or p_status not in ('pending', 'handled') or
    (p_kind is not null and p_kind not in ('support', 'organizer', 'merchant')) or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid inbox filters.' using errcode = '22023';
  end if;
  if p_after_id is not null then
    select created_at into cursor_time from public.website_submissions where id = p_after_id;
    if not found then raise exception 'Refresh the inbox; the cursor no longer exists.' using errcode = '22023'; end if;
  end if;
  with page as (
    select * from public.website_submissions where status = p_status and (p_kind is null or kind = p_kind) and
      (p_after_id is null or (created_at, id) > (cursor_time, p_after_id)) order by created_at, id limit p_limit + 1
  ), numbered as (select *, row_number() over(order by created_at, id) as row_number from page)
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(numbered) - 'row_number' order by created_at, id)
      filter(where row_number <= p_limit), '[]'::jsonb),
    'nextCursor', case when count(*) > p_limit then max(id::text) filter(where row_number = p_limit) else null end)
    into output from numbered;
  insert into public.submission_audit(actor, action, target, before_state, after_state, reason)
    values(p_actor, 'submission:list', 'website_submissions', jsonb_build_object('status', p_status, 'kind', p_kind, 'afterId', p_after_id, 'limit', p_limit),
      jsonb_build_object('ids', (select coalesce(jsonb_agg(item->'id'), '[]'::jsonb) from jsonb_array_elements(output->'items') as item)), 'Read staff submissions inbox');
  return output;
end;
$$;
revoke all on function public.list_website_submissions(text, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_website_submissions(text, text, text, uuid, integer) to service_role;

create function public.handle_website_submission(p_actor text, p_id uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare before_row public.website_submissions; after_row public.website_submissions;
begin
  if p_actor is null or length(btrim(p_actor)) not between 1 and 128 or p_note is null or length(btrim(p_note)) not between 3 and 1000 then
    raise exception 'A staff actor and handling note are required.' using errcode = '22023';
  end if;
  select * into before_row from public.website_submissions where id = p_id for update;
  if not found then raise exception 'No such submission.' using errcode = 'P0002'; end if;
  update public.website_submissions set status = 'handled', handled_at = now(), handled_by = p_actor, handling_note = btrim(p_note)
    where id = p_id returning * into after_row;
  insert into public.submission_audit(actor, action, target, before_state, after_state, reason)
    values(p_actor, 'submission:handle', p_id::text, to_jsonb(before_row), to_jsonb(after_row), btrim(p_note));
  return to_jsonb(after_row);
end;
$$;
revoke all on function public.handle_website_submission(text, uuid, text) from public, anon, authenticated;
grant execute on function public.handle_website_submission(text, uuid, text) to service_role;

-- Table/function exposure is explicit; no public RLS policies are intentional.
-- Admin-readable audit history; the server supplies a verified Firebase actor.
create function public.list_submission_audit(p_actor text, p_target uuid default null, p_after_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare cursor_time timestamptz; output jsonb;
begin
  if p_actor is null or length(btrim(p_actor)) not between 1 and 128 then
    raise exception 'A staff actor is required.' using errcode = '22023';
  end if;
  if p_after_id is not null then
    select occurred_at into cursor_time from public.submission_audit where id = p_after_id;
    if not found then raise exception 'Refresh the audit history.' using errcode = '22023'; end if;
  end if;
  with page as (select * from public.submission_audit where (p_target is null or target = p_target::text) and
    (p_after_id is null or (occurred_at, id) > (cursor_time, p_after_id)) order by occurred_at, id limit 51),
    numbered as (select *, row_number() over(order by occurred_at, id) as row_number from page)
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(numbered) - 'row_number' order by occurred_at, id)
    filter(where row_number <= 50), '[]'::jsonb),
    'nextCursor', case when count(*) > 50 then max(id::text) filter(where row_number = 50) else null end) into output from numbered;
  insert into public.submission_audit(actor, action, target, before_state, after_state, reason)
    values(p_actor, 'submission:audit-read', 'submission_audit', jsonb_build_object('target', p_target, 'afterId', p_after_id),
      jsonb_build_object('ids', (select coalesce(jsonb_agg(item->'id'), '[]'::jsonb) from jsonb_array_elements(output->'items') as item)), 'Read submission audit history');
  return output;
end;
$$;
revoke all on function public.list_submission_audit(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_submission_audit(text, uuid, uuid) to service_role;
create index submission_audit_time_id_idx on public.submission_audit(occurred_at, id);
create index submission_audit_target_time_id_idx on public.submission_audit(target, occurred_at, id);
notify pgrst, 'reload schema';
