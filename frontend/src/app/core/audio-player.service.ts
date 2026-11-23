import { Injectable, computed, inject, signal } from '@angular/core';

import { SettingsService } from './settings.service';

/** One sentence of speech: its audio (being synthesised) and the words, which set the pause after it. */
export interface Clip {
  audio: Promise<ArrayBuffer>;
  text: string;
}

const words = (text: string) => (text.trim().match(/\S+/g) ?? []).length;

/**
 * How long a person would pause after saying this sentence, in milliseconds: a little longer after
 * a question or exclamation, shorter after a clause break, and longer after a long sentence, when
 * they would need more breath. (Natural conversational pauses are roughly 0.2-0.6 s.)
 */
export function pauseAfter(text: string): number {
  const t = text.trim();
  let ms = /[?!]["')\]]*$/.test(t) ? 380 : /[.…]["')\]]*$/.test(t) ? 320 : /[,;:—–-]$/.test(t) ? 180 : 260;
  const n = words(t);
  if (n > 14) ms += 120;
  if (n > 24) ms += 80;
  return ms;
}

/** Breathe in before a long sentence, or after a long one. */
export function wantsBreath(previous: string, next: string): boolean {
  return words(next) >= 10 || words(previous) >= 18;
}

/**
 * Plays a message's speech as a queue of sentence clips (Web Audio API) and exposes the live
 * loudness, which drives the avatar's mouth.
 *
 * Clips are queued in sentence order, so sentence 2 can be synthesising while sentence 1 plays,
 * and order is kept even if sentence 2's WAV arrives first. With "natural pauses" on, the player
 * leaves a human-sized pause between sentences, with a soft inhale before long ones. Time spent
 * waiting for the next clip counts towards that pause, so it never adds delay on top.
 */
@Injectable({ providedIn: 'root' })
export class AudioPlayerService {
  private readonly settings = inject(SettingsService);

  /** Id of the message being spoken, or null. */
  readonly speakingId = signal<string | null>(null);
  /** True while a clip is actually sounding (not while waiting for the first one). */
  readonly sounding = signal(false);
  /** Smoothed loudness 0..1 for lip-sync. */
  readonly level = signal(0);
  readonly isSpeaking = computed(() => this.speakingId() !== null);
  /** The sentence that is sounding now; `n` counts up, so a repeated sentence is still new. */
  readonly sentence = signal<{ text: string; n: number } | null>(null);

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private breath: AudioBuffer | null = null;
  private queue: Clip[] = [];
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;
  private pumping = false;
  private finishing = false;
  private raf = 0;

  /** Create/resume the AudioContext. Call from a user gesture (click, Enter) before awaiting. */
  resumeAudio(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.ctx.destination);
      this.samples = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Start a new spoken message; anything playing is stopped. */
  begin(messageId: string): void {
    this.stop();
    this.speakingId.set(messageId);
    this.finishing = false;
  }

  enqueue(messageId: string, clip: Clip): void {
    if (this.speakingId() !== messageId) return;
    clip.audio.catch(() => undefined); // failures are handled in the pump; avoid unhandled rejections
    this.queue.push(clip);
    if (!this.pumping) void this.pump(this.generation);
  }

  /** No more clips will be queued for this message: stop when the queue drains. */
  end(messageId: string): void {
    if (this.speakingId() !== messageId) return;
    this.finishing = true;
    if (!this.pumping && this.queue.length === 0) this.reset();
  }

  /** Play a complete set of clips (replay). */
  play(messageId: string, clips: Clip[]): void {
    this.begin(messageId);
    clips.forEach((c) => this.enqueue(messageId, c));
    this.end(messageId);
  }

  stop(): void {
    this.generation++;
    this.queue = [];
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source = null;
    }
    this.pumping = false;
    this.reset();
  }

  private reset(): void {
    this.speakingId.set(null);
    this.sounding.set(false);
    this.level.set(0);
    this.sentence.set(null);
    cancelAnimationFrame(this.raf);
  }

  private async pump(gen: number): Promise<void> {
    this.pumping = true;
    let previous: { text: string; endedAt: number } | null = null;
    while (this.queue.length && gen === this.generation) {
      const next = this.queue.shift()!;
      let buffer: AudioBuffer | null = null;
      try {
        const bytes = await next.audio;
        if (gen !== this.generation || !this.ctx) return;
        buffer = await this.ctx.decodeAudioData(bytes.slice(0));
      } catch (err) {
        console.warn('Skipping a speech clip that failed', err);
        continue;
      }
      if (gen !== this.generation) return;
      if (previous && this.settings.naturalPauses()) {
        await this.breathe(previous, next.text, gen);
        if (gen !== this.generation) return;
      }
      await this.playBuffer(buffer, gen, next.text);
      previous = { text: next.text, endedAt: performance.now() };
    }
    if (gen !== this.generation) return;
    this.pumping = false;
    this.sounding.set(false);
    if (this.finishing) this.reset();
  }

  /** The pause between two sentences, with a soft inhale before long ones. */
  private async breathe(previous: { text: string; endedAt: number }, nextText: string, gen: number): Promise<void> {
    const jitter = 0.85 + Math.random() * 0.3; // ±15%, so it doesn't sound mechanical
    const pause = pauseAfter(previous.text) * jitter;
    const remaining = pause - (performance.now() - previous.endedAt); // time already spent waiting counts
    if (remaining <= 0) return;
    if (wantsBreath(previous.text, nextText) && remaining > 220) this.playBreath(remaining);
    await new Promise((resolve) => setTimeout(resolve, remaining));
    if (gen === this.generation) this.level.set(0);
  }

  /** A soft synthetic inhale: band-passed noise with a breathy swell, straight to the speakers
   *  (not through the analyser, so the avatar's lips stay closed while "breathing"). */
  private playBreath(withinMs: number): void {
    if (!this.ctx) return;
    if (!this.breath) this.breath = makeBreath(this.ctx);
    const src = this.ctx.createBufferSource();
    src.buffer = this.breath;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(band).connect(gain).connect(this.ctx.destination);
    // End the inhale just before the next sentence starts.
    const lead = Math.max(0, withinMs / 1000 - this.breath.duration - 0.05);
    src.start(this.ctx.currentTime + lead);
  }

  private playBuffer(buffer: AudioBuffer, gen: number, text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ctx || !this.analyser) return resolve();
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser);
      src.onended = () => {
        if (this.source === src) this.source = null;
        resolve();
      };
      this.source = src;
      src.start();
      this.sentence.set({ text, n: (this.sentence()?.n ?? 0) + 1 });
      this.sounding.set(true);
      this.meter(gen);
    });
  }

  /** Loudness for lip-sync: RMS of the waveform, with fast attack and slower release. */
  private meter(gen: number): void {
    cancelAnimationFrame(this.raf);
    let smooth = this.level();
    const tick = () => {
      if (gen !== this.generation || !this.analyser || !this.samples) return;
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (const s of this.samples) sum += s * s;
      const rms = Math.sqrt(sum / this.samples.length);
      // Piper speech peaks around RMS 0.2-0.3; map so normal speech opens the mouth about half to
      // three-quarters, and only stressed syllables open it fully.
      const target = Math.min(1, Math.max(0, (rms - 0.015) * 3.2));
      smooth += (target - smooth) * (target > smooth ? 0.6 : 0.25);
      this.level.set(smooth);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}

/** 0.32 s of noise shaped like a quiet inhale: a quick swell, a short hold, a gentle fade. */
function makeBreath(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 0.32;
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let low = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    const envelope = t < 0.4 ? Math.sin((t / 0.4) * (Math.PI / 2)) : Math.cos(((t - 0.4) / 0.6) * (Math.PI / 2));
    low += (Math.random() * 2 - 1 - low) * 0.35; // soften the hiss a little
    data[i] = low * envelope * 0.12; // audible but soft: speech peaks are several times louder
  }
  return buffer;
}
