-- Verdure — Supabase schema
-- Run this once in your project: Supabase Dashboard → SQL Editor → paste → Run.
-- Auth users (auth.users) are managed by Supabase automatically; this file only
-- adds the application tables and their Row Level Security (RLS) policies.

-- ───────────────────────────────────────────────────────────────────────────
-- Waitlist: pre-launch email capture from the landing page CTA.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  source     text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- NO policy grants anon or authenticated ANY direct access to this table.
-- With RLS on and no matching policy, Postgres denies by default: the public
-- key can neither read the list nor touch the table. Signups arrive only
-- through join_waitlist() below.
--
-- Why direct INSERT had to go. The old policy allowed anonymous INSERT, which
-- looked harmless because the application answers a duplicate signup with a
-- success. But the anon key reaches PostgREST directly, where `email UNIQUE`
-- answers for itself: 201 for a stranger, 409/23505 for an existing signup —
-- a membership oracle over the email list, bypassing every check the
-- application performs.
--
-- Why `Prefer: resolution=ignore-duplicates` does NOT fix it. That header
-- makes OUR insert return 201 either way, but the header is chosen by whoever
-- sends the request. An attacker holding the same public key simply omits it
-- and reads the 409. Any design where anon can INSERT into a UNIQUE column
-- leaks membership, regardless of how our own client is configured.
--
-- Why not the service-role key. It would work, but it bypasses RLS on every
-- table in the project, so a bug in one public HTTP endpoint would expose the
-- whole database instead of one insert into one table. That is a bad trade for
-- a waitlist form.
--
-- SECURITY DEFINER gets both properties at once: anon holds EXECUTE on exactly
-- this function and no table privileges at all, the function runs as its owner
-- so the insert succeeds, ON CONFLICT DO NOTHING makes an existing address
-- indistinguishable from a new one, and `returns void` means there is no
-- result to read a signal out of. Blast radius is one insert into one table.
drop policy if exists "waitlist_public_insert" on public.waitlist;

-- Bounds how fast the table can grow. This function is reachable directly at
-- POST /rest/v1/rpc/join_waitlist with the public key, which bypasses the
-- honeypot, the submit-time trap, the source allowlist and the per-IP limiter
-- in the server action — all of those live in the website, and this endpoint is
-- not the website. Disclosure is closed; volume was not, and unlimited distinct
-- addresses meant unlimited rows.
--
-- A global ceiling rather than a per-caller one, because the function has no
-- access to the caller's address. Deliberately far above real demand for a
-- pre-launch waitlist, so it never touches a genuine burst, and low enough that
-- filling the table is slow and shows up in the row count long before it costs
-- anything. Residual, stated plainly: a patient attacker can still add rows at
-- this rate. Cutting that further needs a signed token or Turnstile in front.
create index if not exists waitlist_created_at_idx
  on public.waitlist (created_at desc);

create or replace function public.join_waitlist(p_email text, p_source text)
returns void
language plpgsql
security definer
-- Empty rather than "public, pg_temp". The hardening guidance for SECURITY
-- DEFINER is to keep writable schemas out of the search path, and public is a
-- writable schema. Postgres 15 stopped granting CREATE on public to PUBLIC by
-- default so this is probably moot on Supabase today, but that is a default we
-- do not control. Every object below is schema-qualified, so '' costs nothing.
set search_path = ''
as $$
declare
  recent_signups integer;
begin
  -- Revalidated here because this function is the trust boundary: it is
  -- reachable with the public key and must not assume the website ran first.
  if p_email is null
     or char_length(p_email) > 254
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  select count(*) into recent_signups
  from public.waitlist
  where created_at > now() - interval '1 minute';

  if recent_signups >= 20 then
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

-- EXECUTE is granted explicitly rather than inherited from PUBLIC.
revoke all on function public.join_waitlist(text, text) from public;
grant execute on function public.join_waitlist(text, text) to anon, authenticated;

-- Depth. The public key no longer reaches this table directly, so these are
-- no longer the last line of defence — but they are the line that survives
-- join_waitlist() being edited, re-granted, or replaced by a future direct
-- insert. The table states its own shape so nobody can stuff megabytes into a
-- text column or park non-addresses in `email`, whichever door they come
-- through. NOT VALID so a re-run never trips over rows that predate the
-- constraint; run
--   alter table public.waitlist validate constraint waitlist_email_shape;
-- after cleaning any offenders to extend the guarantee backwards.
alter table public.waitlist
  drop constraint if exists waitlist_email_shape;
alter table public.waitlist
  add constraint waitlist_email_shape
  check (
    char_length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) not valid;

alter table public.waitlist
  drop constraint if exists waitlist_source_length;
alter table public.waitlist
  add constraint waitlist_source_length
  check (source is null or char_length(source) <= 40) not valid;

-- ───────────────────────────────────────────────────────────────────────────
-- Profiles: one row per auth user, auto-created on signup.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Kept even though the update policy that motivated it is gone (see below):
-- the trigger still writes this column, and the constraint is what holds if a
-- future policy, migration or admin script starts writing it again.
-- NOT VALID so existing rows never block the migration.
alter table public.profiles
  drop constraint if exists profiles_email_shape;
alter table public.profiles
  add constraint profiles_email_shape
  check (
    email is null
    or (
      char_length(email) <= 254
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ) not valid;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- There is deliberately NO update policy. profiles holds id, email and
-- created_at, and a user has no legitimate reason to write any of them: id is
-- the auth user's own key, created_at is a record of fact, and email is
-- maintained by Supabase Auth through the trigger below.
--
-- The policy that used to be here allowed a signed-in user to set their own
-- profiles.email to any value. Adding a CHECK constrained the shape but not
-- the ownership — a well-formed address belonging to somebody else passes it
-- perfectly well — and RLS cannot restrict which COLUMNS a policy covers, so
-- there is no way to permit a safe subset. Removing the policy is the control.
drop policy if exists "profiles_update_own" on public.profiles;

-- Create the profile row whenever a new auth user is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
-- Empty search_path, same reasoning as join_waitlist(): keep writable schemas
-- out of a definer's resolution order and schema-qualify everything instead.
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
