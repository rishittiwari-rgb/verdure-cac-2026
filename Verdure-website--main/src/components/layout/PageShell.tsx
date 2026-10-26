import { SoundProvider } from "@/providers/SoundProvider";
import Navbar from "@/components/ui/Navbar";
import Footer from "@/components/sections/Footer";
import SoundToggle from "@/components/ui/SoundToggle";

/**
 * PageShell — the one site chrome: nav, content, footer. Plain native
 * scroll, no preloader, no scroll engine. Every page renders complete
 * the moment it arrives.
 */
export default function PageShell({ children }: { children: React.ReactNode })
{
  return (
    <SoundProvider>
      <Navbar />
      <main id="main-content" className="relative">
        {children}
      </main>
      <Footer />
      <SoundToggle />
    </SoundProvider>
  );
}
