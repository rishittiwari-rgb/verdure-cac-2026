"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { AuthState } from "@/app/auth/actions";

type AuthAction = (prev: AuthState, formData: FormData) => Promise<AuthState>;

interface AuthFormProps
{
  mode: "login" | "signup";
  action: AuthAction;
  /** Where login should land after success (relative path only). */
  redirectTo?: string;
}

let INITIAL_STATE: AuthState = {};

function SubmitButton({ mode }: { mode: "login" | "signup" })
{
  let { pending } = useFormStatus();
  let idleLabel = mode === "login" ? "Log In" : "Create Account";

  return (
    <button
      type="submit"
      disabled={pending}
      className="pill pill--ink pill--static mt-2 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span>{pending ? "One moment…" : idleLabel}</span>
    </button>
  );
}

export default function AuthForm({ mode, action, redirectTo }: AuthFormProps)
{
  let [state, formAction] = useActionState(action, INITIAL_STATE);
  let isSignup = mode === "signup";

  // After a successful signup that needs email confirmation, the form is done.
  if (state.message)
  {
    return (
      <div className="rounded-[18px] px-6 py-7 text-center" style={{ background: "var(--band)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
        <p className="text-[1.02rem] font-semibold leading-relaxed text-cream">{state.message}</p>
        <Link
          href="/login"
          className="link-underline mt-5 inline-block text-sm font-bold text-cream/70 transition-colors duration-300 hover:text-cream"
        >
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {!isSignup && redirectTo ? (
        <input type="hidden" name="redirect" value={redirectTo} />
      ) : null}

      {isSignup ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-name" className="kicker !text-[12px] text-cream/60">
            Name
          </label>
          <input
            id="auth-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={80}
            placeholder="What should we call you?"
            className="field-cream"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="auth-email" className="kicker !text-[12px] text-cream/60">
          Email
        </label>
        <input
          id="auth-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@email.com"
          className="field-cream"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="auth-password" className="kicker !text-[12px] text-cream/60">
          Password
        </label>
        <input
          id="auth-password"
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          required
          minLength={isSignup ? 8 : undefined}
          placeholder={isSignup ? "At least 8 characters" : "••••••••"}
          className="field-cream"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-[14px] border border-line px-4 py-3 text-sm font-bold text-cream"
        >
          <span aria-hidden="true">▲ </span>
          {state.error}
        </p>
      ) : null}

      <SubmitButton mode={mode} />
    </form>
  );
}
