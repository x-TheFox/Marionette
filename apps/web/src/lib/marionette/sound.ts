'use client';

/**
 * Sound manager for the Kenney CC0 cue set (mutable + volume, default ON).
 * Audio elements are created lazily after the first user gesture so browser
 * autoplay policies do not block playback.
 */
export type SoundName = 'move' | 'capture' | 'check' | 'promotion' | 'milestone' | 'victory' | 'defeat' | 'illegal';

const FILES: Record<SoundName, string> = {
  move: '/sounds/move.ogg',
  capture: '/sounds/capture.ogg',
  check: '/sounds/check.ogg',
  promotion: '/sounds/promotion.ogg',
  milestone: '/sounds/milestone.ogg',
  victory: '/sounds/victory.ogg',
  defeat: '/sounds/defeat.ogg',
  illegal: '/sounds/illegal.ogg',
};

class SoundManager {
  private enabled = true;
  private volume = 0.7;
  private cache = new Map<SoundName, HTMLAudioElement>();

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
  }

  private get(name: SoundName): HTMLAudioElement {
    let el = this.cache.get(name);
    if (!el) {
      el = new Audio(FILES[name]);
      el.preload = 'auto';
      this.cache.set(name, el);
    }
    return el;
  }

  play(name: SoundName, force = false): void {
    if (!this.enabled && !force) return;
    try {
      const el = this.get(name).cloneNode() as HTMLAudioElement;
      el.volume = this.volume;
      void el.play().catch(() => {
        // Autoplay blocked (no user gesture yet) or missing asset: stay silent.
      });
    } catch {
      // Audio unavailable: stay silent.
    }
  }
}

export const sound = new SoundManager();
