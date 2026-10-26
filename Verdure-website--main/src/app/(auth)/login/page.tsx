import type { Metadata } from "next";
import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";
import { login } from "@/app/auth/actions";

export const metadata: Metadata = {
  // The root layout's title template appends "· Verdure".
  title: "Log In",
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  // Next 15 delivers searchParams as a Promise.
  searchParams: Promise<{ redirect?: string; error?: string }>;
})
{
  let params = await searchParams;
  let redirectTo = params.redirect;
  let hadCallbackError = params.error === "auth_callback_failed";

  return (
    <>
      <header className="mb-7 text-center">
        <h1 className="font-display text-[clamp(1.9rem,5vw,2.4rem)] font-semibold leading-tight text-cream">
          Welcome back
        </h1>
        <p className="mt-2 text-[0.98rem] text-cream/70">
          Log in to pick up where you left off.
        </p>
      </header>

      {hadCallbackError ? (
        <p
          role="alert"
          className="mb-5 rounded-[14px] border border-line px-4 py-3 text-sm font-bold text-cream"
        >
          That confirmation link was invalid or has expired. Try logging in again.
        </p>
      ) : null}

      <AuthForm mode="login" action={login} redirectTo={redirectTo} />

      <p className="mt-7 text-center text-sm text-cream/70">
        New to Verdure?{" "}
        <Link
          href="/signup"
          className="link-underline font-semibold text-cream transition-colors duration-300"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
