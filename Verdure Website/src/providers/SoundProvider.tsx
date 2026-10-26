"use client";

import { createContext, useContext } from "react";
import { useSoundEffects } from "@/hooks/useSoundEffects";

type SoundCtx = ReturnType<typeof useSoundEffects>;

const SoundContext = createContext<SoundCtx | null>(null);

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const sound = useSoundEffects();
  return (
    <SoundContext.Provider value={sound}>{children}</SoundContext.Provider>
  );
}

export function useSound() {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound must be used within SoundProvider");
  return ctx;
}
