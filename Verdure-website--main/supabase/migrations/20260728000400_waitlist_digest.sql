-- Verdure — replace the per-signup email with a half-hourly digest
--
-- The owner gets one message every 30 minutes containing the whole list, with
-- anything new since the previous message marked. 48 a day at most, under both
-- the 50/day cap this schema already enforces and Resend's free-plan limits.
--
-- Why this replaces the AFTER INSERT trigger rather than joining it: with a
-- per-row trigger the send rate is chosen by whoever signs up. A burst of ten
-- signups in a minute is ten emails, a hundred is a hundred, and the daily cap
-- then silences the notifications for the rest of the day precisely when the
-- most is happening. A schedule inverts that — the cadence is fixed and the
-- content grows — which is the property that actually matters when the list is
-- the thing being reported.
--
-- The reasoning from 20260728000100 that still holds: the send does not live
-- in the joinWaitlist server action, because join_waitlist() is callable
-- directly at /rest/v1/rpc/join_waitlist and anything in the action is simply
-- bypassed. Reading the table on a schedule is immune to that by construction.
--
-- What changes: a duplicate signup was previously suppressed by the trigger not
-- firing. Now it is suppressed because ON CONFLICT DO NOTHING writes no row, so
-- created_at never moves and the digest window never sees it. Same guarantee,
-- reached the same way — through the database rather than through a check.

-- ───────────────────────────────────────────────────────────────────────────
-- Extension
-- ───────────────────────────────────────────────────────────────────────────
-- Declared rather than clicked, same reasoning as pg_net.
create extension if not exists pg_cron;

-- ───────────────────────────────────────────────────────────────────────────
-- Where the last digest got to
-- ───────────────────────────────────────────────────────────────────────────
-- One row, enforced by a primary key that can only hold true. A settings table
-- that can grow a second row is a settings table that will eventually disagree
-- with itself.
create table if not exists public.waitlist_digest_state (
  id           boolean primary key default true check (id),
  last_sent_at timestamptz not null default now()
);

-- RLS on, no policies: nobody holding a public key needs to know when the
-- owner was last told anything, and certainly cannot be allowed to move the
-- watermark backwards and replay the list.
alter table public.waitlist_digest_state enable row level security;

-- ───────────────────────────────────────────────────────────────────────────
-- The digest
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.send_waitlist_digest()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text;
  v_secret  text;
  v_since   timestamptz;
  v_high    timestamptz;
  v_new     integer;
  v_cap     integer;
  v_sent    integer;
  v_total   bigint;
  v_limit   integer;
  v_kind    text;
  v_list    jsonb;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'waitlist_notify_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'waitlist_notify_secret';

  if v_url is null or v_secret is null then
    raise warning '[waitlist-digest] vault secrets missing; nothing sent';
    return;
  end if;

  -- First run seeds the watermark at now(), so the first digest reports what
  -- arrives AFTER this migration rather than emailing the entire existing list
  -- as though all of it were new.
  select s.last_sent_at into v_since from public.waitlist_digest_state s where s.id;

  if not found then
    insert into public.waitlist_digest_state (id, last_sent_at)
    values (true, now())
    returning last_sent_at into v_since;
  end if;

  -- The high-water mark is the newest row we can actually see, NOT now().
  -- Advancing the watermark to now() would skip any row whose transaction
  -- commits a moment after this one started reading: its created_at would be
  -- older than the new watermark and it would never appear in any digest.
  -- Taking the timestamp from the data means a row we did not see keeps a
  -- created_at above the mark and is picked up next time.
  select max(w.created_at), count(*)
    into v_high, v_new
    from public.waitlist w
   where w.created_at > v_since;

  -- Nothing new. Send nothing.
  --
  -- The schedule is a ceiling on how often the owner hears from us, not a
  -- promise to speak every half hour. Forty-eight "no new signups" emails a
  -- day is how a notification becomes something you filter, and then the one
  -- that mattered is filtered too. To make it unconditional instead, delete
  -- this block — the rest already handles an empty new-set correctly.
  if v_new = 0 then
    return;
  end if;

  v_cap := public.waitlist_notice_cap();

  insert into public.waitlist_notice_budget as b (day, sent)
  values (current_date, 1)
  on conflict (day) do update set sent = b.sent + 1
  returning b.sent into v_sent;

  if v_sent <= v_cap then
    v_kind := 'digest';
  elsif v_sent = v_cap + 1 then
    v_kind := 'cap_reached';
  else
    -- Over cap: do not send, and do NOT move the watermark, so whatever was
    -- new stays new and appears in tomorrow's first digest instead of being
    -- silently dropped on the floor.
    return;
  end if;

  select count(*) into v_total from public.waitlist;
  v_limit := public.waitlist_list_limit();

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'email',      recent.email,
               'source',     recent.source,
               'created_at', recent.created_at,
               'is_new',     recent.created_at > v_since
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
      'since',          v_since,
      'new_count',      v_new,
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

  update public.waitlist_digest_state set last_sent_at = v_high where id;

-- Same handler, same reason, one degree more important: this runs unattended
-- on a schedule, so an exception escaping here would land in the cron job's
-- error log and nowhere a person looks. It cannot break a signup any more —
-- nothing is inserting — but it can silently stop the digest, and the warning
-- is the only trace either way.
exception when others then
  raise warning '[waitlist-digest] suppressed %: %', sqlstate, sqlerrm;
end;
$$;

revoke execute on function public.send_waitlist_digest()
  from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Retire the per-row path
-- ───────────────────────────────────────────────────────────────────────────
-- Dropped rather than left disabled. A dormant trigger that emails on every
-- insert is a thing somebody re-enables while debugging and forgets, and the
-- failure mode is the owner's inbox.
drop trigger if exists on_waitlist_signup on public.waitlist;
drop function if exists public.notify_waitlist_signup();

-- ───────────────────────────────────────────────────────────────────────────
-- Schedule
-- ───────────────────────────────────────────────────────────────────────────
-- Every 30 minutes on the hour and the half hour. cron.schedule upserts by
-- name, so re-running this migration re-points the same job rather than
-- creating a second one that would double the send rate.
select cron.schedule(
  'waitlist-digest',
  '*/30 * * * *',
  $cron$select public.send_waitlist_digest()$cron$
);

-- ───────────────────────────────────────────────────────────────────────────
-- Verification
-- ───────────────────────────────────────────────────────────────────────────
--   select jobname, schedule, active from cron.job where jobname = 'waitlist-digest';
--   select status, return_message, start_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'waitlist-digest')
--    order by start_time desc limit 5;
--
-- To force one now without waiting for the half hour:
--   select public.send_waitlist_digest();
--
-- To see what the next digest WOULD contain, without sending or moving the
-- watermark:
--   select count(*) filter (where w.created_at > s.last_sent_at) as new_since,
--          count(*) as total
--     from public.waitlist w cross join public.waitlist_digest_state s;
