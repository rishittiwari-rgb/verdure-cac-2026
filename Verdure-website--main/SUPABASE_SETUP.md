# Backend setup (Supabase)

Email **sign up / log in / log out**, a protected **/account** page, and the
**waitlist** form all run on Supabase (Postgres + Auth). Follow these once.

Until these steps are done the site behaves as a plain static brochure: the
auth pages render but every submission answers "Accounts aren't available just
yet", and the waitlist refuses signups rather than pretending to accept them.
That is deliberate — an address that is silently dropped is worse than an
error somebody can see.

## 1. Create a Supabase project

1. <https://supabase.com> → **New project** (free tier is enough).
2. When it has provisioned, open **Project Settings → API**.
3. Copy the **Project URL** and the **anon / public** key.

There is no third key to copy. This project deliberately needs no
`service_role` key anywhere — see step 3.

## 2. Local env

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`.env.local` is gitignored.

## 3. Create the tables

**SQL Editor** → paste all of [`supabase/schema.sql`](supabase/schema.sql) →
**Run**. It is safe to re-run; every statement is idempotent. Re-run it after
pulling changes, because the file has changed since the first version.

What it creates:

- **`waitlist`** — captured emails. RLS is on and **no policy grants the public
  key any access at all**, so the list can be neither read nor written directly.
  Signups go through `join_waitlist()`, a `SECURITY DEFINER` function that the
  public key may only *execute*.

  The reason is that `email` is `UNIQUE`. If the public key could insert
  directly, anyone could POST an address to the REST API and read the answer
  off the status code — `201` for a stranger, `409` for somebody already on the
  list — which turns a signup form into a "is this person a customer?" oracle.
  The function returns nothing and swallows duplicates, so there is no answer to
  read. It also caps inserts at 20 per minute, because that endpoint is
  reachable without going through the website's bot checks.

- **`profiles`** — one row per user, created by a trigger on signup. A user can
  read their own row and **cannot update it**: the table holds only `id`,
  `email` and `created_at`, none of which a user has a reason to change, and
  Postgres row-level security cannot restrict *which columns* a policy covers.

## 4. Configure Auth URLs

**Authentication → URL Configuration**:

- **Site URL**: `https://verdure-app.com`
- **Redirect URLs**: add both
  - `https://verdure-app.com/auth/callback`
  - `http://localhost:3000/auth/callback`

**Authentication → Providers → Email** is on by default.

- **Confirm email ON** (recommended): new users get a verification link and land
  on `/auth/callback`.
- **Confirm email OFF**: signups get a session immediately and go to
  `/account`. Both paths are handled.

## 5. Production env (Vercel)

**Project → Settings → Environment Variables**, and set the **Environment to
Production only** for each:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
| `NEXT_PUBLIC_SITE_URL` | `https://verdure-app.com` |

Two things that bite if skipped:

- **Scope them to Production, not "All Environments."** The default applies a
  variable to preview deployments too, and preview URLs are public unless
  Deployment Protection is on — that would put working database credentials on
  a URL anyone can find.
- **`NEXT_PUBLIC_SITE_URL` is not optional in production.** It is the origin
  baked into confirmation emails. Without it the code falls back to the
  canonical host and logs an error, but setting it explicitly is what makes the
  link right.

Then **redeploy** — environment variables are read at build time, so an
existing deployment will not pick them up on its own.

## 6. Verify it actually took

```bash
curl -sI "https://verdure-app.com/account?cb=$RANDOM" | grep -i "^location"
```

- `location: /login` → configured. An unauthenticated visitor is being sent to
  log in, which means the auth layer is live.
- `location: /` → **not** configured. That is the code path taken when the
  Supabase environment variables are missing.

Then sign up with a real address and confirm the email arrives and its link
points at `verdure-app.com`, not `localhost`.

## 7. Reading the waitlist

The public key cannot read this table, which is the point — so the list is read
from the dashboard, where you are authenticated as the project owner.

**Table Editor → `waitlist`** shows every signup. Sort on `created_at` and use
**Export → CSV** for the whole list.

For a summary, **SQL Editor**:

```sql
-- Everyone, newest first.
select email, source, created_at
from public.waitlist
order by created_at desc;

-- How many, and where they came from.
select source, count(*) as signups
from public.waitlist
group by source
order by signups desc;

-- Signups per day for the last fortnight.
select date_trunc('day', created_at)::date as day, count(*) as signups
from public.waitlist
where created_at > now() - interval '14 days'
group by day
order by day desc;
```

To be told about signups rather than checking: **Database → Webhooks** can POST
each new `waitlist` row to an email service or a Slack/Discord incoming webhook.
Send it somewhere private — the payload contains the address.

## Notes

- Route protection is in `src/middleware.ts`, with a second `getUser()` check
  inside `/account` itself.
- The session cookie is `HttpOnly`, so no browser code can read it. The navbar
  learns whether you are signed in from `/auth/session`, which returns one
  boolean and nothing else about you.
- The `anon` key is public by design; access is governed entirely by RLS. Never
  put a `service_role` key in a `NEXT_PUBLIC_` variable — and on this project,
  do not add one at all without re-reading `supabase/schema.sql` first.
