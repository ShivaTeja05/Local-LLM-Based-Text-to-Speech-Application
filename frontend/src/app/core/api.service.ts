import { Injectable } from '@angular/core';

import { ChatEvent, ChatMessage, Health, Memory, Voice } from './models';
import { SseParser } from './sse-parser';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Where the backend is. Empty (the default) means the same site, as in development (the dev server
 * proxies /api) or when the backend serves the app. A separately hosted frontend (e.g. on Vercel)
 * sets it in config.js, which is written at build time: window.ELLIE_API_BASE = 'https://…'.
 */
const API = ((globalThis as { ELLIE_API_BASE?: string }).ELLIE_API_BASE ?? '').replace(/\/$/, '');

/** Thin client for the FastAPI backend. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  async health(signal?: AbortSignal): Promise<Health> {
    return this.json<Health>(await fetch(API + '/api/health', { signal }));
  }

  async voices(): Promise<Voice[]> {
    return this.json<Voice[]>(await fetch(API + '/api/voices'));
  }

  /** WAV bytes for one piece of text. */
  async tts(text: string, voice: string | null, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await fetch(API + '/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voice ? { text, voice } : { text }),
      signal,
    });
    if (!res.ok) throw new ApiError(await detail(res), res.status);
    return res.arrayBuffer();
  }

  /** Streams the reply. Sends the whole transcript; the backend trims it (ARCHITECTURE.md §4). */
  async *streamChat(
    history: Pick<ChatMessage, 'role' | 'text'>[],
    signal: AbortSignal,
    memory?: Memory,
    model?: string | null,
  ): AsyncGenerator<ChatEvent> {
    const res = await fetch(API + '/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages: toApi(history), ...(memory?.note ? { memory } : {}), ...(model ? { model } : {}) }),
      signal,
    });
    if (!res.ok || !res.body) throw new ApiError(await detail(res), res.status);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new SseParser();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const ev of parser.feed(value)) {
          const data = JSON.parse(ev.data);
          if (ev.event === 'token') yield { type: 'token', text: data.t };
          else if (ev.event === 'done')
            yield { type: 'done', text: data.text, truncated: data.truncated, model: data.model, turnsDropped: data.turns_dropped };
          else if (ev.event === 'error') yield { type: 'error', code: data.code, message: data.message };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Transcribe a recording with the backend's local Whisper. */
  async stt(audio: Blob): Promise<{ text: string; seconds: number }> {
    const res = await fetch(API + '/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': audio.type.split(';')[0] || 'audio/webm' },
      body: audio,
    });
    return this.json(res);
  }

  /** Fold the turns the backend dropped (up to `upto`) into the memory note. */
  async memory(history: Pick<ChatMessage, 'role' | 'text'>[], memory: Memory, upto: number): Promise<Memory> {
    const res = await fetch(API + '/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: toApi(history), memory, upto }),
    });
    return this.json<Memory>(res);
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) throw new ApiError(await detail(res), res.status);
    return res.json() as Promise<T>;
  }
}

function toApi(history: Pick<ChatMessage, 'role' | 'text'>[]) {
  return history.map((m) => ({ role: m.role, content: m.text }));
}

async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  } catch {
    /* not JSON */
  }
  return `Request failed (${res.status})`;
}
