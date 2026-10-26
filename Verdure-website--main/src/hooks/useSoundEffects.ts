"use client";

import { useCallback, useRef, useState } from "react";

class SoundEngine {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private _muted = false;
  private _volume = 0.45;

  private getCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this._muted ? 0 : this._volume;
      this.gainNode.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return { ctx: this.ctx, gain: this.gainNode! };
  }

  get muted() {
    return this._muted;
  }

  get volume() {
    return this._volume;
  }

  setMuted(v: boolean) {
    this._muted = v;
    if (this.gainNode) {
      this.gainNode.gain.value = v ? 0 : this._volume;
    }
  }

  setVolume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._volume === 0) {
      this._muted = true;
    } else {
      this._muted = false;
    }
    if (this.gainNode) {
      this.gainNode.gain.value = this._muted ? 0 : this._volume;
    }
  }

  // Soft click / tap
  playClick() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.08);
    env.gain.setValueAtTime(0.3, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(env).connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
  }

  // Hover — gentle high-pitched blip
  playHover() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.06);
    env.gain.setValueAtTime(0.12, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(env).connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.06);
  }

  // Whoosh — scroll/transition sound
  playWhoosh() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const bufferSize = ctx.sampleRate * 0.15;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.15);
    filter.Q.value = 0.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.2, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    source.connect(filter).connect(env).connect(gain);
    source.start(ctx.currentTime);
  }

  // Success chime — ascending notes
  playSuccess() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.1;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.2, t + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(env).connect(gain);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  // Ambient pad — low drone
  playAmbientPulse() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const env = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 80;
    osc2.type = "sine";
    osc2.frequency.value = 120;
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.5);
    env.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
    osc1.connect(env).connect(gain);
    osc2.connect(env);
    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 2);
    osc2.stop(ctx.currentTime + 2);
  }

  // Reveal — for loading screen completion
  playReveal() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const notes = [261, 329, 392, 523, 659]; // C4 E4 G4 C5 E5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.08;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.15, t + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(env).connect(gain);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  // Scroll tick — subtle tick on scroll direction change
  playScrollTick() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);
    env.gain.setValueAtTime(0.08, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.connect(env).connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.04);
  }

  // Focus — input focus sound
  playFocus() {
    if (this._muted) return;
    const { ctx, gain } = this.getCtx();
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(500, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(700, ctx.currentTime + 0.1);
    env.gain.setValueAtTime(0.1, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(env).connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  }
}

const engine = new SoundEngine();

export function useSoundEffects() {
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(0.45);
  const throttle = useRef<Record<string, number>>({});

  const throttled = useCallback(
    (key: string, fn: () => void, ms = 80) => {
      const now = Date.now();
      if (now - (throttle.current[key] || 0) > ms) {
        throttle.current[key] = now;
        fn();
      }
    },
    []
  );

  return {
    muted,
    volume,
    toggleMute: useCallback(() => {
      const next = !engine.muted;
      engine.setMuted(next);
      setMutedState(next);
    }, []),
    setVolume: useCallback((v: number) => {
      engine.setVolume(v);
      setVolumeState(v);
      setMutedState(v === 0);
    }, []),
    playClick: useCallback(() => throttled("click", () => engine.playClick()), [throttled]),
    playHover: useCallback(() => throttled("hover", () => engine.playHover()), [throttled]),
    playWhoosh: useCallback(() => throttled("whoosh", () => engine.playWhoosh(), 300), [throttled]),
    playSuccess: useCallback(() => throttled("success", () => engine.playSuccess(), 500), [throttled]),
    playAmbientPulse: useCallback(() => throttled("ambient", () => engine.playAmbientPulse(), 2000), [throttled]),
    playReveal: useCallback(() => engine.playReveal(), []),
    playScrollTick: useCallback(() => throttled("scrolltick", () => engine.playScrollTick(), 500), [throttled]),
    playFocus: useCallback(() => throttled("focus", () => engine.playFocus(), 200), [throttled]),
  };
}

export { engine as soundEngine };
