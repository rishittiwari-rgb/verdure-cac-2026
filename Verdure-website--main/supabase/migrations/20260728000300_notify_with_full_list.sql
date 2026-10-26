-- Verdure — carry the whole waitlist in every notification
--
-- The owner wants each signup email to contain the full list to date, not just
-- the address that arrived. This replaces the body of
-- public.notify_waitlist_signup() to add `list` and `list_truncated` to the
-- payload; everything else about the design is unchanged.
--
-- Why the LIST is assembled here rather than fetched by the Edge Function:
-- the function would need to read public.waitlist, which RLS denies to anon
-- and authenticated, so it would need a service_role key. This deployment
-- deliberately holds no service-role credential anywhere (see
-- .env.local.example), because one bug in one public HTTP endpoint would then
-- expose every table instead of one function's worth of blast radius. The
-- trigger already runs as its owner and already reads this table, so sending
-- the rows costs nothing new.

-- The ceiling on how many rows travel in one payload.
--
-- A cap is needed because the alternative is a request whose size is chosen by
-- whoever signs up: pg_net would carry it, Resend would accept it, and the
-- first sign that it had become a problem would be a notification that stopped
-- arriving. 2000 addresses is roughly 140 kB of JSON, comfortably inside every
-- limit in the path, and far beyond where a human reads an email as a list
-- rather than as a database.
--
-- Worth knowing: Gmail clips a message at about 102 kB and shows "View entire
-- message". A few hundred addresses will cross that. The list is still all
-- there, one click away — but past that point the dashboard is the better tool
-- and this email is a notification, not a report.
create or replace function public.waitlist_list_limit()
returns integer
language sql
immutable
as $$ select 2000 $$;

create or replace function public.notify_waitlist_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_cap    integer;
  v_sent   integer;
  v_total  bigint;
  v_kind   text;
  v_limit  integer;
  v_list   jsonb;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'waitlist_notify_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'waitlist_notify_secret';

  if v_url is null or v_secret is null then
    raise warning '[waitlist-notify] vault secrets missing; nothing sent';
    return null;
  end if;

  v_cap := public.waitlist_notice_cap();

  insert into public.waitlist_notice_budget as b (day, sent)
  values (current_date, 1)
  on conflict (day) do update set sent = b.sent + 1
  returning b.sent into v_sent;

  if v_sent <= v_cap then
    v_kind := 'signup';
  elsif v_sent = v_cap + 1 then
    v_kind := 'cap_reached';
  else
    return null;
  end if;

  select count(*) into v_total from public.waitlist;

  v_limit := public.waitlist_list_limit();

  -- Newest first, because the reason for opening the email is the row at the
  -- top. The aggregate carries its own ORDER BY: relying on the subquery's
  -- order would work today and is not guaranteed.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'email',      recent.email,
               'source',     recent.source,
               'created_at', recent.created_at
             )
             order by recent.created_at desc
           ),
           '[]'::jsonb
         )
    into v_list
    from (
      select w.email, w.source, w.created_at
      from public.waitlist w
      order by w.created_at desc
      limit v_limit
    ) recent;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'kind',           v_kind,
      'email',          new.email,
      'source',         new.source,
      'created_at',     new.created_at,
      'total',          v_total,
      'sent_today',     v_sent,
      'cap',            v_cap,
      'list',           v_list,
      'list_truncated', v_total > v_limit
    ),
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'x-verdure-signature', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return null;

-- Unchanged and still the most important line in the file: a signup must never
-- fail because the notification path is broken. Assembling the list adds one
-- more thing that can raise, which makes this matter more rather than less.
exception when others then
  raise warning '[waitlist-notify] suppressed %: %', sqlstate, sqlerrm;
  return null;
end;
$$;

-- CREATE OR REPLACE preserves the existing ACL, so the revoke from
-- 20260728000200 survives this. Re-stated anyway because "preserves the ACL"
-- is a fact about Postgres that a future reader would have to go and look up
-- before trusting, and a redundant revoke costs nothing.
revoke execute on function public.notify_waitlist_signup()
  from public, anon, authenticated;
