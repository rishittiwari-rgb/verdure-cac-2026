-- Verdure — email the owner on every waitlist signup
--
-- Applied by `npm run supabase:push` (remote) or `supabase db reset` (local),
-- after the schema migration that precedes it.
--
-- Shape: an AFTER INSERT trigger on public.waitlist calls net.http_post
-- (pg_net) against a Supabase Edge Function, which sends the mail via Resend.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Why this is not three lines in the joinWaitlist server action
-- ───────────────────────────────────────────────────────────────────────────
--
-- 1. The action cannot tell a new signup from a repeat one. join_waitlist()
--    returns void and inserts ON CONFLICT DO NOTHING, deliberately, so that a
--    duplicate is indistinguishable from a first-time signup. Giving the
--    action a return value it could branch on would hand back exactly the
--    membership oracle schema.sql removed the anon INSERT policy to close.
--    A trigger needs no return value: AFTER INSERT ... FOR EACH ROW fires
--    only when a row is actually written, and ON CONFLICT DO NOTHING writes
--    nothing, so duplicates are filtered by the database and no signal about
--    who is already on the list ever leaves it.
--
-- 2. A synchronous send would leak the same fact through timing. Mailing an
--    address that is new costs a provider round trip; an address that already
--    exists costs nothing. That difference is measurable from the outside and
--    is the oracle again, wearing a stopwatch. net.http_post queues the
--    request into pg_net's table and returns immediately, so both paths cost
--    the same and the send happens after the transaction commits.
--
-- 3. The server action is not the only door. join_waitlist() is reachable at
--    POST /rest/v1/rpc/join_waitlist with the public anon key, which skips the
--    honeypot, the submit-time trap, the source allowlist and the per-IP
--    limiter — all of which live in the website. Anything bolted onto the
--    action is simply bypassed. The trigger sits on the table, which is the
--    one place every door leads to.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Extensions
-- ───────────────────────────────────────────────────────────────────────────
-- Declared here rather than clicked in Dashboard → Database → Extensions, so
-- that a project rebuilt from these migrations is not one forgotten checkbox
-- away from silently sending nothing. Both are no-ops where they are already
-- installed, which on a hosted Supabase project is the usual case for the
-- vault.
--
-- pg_net is what net.http_post below comes from, and nothing here works
-- without it. The failure is quiet by design (see the exception handler at the
-- end of the trigger function), so this is the first thing to check when no
-- mail arrives.
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- ───────────────────────────────────────────────────────────────────────────
-- Configuration lives in Vault, not in this file
-- ───────────────────────────────────────────────────────────────────────────
-- A function body is readable by anyone who can read pg_proc, and this repo
-- is public. Hardcoding the endpoint would publish the URL; hardcoding the
-- shared secret would publish the only thing standing between the endpoint
-- and anyone who wants to send mail from it. Both are read out of
-- vault.decrypted_secrets at fire time instead.
--
-- Run these two ONCE, in the SQL Editor, with your own values:
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/waitlist-notify',
--     'waitlist_notify_url',
--     'Endpoint the waitlist AFTER INSERT trigger posts to'
--   );
--
--   select vault.create_secret(
--     '<output of: openssl rand -base64 32>',
--     'waitlist_notify_secret',
--     'Shared secret sent as x-verdure-signature. Must match the Edge Function''s WAITLIST_NOTIFY_SECRET.'
--   );
--
-- To rotate either one later, update rather than re-create — the name is
-- unique and create_secret would fail:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'waitlist_notify_secret'),
--     '<new value>'
--   );
--
-- Rotate the secret in BOTH places or every call starts returning 404.

-- ───────────────────────────────────────────────────────────────────────────
-- Send cap
-- ───────────────────────────────────────────────────────────────────────────
-- One number, in one immutable function, so changing the cap is a one-line
-- edit rather than a hunt through a trigger body.
--
-- No `set search_path` here on purpose. That hardening exists to stop a
-- SECURITY DEFINER function resolving an unqualified name against a schema an
-- attacker can write to; this function is SECURITY INVOKER and references no
-- objects at all, so there is nothing to resolve and nothing to hijack.
create or replace function public.waitlist_notice_cap()
returns integer
language sql
immutable
as $$ select 50 $$;

