-- Verdure — take EXECUTE on the trigger functions away from the public keys
--
-- This is a separate migration because the two before it were wrong about
-- something that only running them against a real Supabase project revealed.
-- Both end with `revoke all on function ... from public`, on the reasoning
-- that EXECUTE is otherwise inherited from PUBLIC. That reasoning is correct
-- for stock Postgres and insufficient here: Supabase ships
--
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
--
-- so every function created in public is ALSO granted to those three roles by
-- name, at creation time. Revoking from PUBLIC removes the implicit grant and
-- leaves the three named ones exactly where they were. Read back off the live
-- database seconds after the push:
--
--   notify_waitlist_signup -> postgres=X | anon=X | authenticated=X | service_role=X
--
-- The PUBLIC entry was gone, precisely as intended, and anon could still
-- execute the function. On Supabase, a revoke that names only PUBLIC is a
-- comment rather than a control.
--
-- Revoking EXECUTE does not disturb the triggers. Postgres checks EXECUTE on a
-- trigger function when the trigger is CREATED, not each time it fires, so the
-- existing triggers keep working — which the verification at the bottom of
-- 20260728000100_notify_waitlist.sql re-proves against this database.
--
-- service_role is deliberately left alone. It is not a browser-reachable key,
-- this deployment holds none of it (see .env.local.example), and it already
-- bypasses RLS on every table, so removing one EXECUTE from it protects
-- nothing while quietly breaking any future admin script.

revoke execute on function public.notify_waitlist_signup()
  from public, anon, authenticated;

-- The same defect, in an older instance. handle_new_user() creates the profile
-- row on signup and has been executable by anon since the schema was first
-- written. It is fixed here rather than left as "the one that was already like
-- that", because a rule with a grandfathered exception stops being a rule.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

-- waitlist_notice_cap() is deliberately NOT revoked. It is `select 50`, it is
-- SECURITY INVOKER, it reads nothing and writes nothing, and a caller who
-- learns the cap learns a number that is also sitting in this file in a public
-- repository. Revoking it would be tidiness mistaken for security.
