import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/auth/SignOutButton";
import WelcomeFlourish from "@/components/auth/WelcomeFlourish";

export const metadata: Metadata = {
  // The root layout's title template appends "· Verdure".
  title: "Your Account",
  robots: { index: false },
};

// What to call somebody.
//
// full_name is what signup collects, but it cannot be assumed: accounts
// created before that field existed have none, and a direct call to
// /auth/v1/signup with the publishable key can omit it. The fallback reads the
// local part of the address, which is a guess — "sam.rivera" becomes "Sam
// rivera" — but a slightly-wrong first name is a better greeting than a blank
// one, and anyone who dislikes it can be given a proper name field later.
//
// Everything here is rendered through JSX, so React escapes it. The value is
// also only ever shown to its own owner.
function displayName(fullName: unknown, email: string | undefined): string
{
  if (typeof fullName === "string" && fullName.trim())
  {
    return fullName.trim();
  }

  let local = (email ?? "").split("@").at(0) ?? "";
  let spaced = local.replace(/[._+-]+/g, " ").trim();

  if (!spaced)
  {
    return "there";
  }

  // charAt rather than spaced[0]: the same character, and the one spelling
  // that does not read as an array index into a string.
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default async function AccountPage()
{
  let supabase = await createClient();

  // Auth not configured — nothing to show here.
  if (!supabase)
  {
    redirect("/");
  }

  let {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route; this is the defence-in-depth check.
  if (!user)
  {
    redirect("/login");
  }

  let joinedOn = new Date(user.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let emailConfirmed = Boolean(user.email_confirmed_at);
  let name = displayName(user.user_metadata?.full_name, user.email);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-20 md:py-28">
      <WelcomeFlourish name={name} />
      <div className="mb-10 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="Verdure home"
        >
          <span
            className="inline-block h-3 w-3 rotate-45"
            style={{ background: "var(--accent)" }}
            aria-hidden="true"
          />
          <span className="font-display text-xl font-semibold tracking-tight text-cream">
            Verdure
          </span>
        </Link>
        <SignOutButton />
      </div>

      <span className="inline-flex items-center gap-2 rounded-[10px] border border-cream/10 px-4 py-2">
        <span
          className="inline-block h-2 w-2 rotate-45"
          style={{ background: "var(--accent)", boxShadow: "0 0 10px rgba(0,230,118,0.45)" }}
          aria-hidden="true"
        />
        <span className="kicker !text-cream">Signed In</span>
      </span>

      <h1 className="font-display mt-6 text-[clamp(2.2rem,6vw,3.4rem)] font-bold leading-[1.02] tracking-tight text-cream">
        Welcome back, {name}
      </h1>
      <p className="measure mt-4 text-[1.02rem] leading-relaxed text-cream/70">
        You&apos;re all set. We&apos;ll let you know the moment new Verdure
        features land.
      </p>

      <dl className="mt-10 grid gap-6 rounded-[20px] border border-cream/10 p-8 sm:grid-cols-2 md:p-10">
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.16em] text-cream/70">
            Email
          </dt>
          <dd className="mt-1.5 break-all text-[1.05rem] font-medium text-cream">
            {user.email}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.16em] text-cream/70">
            Member since
          </dt>
          <dd className="mt-1.5 text-[1.05rem] font-medium text-cream">{joinedOn}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold uppercase tracking-[0.16em] text-cream/70">
            Email status
          </dt>
          <dd className="mt-1.5 text-[1.05rem] font-medium text-cream">
            {emailConfirmed ? "Confirmed" : "Pending confirmation"}
          </dd>
        </div>
      </dl>
    </main>
  );
}
