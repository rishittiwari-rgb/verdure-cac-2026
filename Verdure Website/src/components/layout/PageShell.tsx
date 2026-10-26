"use client";

import { SoundProvider } from "@/providers/SoundProvider";
import LenisProvider from "@/providers/LenisProvider";
import Navbar from "@/components/ui/Navbar";
import Footer from "@/components/sections/Footer";

/**
 * PageShell — shared chrome for the static sub-pages (/story, /partnerships).
 *
 * Reuses the home providers (sound + Lenis smooth scroll) and the grain,
 * but skips the preloader and 3D scene so these pages load instantly.
 * LenisProvider sees no BootProvider here, so useBoot() reports ready and the
 * scroll lock never engages.
 */
export default function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <SoundProvider>
      <LenisProvider>
        <div className="noise-overlay" />

        <Navbar entranceDelay={0.2} />

        <main className="relative" style={{ zIndex: 1 }}>
          {children}
        </main>

        <Footer />
      </LenisProvider>
    </SoundProvider>
  );
}
