import { signOut } from "@/app/auth/actions";

// Sign-out is a state-changing action, so it lives in a real <form> POST
// rather than a client onClick — no client JS required.
export default function SignOutButton()
{
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="pill pill--ink pill--static pill--sm"
      >
        <span>Sign out</span>
      </button>
    </form>
  );
}
