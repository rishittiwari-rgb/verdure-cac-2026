"use client";

import { useState } from "react";
import LenisProvider from "@/providers/LenisProvider";
import { SoundProvider } from "@/providers/SoundProvider";
import { BootProvider } from "@/providers/BootProvider";
import LoadingScreen from "@/components/ui/LoadingScreen";
import SoundToggle from "@/components/ui/SoundToggle";
import Marquee from "@/components/ui/Marquee";
import Navbar from "@/components/ui/Navbar";
import HeroSection from "@/components/sections/HeroSection";
import DescriptionSection from "@/components/sections/DescriptionSection";
import ProblemSection from "@/components/sections/ProblemSection";
import SolutionSection from "@/components/sections/SolutionSection";
import GamificationSection from "@/components/sections/GamificationSection";
import CommunitySection from "@/components/sections/CommunitySection";
import RoadmapSection from "@/components/sections/RoadmapSection";
import TeamSection from "@/components/sections/TeamSection";
import CTASection from "@/components/sections/CTASection";
import Footer from "@/components/sections/Footer";

export default function Home()
{
  let [loaded, setLoaded] = useState(false);

  let handleLoaded = function ()
  {
    setLoaded(true);
  };

  return (
    <SoundProvider>
      <BootProvider>
        <LenisProvider>
          {/* Preloader — count-up then brand reveal */}
          {!loaded && <LoadingScreen onComplete={handleLoaded} />}

          {/* Soft grain over everything */}
          <div className="noise-overlay" />

          <div style={{ position: "relative", zIndex: 1 }}>
            <Navbar />

            <main>
              <HeroSection />

              {/* Plain-language description — before any statistics */}
              <DescriptionSection />

              <Marquee />

              {/* Stats / social proof */}
              <ProblemSection />

              {/* How it works */}
              <SolutionSection />

              {/* Feature highlights (gamified) */}
              <GamificationSection />

              {/* Who it's for */}
              <CommunitySection />

              {/* Roadmap */}
              <RoadmapSection />

              <Marquee reverse />

              {/* Team */}
              <TeamSection />

              {/* Get early access (final CTA) */}
              <CTASection />
            </main>

            <Footer />
          </div>

          {/* Sound toggle */}
          <SoundToggle />
        </LenisProvider>
      </BootProvider>
    </SoundProvider>
  );
}
