import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, ApiService } from './api.service';
import { AudioPlayerService } from './audio-player.service';
import { StatusService } from './status.service';

export type VoiceState = 'idle' | 'recording' | 'transcribing';
const MAX_SECONDS = 30; // matches the backend's STT_MAX_SECONDS

/**
 * Push-to-talk: record from the microphone, transcribe with the backend's local Whisper, and
 * hand the text back for the composer. Nothing is sent to the LLM until the user presses Send.
 */
@Injectable({ providedIn: 'root' })
export class VoiceInputService {
  private readonly api = inject(ApiService);
  private readonly player = inject(AudioPlayerService);
  private readonly status = inject(StatusService);

  readonly state = signal<VoiceState>('idle');
  readonly seconds = signal(0);
  /** A short, human message after a problem (cleared on the next attempt). */
  readonly problem = signal<string | null>(null);
  /** Shown only when the browser can record and the server has voice input switched on. */
  readonly available = computed(
    () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!this.status.health()?.stt?.ok,
  );

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private finished: ((text: string) => void) | null = null;

  /** Start recording. Resolves with the transcript once `stop()` is called (or 30 s pass). */
  async start(): Promise<string> {
    if (this.state() !== 'idle') return '';
    this.problem.set(null);
    this.player.stop(); // barge-in: talking over Ellie stops her
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (err) {
      const blocked = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.problem.set(blocked
        ? "Microphone access is blocked. Allow it in your browser's site settings to talk to Ellie."
        : 'No microphone was found.');
      return '';
    }

    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    this.recorder = recorder;
    this.chunks = [];
    recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    const done = new Promise<string>((resolve) => (this.finished = resolve));
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void this.transcribe(new Blob(this.chunks, { type: recorder.mimeType || type || 'audio/webm' }));
    };
    recorder.start();
    this.state.set('recording');
    this.seconds.set(0);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.seconds.update((s) => s + 1);
      if (this.seconds() >= MAX_SECONDS) this.stop();
    }, 1000);
    return done;
  }

  /** Stop recording and transcribe what was said. */
  stop(): void {
    clearInterval(this.timer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  /** Stop recording and throw the recording away. */
  cancel(): void {
    clearInterval(this.timer);
    if (this.recorder) {
      this.recorder.onstop = () => this.recorder?.stream.getTracks().forEach((t) => t.stop());
      if (this.recorder.state === 'recording') this.recorder.stop();
    }
    this.recorder = null;
    this.state.set('idle');
    this.resolve('');
  }

  private async transcribe(audio: Blob): Promise<void> {
    this.recorder = null;
    this.state.set('transcribing');
    let text = '';
    try {
      text = (await this.api.stt(audio)).text.trim();
      if (!text) this.problem.set("I didn't catch anything. Try again, a little closer to the microphone.");
    } catch (err) {
      this.problem.set(err instanceof ApiError && err.status < 500 ? err.message : "Voice input isn't working just now. You can still type.");
    } finally {
      this.state.set('idle');
      this.resolve(text);
    }
  }

  private resolve(text: string): void {
    this.finished?.(text);
    this.finished = null;
  }
}