-- Why a cap exists at all. join_waitlist() is directly callable with the
-- public key (see reason 3 above), and IPv6 makes distinct source addresses
-- free, so the per-IP limiter in the website bounds nothing that matters here.
-- Without a ceiling the public signup form is a mailer aimed at the owner's
-- inbox: the volume is somebody else's choice, and a burst of automated mail
-- from a young domain is how a sending reputation gets destroyed before the
-- product has launched.
--
-- The counter is per calendar day (UTC, which is what current_date is on
-- Supabase) and resets by the date rolling over rather than by a scheduled
-- job, so there is nothing to schedule and nothing to fail.
create table if not exists public.waitlist_notice_budget (
  day  date primary key,
  sent integer not null default 0
);

-- RLS on, and deliberately NO policies. Postgres denies by default when RLS
-- is enabled and nothing matches, so neither anon nor authenticated can read
-- how many signups happened today or write the counter down to unblock more
-- mail. The trigger function below reaches it as its owner, for whom RLS is
-- not enforced.
alter table public.waitlist_notice_budget enable row level security;

-- ───────────────────────────────────────────────────────────────────────────
-- The trigger function
-- ───────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the caller is anon, who holds nothing on
-- waitlist_notice_budget and cannot read Vault.
--
-- search_path is '' rather than 'public, pg_temp' for the same reason as
-- join_waitlist() in schema.sql: public is a writable schema and pg_temp is
-- worse, so the definer resolves nothing implicitly and every object below is
-- schema-qualified. pg_catalog is always searched regardless, which is why
-- count(), now() and jsonb_build_object() need no prefix.
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
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'waitlist_notify_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'waitlist_notify_secret';

  -- Unconfigured is not an error worth failing a signup over. Say so in the
  -- log and let the row stand.
  if v_url is null or v_secret is null then
    raise warning '[waitlist-notify] vault secrets missing; nothing sent';
    return null;
  end if;

  v_cap := public.waitlist_notice_cap();

  -- Upsert-increment and read the new value in one statement, so two
  -- concurrent signups cannot both read the same count and both decide they
  -- are number 50. ON CONFLICT DO UPDATE takes a row lock; the second one
  -- waits and sees the first one's increment.
  insert into public.waitlist_notice_budget as b (day, sent)
  values (current_date, 1)
  on conflict (day) do update set sent = b.sent + 1
  returning b.sent into v_sent;

  if v_sent <= v_cap then
    v_kind := 'signup';
  elsif v_sent = v_cap + 1 then
    -- Exactly one of these per day: the counter keeps climbing, so this
    -- branch is true once and then never again until the date rolls over.
    -- The point is to say "you have stopped receiving these" once, rather
    -- than to say it forty more times.
    v_kind := 'cap_reached';
  else
    return null;
  end if;

  -- A sequential scan per signup. On a pre-launch waitlist that is a few
  -- thousand rows at most and the trigger is already doing an HTTP call, so
  -- it is not the expensive part. If this table ever gets large enough for it
  -- to matter, the number in the email is the thing to drop, not to index.
  select count(*) into v_total from public.waitlist;

  -- perform, not select: net.http_post returns a request id and nothing here
  -- wants it. The call only enqueues — pg_net's background worker does the
  -- send after this transaction commits, which is what keeps a slow or dead
  -- endpoint from being visible in the signup's response time.
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'kind',       v_kind,
      'email',      new.email,
      'source',     new.source,
      'created_at', new.created_at,
      'total',      v_total,
      'sent_today', v_sent,
      'cap',        v_cap
    ),
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'x-verdure-signature', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return null;

