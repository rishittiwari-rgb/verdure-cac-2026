import Link from "next/link";
import Logo from "@/components/ui/Logo";

// Standalone, centered shell for auth pages — no marketing nav. A white
// card on the paper ground, in the site's clean-light voice.
export default function AuthLayout({ children }: { children: React.ReactNode })
{
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2.5 text-cream"
          aria-label="Verdure home"
        >
          <Logo size={30} />
          <span className="font-display text-xl font-bold tracking-tight">
            Verdure
          </span>
        </Link>

        <div className="glass-ink rounded-[26px] p-8 text-cream md:p-10">
          {children}
        </div>
      </div>
    </main>
  );
}
