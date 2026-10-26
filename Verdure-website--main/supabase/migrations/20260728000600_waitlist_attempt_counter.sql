-- Closes a membership oracle in join_waitlist().
--
-- THE BUG. The rate ceiling counted rows in the table the insert conditionally
-- writes to:
--
--   select count(*) into recent_signups from public.waitlist
--   where created_at > now() - interval '1 minute';
--   if recent_signups >= 20 then raise ... end if;
--   insert into public.waitlist ... on conflict (email) do nothing;
--
-- ON CONFLICT DO NOTHING hides whether a row was written from the RETURN value,
-- and `returns void` means there is nothing to read a signal out of. Both true,
-- and both beside the point: the write is still observable, just not by the
-- caller that made it. It is observable by the NEXT call's counter.
--
-- So, with nothing but the public anon key and no session:
--
--   1. fill the window to exactly 19 with fresh random addresses
--   2. probe victim@example.com — this inserts iff the victim is NOT on the list
--   3. send one more fresh address and read its response:
--        rejected  -> the window reached 20 -> the probe inserted -> NOT a member
--        accepted  -> the window is still 19 -> ON CONFLICT ate it -> IS a member
--
-- One clean bit per minute per address, and it group-tests: probe k candidates
-- against a window pre-filled to 20-k and binary-search the residual capacity.
-- That is exactly the disclosure the schema removed the anon INSERT policy to
-- prevent, reintroduced by the anti-abuse control added underneath it.
--
-- THE FIX. Count attempts, not rows. Every call records one attempt before the
-- ceiling is consulted, whether or not it goes on to insert, so the counter
-- advances identically for a member and a non-member and carries no information
-- about either.
--
-- Note what rolls back and why that is correct: a call that trips the ceiling
-- raises, so PostgREST aborts its transaction and that call's own attempt row
-- disappears with it. Refused calls therefore do not extend the refusal window.
-- That is the behaviour we want — the ceiling is there to bound how fast the
-- table grows, and a call that wrote nothing did not grow it.
--
-- WHAT THIS DOES NOT FIX, stated plainly: the ceiling is still GLOBAL, because
-- this function has no access to the caller's address, and it is reachable
-- directly at POST /rest/v1/rpc/join_waitlist with the public key. So ~20
-- requests a minute from one script still holds it at the ceiling permanently
-- and every genuine signup fails with the generic error until they stop. That
-- is a denial of signups, not a disclosure, and closing it needs a caller
-- identity this function does not have — a Turnstile token or a signed nonce
-- issued by the site and verified here. Tracked, not solved by this migration.

create table if not exists public.waitlist_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);

-- No policies, deliberately: RLS on with none defined denies every role, and
-- the only writer is join_waitlist(), which runs as the table's owner.
alter table public.waitlist_attempts enable row level security;

create index if not exists waitlist_attempts_at_idx
  on public.waitlist_attempts (at desc);

create or replace function public.join_waitlist(p_email text, p_source text)
returns void
language plpgsql
security definer
-- Empty rather than "public, pg_temp". The hardening guidance for SECURITY
-- DEFINER is to keep writable schemas out of the search path, and public is a
-- writable schema. Every object below is schema-qualified, so '' costs nothing.
set search_path = ''
as $$
declare
  recent_attempts integer;
begin
  -- Revalidated here because this function is the trust boundary: it is
  -- reachable with the public key and must not assume the website ran first.
  if p_email is null
     or char_length(p_email) > 254
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  -- Unconditional, and BEFORE the ceiling is read. Both matter: if this were
  -- conditional on the insert succeeding, or ran after the check, the counter
  -- would once again move only for non-members.
  insert into public.waitlist_attempts default values;

  -- Opportunistic trim. The window is one minute; anything older than an hour
  -- cannot affect a decision and only costs index. Cheap on the descending
  -- index and keeps this table from being its own growth problem.
  delete from public.waitlist_attempts
  where at < now() - interval '1 hour';

  select count(*) into recent_attempts
  from public.waitlist_attempts
  where at > now() - interval '1 minute';

  -- 30 rather than the previous 20 because the unit changed underneath it. This
  -- now counts every call, including the duplicate submissions and retries that
  -- the old row-counter silently ignored, so holding the number fixed would
  -- have quietly tightened the limit on real traffic.
  if recent_attempts >= 30 then
    raise exception 'waitlist temporarily unavailable' using errcode = '53400';
  end if;

  insert into public.waitlist (email, source)
  values (
    lower(p_email),
    case when p_source is null then null else left(p_source, 40) end
  )
  on conflict (email) do nothing;
end;
$$;

-- CREATE OR REPLACE preserves the existing ACL, so the grants from the original
-- schema migration still stand. Restated anyway: cheap, and it means this file
-- does not depend on having read that one.
revoke all on function public.join_waitlist(text, text) from public;
grant execute on function public.join_waitlist(text, text) to anon, authenticated;
