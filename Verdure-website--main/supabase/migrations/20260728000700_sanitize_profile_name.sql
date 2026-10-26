-- Stops a client-supplied name from costing the user their account.
--
-- 20260728000500 added both halves of this and they disagree. The CHECK rejects
-- control characters:
--
--   check ( full_name is null or ( char_length(full_name) between 1 and 80
--           and full_name !~ '[[:cntrl:]]' ) )
--
-- while the trigger only bounds LENGTH:
--
--   nullif(left(trim(new.raw_user_meta_data->>'full_name'), 80), '')
--
-- Postgres trim() strips spaces, not tabs or newlines, so a name containing one
-- survives the trigger and is then refused by the constraint. handle_new_user()
-- runs inside the signup transaction, so that 23514 aborts the insert into
-- auth.users and the account is never created:
--
--   curl .../auth/v1/signup -d '{"email":"...","password":"...",
--                                "data":{"full_name":"Bob\tEvil"}}'
--
-- which contradicts the reasoning written directly above that line — "a name
-- that is too long must cost the user their name, never their account". The
-- principle was right and applied to exactly one of the two ways a name can be
-- unacceptable.
--
-- Self-inflicted, since the attacker breaks only their own signup, and a paste
-- from a word processor or a screen reader's clipboard is likelier to hit it
-- than anyone probing. Both argue for the same fix: sanitize in the trigger the
-- way length already is, and leave the CHECK alone as the backstop for any
-- other writer.
--
-- Order matters below. regexp_replace runs BEFORE trim and left():
--   - before trim, so a name that is nothing but control characters collapses
--     to '' and nullif turns it into a null name rather than an empty one the
--     CHECK would reject on char_length >= 1
--   - before left(80), so removal cannot leave a trailing partial and the 80
--     counts real characters

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(
      left(
        trim(
          regexp_replace(
            coalesce(new.raw_user_meta_data->>'full_name', ''),
            '[[:cntrl:]]',
            '',
            'g'
          )
        ),
        80
      ),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- CREATE OR REPLACE preserves the ACL, so the revoke from 20260728000200 still
-- holds. Restated rather than assumed.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
