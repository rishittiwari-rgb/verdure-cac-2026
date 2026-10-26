import type { Metadata } from "next";
import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";
import { signup } from "@/app/auth/actions";
import { pageMetadata } from "@/lib/seo";

// indexable: false — still noindex, but now with a share card.
//
// This is the call to action on four public pages, so it is the link people
// actually paste, and it was the one page with no og:* at all: dropped into
// Slack or iMessage it unfurled as a bare URL. pageMetadata with indexable
// false emits the Open Graph block while omitting the canonical, since a
// canonical on a noindex page asks a crawler for two contradictory things.
export const metadata: Metadata = pageMetadata({
  // The root layout's title template appends "· Verdure".
  title: "Create Account",
  socialTitle: "Join the Verdure waitlist.",
  description:
    "Create your Verdure account to join the waitlist — three real places near you each day, streaks, and points worth real gift cards.",
  path: "/signup",
  indexable: false,
});

export default function SignupPage()
{
  return (
    <>
      <header className="mb-7 text-center">
        <h1 className="font-display text-[clamp(1.9rem,5vw,2.4rem)] font-semibold leading-tight text-cream">
          Get Access
        </h1>
        <p className="mt-2 text-[0.98rem] text-cream/70">
          Create your account and start exploring your world.
        </p>
      </header>

      <AuthForm mode="signup" action={signup} />

      <p className="mt-7 text-center text-sm text-cream/70">
        Already have an account?{" "}
        <Link
          href="/login"
          className="link-underline font-semibold text-cream transition-colors duration-300"
        >
          Log in
        </Link>
      </p>
    </>
  );
}
