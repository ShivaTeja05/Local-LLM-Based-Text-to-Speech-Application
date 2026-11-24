import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, ApiService } from './api.service';
import { LocalDbService } from './local-db.service';
import { MY_VOICE, MyVoice } from './models';
import { SettingsService } from './settings.service';
import { StatusService } from './status.service';

const MAX_SECONDS = 40; // the backend accepts up to 45
export type MyVoiceState = 'idle' | 'recording' | 'processing';

/**
 * The phonetics passage used for recording: "The North Wind and the Sun", which phoneticians
 * have used for over a century to sample a speaker's voice. About 20 seconds read aloud.
 */
export const PASSAGE =
  'The North Wind and the Sun were disputing which was the stronger, when a traveller came along ' +
  'wrapped in a warm cloak. They agreed that the one who first succeeded in making the traveller take ' +
  'his cloak off should be considered stronger than the other.';

/**
 * Use my voice: record a short reading, get a voice fingerprint from the backend, and speak with
 * it. The recording is sent once and not kept; the fingerprint lives only in this browser (the
 * local database, LocalDbService) until the user deletes it or 30 days pass unused.
 */
@Injectable({ providedIn: 'root' })
export class MyVoiceService {
  private readonly api = inject(ApiService);
  private readonly settings = inject(SettingsService);
  private readonly status = inject(StatusService);
  private readonly db = inject(LocalDbService);

  readonly voice = signal<MyVoice | null>(null);
  /** Resolves once a saved voice (if any) has been read back. */
  readonly loaded: Promise<void> = this.db.get<MyVoice>('my-voice').then((v) => {
    if (v && typeof v.fingerprint === 'string' && typeof v.base === 'string' && !this.voice()) this.voice.set(v);
  });
  readonly state = signal<MyVoiceState>('idle');
  readonly seconds = signal(0);
  readonly problem = signal<string | null>(null);
  /** Offered when the browser can record and the server has the converter. */
  readonly available = computed(
    () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!this.status.health()?.clone?.ok,
  );

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private discard = false;

  /** Speech for `text` in a voice id; "my-voice" becomes the British base voice re-voiced as you. */
  tts(text: string, voiceId: string | null): Promise<ArrayBuffer> {
    const mine = this.voice();
    if (voiceId === MY_VOICE && mine) return this.api.tts(text, mine.base, mine.fingerprint);
    return this.api.tts(text, voiceId === MY_VOICE ? null : voiceId);
  }

  async start(): Promise<void> {
    if (this.state() !== 'idle') return;
    this.problem.set(null);
    let stream: MediaStream;
    try {
      // No echo cancellation or gain tricks: the fingerprint should hear the voice as it is.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
      });
    } catch (err) {
      const blocked = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.problem.set(blocked
        ? "Microphone access is blocked. Allow it in your browser's site settings to record your voice."
        : 'No microphone was found.');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    this.recorder = recorder;
    this.chunks = [];
    this.discard = false;
    recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (this.discard) return this.state.set('idle');
      void this.enrol(new Blob(this.chunks, { type: recorder.mimeType || type || 'audio/webm' }));
    };
    recorder.start();
    this.state.set('recording');
    this.seconds.set(0);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.seconds.update((s) => s + 1);
      if (this.seconds() >= MAX_SECONDS) this.stop();
    }, 1000);
  }

  /** Make the voice from an existing recording (WAV, MP3, M4A, OGG, WebM...). */
  async upload(file: File): Promise<void> {
    if (this.state() !== 'idle') return;
    this.problem.set(null);
    if (file.type && !file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
      this.problem.set('Please choose an audio file, such as a WAV, MP3 or M4A recording.');
      return;
    }
    if (file.size > 15_000_000) {
      this.problem.set('That file is too large: please choose one under 15 MB (about a minute of speech is plenty).');
      return;
    }
    // Some systems give no type for .m4a and friends: the server reads the format from the file itself.
    const type = file.type.startsWith('audio/') ? file.type : 'audio/unknown';
    await this.enrol(new Blob([file], { type }));
  }

  /** Stop recording and make the voice. */
  stop(): void {
    clearInterval(this.timer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  /** Stop and throw the recording away. */
  cancel(): void {
    this.discard = true;
    this.stop();
    this.problem.set(null);
  }

  /** Forget my voice (in this browser; the server never had it). */
  remove(): void {
    this.voice.set(null);
    void this.db.delete('my-voice');
    if (this.settings.voiceId() === MY_VOICE) this.settings.voiceId.set(null);
  }

  private async enrol(audio: Blob): Promise<void> {
    this.state.set('processing');
    try {
      const made = await this.api.myVoice(audio);
      const voice: MyVoice = { ...made, createdAt: Date.now() };
      this.voice.set(voice);
      await this.db.put('my-voice', voice);
      this.settings.voiceId.set(MY_VOICE);
    } catch (err) {
      this.problem.set(err instanceof ApiError && err.status !== 500 ? err.message : "Sorry, I couldn't make your voice just now.");
    } finally {
      this.state.set('idle');
    }
  }
}