-- The entire body is inside this handler, and it is the most important line
-- in the file. A missing extension, a revoked Vault grant, a renamed secret,
-- a pg_net upgrade that changes an argument name — every one of those raises,
-- and without this an ordinary person typing their email into the landing
-- page would get "Something went wrong" because the OWNER'S NOTIFICATION was
-- broken. The signup is the product; the email about it is a convenience.
--
-- The cost is that a broken notification path is silent to anyone not reading
-- postgres logs, which is the trade being made deliberately. It also means
-- every insert runs inside a subtransaction, since a block with an EXCEPTION
-- clause needs one — cheap at waitlist volumes.
--
-- return null because this is an AFTER trigger: the return value is ignored,
-- and null is the conventional way to say so.
exception when others then
  raise warning '[waitlist-notify] suppressed %: %', sqlstate, sqlerrm;
  return null;
end;
$$;

drop trigger if exists on_waitlist_signup on public.waitlist;
create trigger on_waitlist_signup
  after insert on public.waitlist
  for each row execute function public.notify_waitlist_signup();

-- Postgres checks EXECUTE on a trigger function when the trigger is CREATED,
-- not when it fires, so revoking afterwards leaves the trigger working while
-- taking the function away as something anon can call on its own. Without
-- this, anyone with the public key could invoke it directly — and although a
-- trigger function called outside a trigger errors immediately, "errors
-- immediately" is not a reason to leave it callable.
revoke all on function public.notify_waitlist_signup() from public;

-- ───────────────────────────────────────────────────────────────────────────
-- Verification — run these in the SQL Editor after deploying the function
-- ───────────────────────────────────────────────────────────────────────────
-- Everything below is observed through waitlist_notice_budget.sent, which
-- this file creates and which increments once per queued notification. That
-- makes the checks independent of pg_net's internal table names, which have
-- changed between versions.
--
-- (a) A NEW address queues exactly one notification.
--
--     select coalesce(sent, 0) from public.waitlist_notice_budget
--       where day = current_date;                        -- note this number
--     select public.join_waitlist('verify-a@example.com', 'home');
--     select coalesce(sent, 0) from public.waitlist_notice_budget
--       where day = current_date;                        -- exactly one higher
--     select status_code, error_msg from net._http_response
--       order by id desc limit 1;                        -- 200 from the function
--
-- (b) The SAME address again queues nothing. No row is written, so the
--     trigger never fires, so the counter does not move — the duplicate is
--     suppressed by the database rather than by a check that could be
--     bypassed at /rest/v1/rpc/join_waitlist.
--
--     select public.join_waitlist('verify-a@example.com', 'home');
--     select coalesce(sent, 0) from public.waitlist_notice_budget
--       where day = current_date;                        -- UNCHANGED
--
-- (c) A dead endpoint still commits the row. Point the URL at a closed port,
--     sign up, and confirm the signup survived: the failure is recorded by
--     pg_net after commit and never reaches the inserting transaction.
--
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'waitlist_notify_url'),
--       'http://127.0.0.1:9/dead'
--     );
--     select public.join_waitlist('verify-c@example.com', 'home');
--     select count(*) from public.waitlist
--       where email = 'verify-c@example.com';            -- 1, the row is there
--     select status_code, error_msg from net._http_response
--       order by id desc limit 1;                        -- null status, an error
--
--     Then put the real URL back:
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'waitlist_notify_url'),
--       'https://<project-ref>.supabase.co/functions/v1/waitlist-notify'
--     );
--
-- (d) Optional — prove the cap. Fast-forward today's counter to one below the
--     cap, then sign up twice: the first mail arrives, the second is the
--     single "cap reached" notice, and a third sends nothing.
--
--     update public.waitlist_notice_budget set sent = public.waitlist_notice_cap() - 1
--       where day = current_date;
--     select public.join_waitlist('verify-d1@example.com', 'home');   -- last normal one
--     select public.join_waitlist('verify-d2@example.com', 'home');   -- the cap notice
--     select public.join_waitlist('verify-d3@example.com', 'home');   -- silence
--
-- (e) Cleanup. Do this or the addresses above are in the real waitlist.
--
--     delete from public.waitlist where email like 'verify-%@example.com';
--     delete from public.waitlist_notice_budget where day = current_date;
