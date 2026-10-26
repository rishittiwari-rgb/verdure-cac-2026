import Link from "next/link";
import { LEGAL_UPDATED, type LegalSection } from "@/lib/legal";

export default function LegalDocument({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  return <>
    <section className="page-pad pb-12 pt-28 md:pb-16 md:pt-36">
      <div className="mx-auto max-w-[820px]">
        <span className="kicker">Legal</span>
        <h1 className="font-display mt-5 text-[clamp(2.4rem,6vw,4rem)] font-bold leading-tight">{title}</h1>
        <p className="t-body2 mt-5 text-cream/60">Last updated: {LEGAL_UPDATED}</p>
        <p className="t-body1 mt-8 text-cream/80">{intro}</p>
        <nav aria-label="On this page" className="glass-ink mt-12 rounded-2xl p-7">
          <h2 className="kicker">On this page</h2>
          <ol className="mt-5 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {sections.map((section, index) => <li key={section.id} className="flex gap-3">
              <span className="font-num text-[13px] text-cream/40">{String(index + 1).padStart(2, "0")}</span>
              <a href={`#${section.id}`} className="link-underline t-body2 text-cream/80">{section.title}</a>
            </li>)}
          </ol>
        </nav>
      </div>
    </section>
    <div className="page-pad pb-24 md:pb-32"><div className="mx-auto flex max-w-[820px] flex-col gap-12">
      {sections.map(section => <section key={section.id} id={section.id} className="scroll-mt-28 border-t border-line pt-12">
        <h2 className="font-display text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-tight">{section.title}</h2>
        <div className="legal-prose"><p>{section.body}</p></div>
      </section>)}
      <p className="t-body2 text-cream/80">Need help? <Link className="underline" href="/support">Contact support</Link>. Read our <Link className="underline" href="/terms">Terms of Service</Link> and <Link className="underline" href="/privacy">Privacy Policy</Link>.</p>
    </div></div>
  </>;
}
