import { Injectable, computed, signal } from '@angular/core';

/**
 * Plays a message's speech as a gapless queue of sentence clips (Web Audio API) and exposes
 * the live loudness, which drives the avatar's mouth.
 *
 * Clips are queued as promises in sentence order, so sentence 2 can be synthesising while
 * sentence 1 plays, and order is kept even if sentence 2's WAV arrives first.
 */
@Injectable({ providedIn: 'root' })
export class AudioPlayerService {
  /** Id of the message being spoken, or null. */
  readonly speakingId = signal<string | null>(null);
  /** True while a clip is actually sounding (not while waiting for the first one). */
  readonly sounding = signal(false);
  /** Smoothed loudness 0..1 for lip-sync. */
  readonly level = signal(0);
  readonly isSpeaking = computed(() => this.speakingId() !== null);

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private queue: Promise<ArrayBuffer>[] = [];
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

  enqueue(messageId: string, clip: Promise<ArrayBuffer>): void {
    if (this.speakingId() !== messageId) return;
    clip.catch(() => undefined); // failures are handled in the pump; avoid unhandled rejections
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
  play(messageId: string, clips: Promise<ArrayBuffer>[]): void {
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
    cancelAnimationFrame(this.raf);
  }

  private async pump(gen: number): Promise<void> {
    this.pumping = true;
    while (this.queue.length && gen === this.generation) {
      const next = this.queue.shift()!;
      let buffer: AudioBuffer | null = null;
      try {
        const bytes = await next;
        if (gen !== this.generation || !this.ctx) return;
        buffer = await this.ctx.decodeAudioData(bytes.slice(0));
      } catch (err) {
        console.warn('Skipping a speech clip that failed', err);
        continue;
      }
      if (gen !== this.generation) return;
      await this.playBuffer(buffer, gen);
    }
    if (gen !== this.generation) return;
    this.pumping = false;
    this.sounding.set(false);
    if (this.finishing) this.reset();
  }

  private playBuffer(buffer: AudioBuffer, gen: number): Promise<void> {
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
