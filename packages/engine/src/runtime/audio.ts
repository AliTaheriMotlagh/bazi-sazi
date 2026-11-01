import type { AssetCache } from './assets';

export type SfxPreset = 'coin' | 'jump' | 'hit' | 'explosion' | 'powerup' | 'laser' | 'blip' | 'lose' | 'win';

interface Tone {
  type: OscillatorType | 'noise';
  from: number;
  to: number;
  duration: number;
  gain: number;
  delay?: number;
}

// Tiny procedural sound library so every game has sound with zero assets.
const PRESETS: Record<SfxPreset, Tone[]> = {
  coin: [
    { type: 'square', from: 988, to: 988, duration: 0.08, gain: 0.2 },
    { type: 'square', from: 1319, to: 1319, duration: 0.25, gain: 0.2, delay: 0.08 },
  ],
  jump: [{ type: 'square', from: 300, to: 700, duration: 0.18, gain: 0.18 }],
  hit: [{ type: 'sawtooth', from: 400, to: 80, duration: 0.18, gain: 0.25 }],
  explosion: [{ type: 'noise', from: 1, to: 0, duration: 0.6, gain: 0.5 }],
  powerup: [
    { type: 'triangle', from: 400, to: 800, duration: 0.15, gain: 0.25 },
    { type: 'triangle', from: 600, to: 1200, duration: 0.25, gain: 0.25, delay: 0.12 },
  ],
  laser: [{ type: 'sawtooth', from: 1400, to: 200, duration: 0.15, gain: 0.12 }],
  blip: [{ type: 'sine', from: 880, to: 880, duration: 0.06, gain: 0.2 }],
  lose: [
    { type: 'triangle', from: 440, to: 220, duration: 0.3, gain: 0.25 },
    { type: 'triangle', from: 330, to: 110, duration: 0.5, gain: 0.25, delay: 0.3 },
  ],
  win: [
    { type: 'square', from: 523, to: 523, duration: 0.12, gain: 0.18 },
    { type: 'square', from: 659, to: 659, duration: 0.12, gain: 0.18, delay: 0.12 },
    { type: 'square', from: 784, to: 784, duration: 0.12, gain: 0.18, delay: 0.24 },
    { type: 'square', from: 1047, to: 1047, duration: 0.4, gain: 0.18, delay: 0.36 },
  ],
};

export interface PlayOptions {
  volume?: number;
  loop?: boolean;
  /** -1 (left) .. 1 (right) */
  pan?: number;
}

export interface SoundHandle {
  stop(): void;
  setVolume(v: number): void;
}

const NOOP: SoundHandle = { stop() {}, setVolume() {} };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private active = new Set<SoundHandle>();
  muted = false;

  constructor(private assets: AssetCache) {}

  /** The context is created lazily — browsers require a user gesture. */
  get context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === 'undefined') return null;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  resume(): void {
    void this.context?.resume();
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  sfx(preset: string, volume = 1): void {
    const tones = PRESETS[preset as SfxPreset];
    const ctx = this.context;
    if (!tones || !ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    for (const t of tones) {
      const start = now + (t.delay ?? 0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(t.gain * volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + t.duration);
      gain.connect(this.master);
      if (t.type === 'noise') {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3000, start);
        filter.frequency.exponentialRampToValueAtTime(100, start + t.duration);
        src.connect(filter).connect(gain);
        src.start(start);
        src.stop(start + t.duration);
      } else {
        const osc = ctx.createOscillator();
        osc.type = t.type;
        osc.frequency.setValueAtTime(t.from, start);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, t.to), start + t.duration);
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + t.duration + 0.02);
      }
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return (this.noise = buf);
  }

  /** Play an audio asset (by id or name) — or a preset name. */
  play(clip: string, opts: PlayOptions = {}): SoundHandle {
    if (clip in PRESETS) {
      this.sfx(clip, opts.volume ?? 1);
      return NOOP;
    }
    const ctx = this.context;
    if (!ctx || !this.master || this.muted) return NOOP;
    const promise = this.assets.audioBuffer(clip, ctx);
    if (!promise) return NOOP;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    const panner = ctx.createStereoPanner();
    panner.pan.value = opts.pan ?? 0;
    gain.connect(panner).connect(this.master);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    const handle: SoundHandle = {
      stop: () => {
        stopped = true;
        src?.stop();
        this.active.delete(handle);
      },
      setVolume: (v) => (gain.gain.value = v),
    };
    promise
      .then((buffer) => {
        if (stopped) return;
        src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = !!opts.loop;
        src.connect(gain);
        src.onended = () => this.active.delete(handle);
        src.start();
      })
      .catch(() => undefined);
    this.active.add(handle);
    return handle;
  }

  stopAll(): void {
    for (const h of [...this.active]) h.stop();
  }

  dispose(): void {
    this.stopAll();
    void this.ctx?.close();
    this.ctx = null;
  }
}
