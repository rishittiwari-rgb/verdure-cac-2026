-- Verdure — give an account a name
--
-- The account page greets people by name on arrival. Until now nothing
-- collected one: signup took an email and a password, and profiles stored id,
-- email and created_at. This adds the column and teaches the existing
-- new-user trigger to fill it.
--
-- Where the value comes from: signUp() passes options.data, which Supabase
-- stores on auth.users.raw_user_meta_data. That field is chosen by the CLIENT
-- — POST /auth/v1/signup with the publishable key can put anything in it — so
-- the length bound below is a real constraint rather than documentation of
-- what the form happens to send. It is also why the column is text with a
-- CHECK and not, say, trusted into any query.
--
-- Display safety is separate and already handled: the name is rendered through
-- React, which escapes it, and it is only ever shown to the account's own
-- owner, since profiles has a select-own policy and the account page reads the
-- session user.

alter table public.profiles
  add column if not exists full_name text;

alter table public.profiles
  drop constraint if exists profiles_full_name_shape;
alter table public.profiles
  add constraint profiles_full_name_shape
  check (
    full_name is null
    or (
      char_length(full_name) between 1 and 80
      -- No control characters. A name is one line of text; anything carrying a
      -- newline or a NUL is not a name, it is somebody testing what the column
      -- will swallow.
      and full_name !~ '[[:cntrl:]]'
    )
  ) not valid;

-- Still no UPDATE policy on profiles, deliberately, for the same reason as
-- before: there is no legitimate reason for a user to write their own row
-- directly, and RLS cannot restrict which COLUMNS a policy covers, so allowing
-- a name edit would allow an email edit too. Changing a display name later
-- belongs in a SECURITY DEFINER function that writes exactly one column.

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
    -- Trimmed, emptied to null, and truncated rather than rejected. This runs
    -- inside the signup transaction: raising here would fail the signup
    -- itself, so a name that is too long must cost the user their name, never
    -- their account.
    nullif(left(trim(new.raw_user_meta_data->>'full_name'), 80), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- CREATE OR REPLACE preserves the ACL, so the revoke from 20260728000200
-- survives. Re-stated for the same reason as there.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;
