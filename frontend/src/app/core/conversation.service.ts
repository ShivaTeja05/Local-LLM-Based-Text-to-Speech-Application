import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiService } from './api.service';
import { AudioPlayerService } from './audio-player.service';
import { ChatMessage, newId } from './models';
import { SentenceSplitter, splitSentences } from './sentence-splitter';
import { SettingsService } from './settings.service';

const STORE_KEY = 'ellie.conversation.v1';
export const MAX_CHARS = 500; // matches the backend's MAX_USER_CHARS
export const OFFLINE_REPLY = "Sorry, I can't reach my brain just now. Is the backend running? Do try again in a moment.";

/**
 * One conversation: sends the transcript, streams Ellie's reply into the list, and speaks it
 * sentence by sentence while it is still being written. Speech for each reply is cached per
 * voice, so ▶ replay plays instantly and makes no new requests.
 */
@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly api = inject(ApiService);
  private readonly player = inject(AudioPlayerService);
  private readonly settings = inject(SettingsService);

  readonly messages = signal<ChatMessage[]>(restore());
  /** True while a reply is being generated. */
  readonly generating = signal(false);
  /** Id of the reply whose speech is being prepared for replay. */
  readonly preparingId = signal<string | null>(null);
  readonly lastAssistant = computed(() => [...this.messages()].reverse().find((m) => m.role === 'assistant') ?? null);

  private abort: AbortController | null = null;
  private readonly audio = new Map<string, Promise<ArrayBuffer>[]>();

  async send(raw: string): Promise<void> {
    const text = raw.trim().slice(0, MAX_CHARS);
    if (!text || this.generating()) return;

    this.player.resumeAudio(); // inside the user's gesture, before any await
    this.player.stop();

    const user: ChatMessage = { id: newId(), role: 'user', text, state: 'done', createdAt: Date.now() };
    const reply: ChatMessage = { id: newId(), role: 'assistant', text: '', state: 'streaming', createdAt: Date.now() };
    const history = [...this.messages().filter(isContext), user];
    this.messages.update((list) => [...list, user, reply]);

    const speak = this.settings.speechEnabled();
    const voice = this.settings.voiceId();
    const clips: Promise<ArrayBuffer>[] = [];
    const splitter = new SentenceSplitter();
    let spoken = 0;
    const say = (sentence: string) => {
      if (!this.settings.speechEnabled()) return; // switched off mid-reply
      const clip = this.api.tts(sentence, voice);
      clip.catch(() => undefined);
      clips.push(clip);
      spoken++;
      this.player.enqueue(reply.id, clip);
    };
    if (speak) this.player.begin(reply.id);

    this.abort = new AbortController();
    this.generating.set(true);
    let streamed = '';
    try {
      for await (const ev of this.api.streamChat(history, this.abort.signal)) {
        if (ev.type === 'token') {
          streamed += ev.text;
          this.patch(reply.id, { text: streamed });
          if (speak) splitter.push(ev.text).forEach(say);
        } else if (ev.type === 'done') {
          this.patch(reply.id, { text: ev.text, state: 'done' });
          // Speak what is left of the *final* text (the server may trim a cut-off ending).
          if (speak) splitSentences(ev.text).slice(spoken).forEach(say);
        } else {
          this.patch(reply.id, { text: ev.message, state: 'error' });
          this.player.stop();
        }
      }
      if (this.find(reply.id)?.state === 'streaming') this.patch(reply.id, { state: 'done' });
    } catch (err) {
      if (this.abort?.signal.aborted) {
        this.patch(reply.id, { text: streamed.trim(), state: 'stopped' });
      } else {
        console.warn('Chat request failed', err);
        this.patch(reply.id, { text: OFFLINE_REPLY, state: 'error' });
        this.player.stop();
      }
    } finally {
      this.generating.set(false);
      this.abort = null;
      this.player.end(reply.id);
      // Cache only a complete set: not if speech was switched off part-way through.
      const complete = speak && this.settings.speechEnabled() && this.find(reply.id)?.state === 'done';
      if (complete && clips.length) this.audio.set(key(reply.id, voice), clips);
      this.persist();
    }
  }

  /** Stop generating (keeps the partial reply) and stop speaking. */
  stopGenerating(): void {
    this.abort?.abort();
    this.player.stop();
  }

  /** ▶ on a reply: replay its cached speech, or synthesise it now with the current voice. */
  togglePlay(id: string): void {
    this.player.resumeAudio();
    if (this.player.speakingId() === id) {
      this.player.stop();
      return;
    }
    const msg = this.find(id);
    if (!msg || msg.role !== 'assistant' || !msg.text) return;
    const voice = this.settings.voiceId();
    let clips = this.audio.get(key(id, voice));
    if (!clips) {
      clips = splitSentences(msg.text).map((s) => this.api.tts(s, voice));
      clips.forEach((c) => c.catch(() => undefined));
      this.audio.set(key(id, voice), clips);
      // A failed synthesis must not stay cached.
      Promise.all(clips).catch(() => this.audio.delete(key(id, voice)));
    }
    this.player.play(id, clips);
  }

  /** Run the last user message again after an error. */
  retry(replyId: string): void {
    const list = this.messages();
    const i = list.findIndex((m) => m.id === replyId);
    const prompt = list[i - 1];
    if (i < 1 || prompt.role !== 'user') return;
    this.messages.set(list.slice(0, i - 1));
    void this.send(prompt.text);
  }

  reset(): void {
    this.abort?.abort();
    this.player.stop();
    this.audio.clear();
    this.messages.set([]);
    this.persist();
  }

  private find(id: string): ChatMessage | undefined {
    return this.messages().find((m) => m.id === id);
  }

  private patch(id: string, changes: Partial<ChatMessage>): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? { ...m, ...changes } : m)));
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(this.messages()));
    } catch {
      /* storage unavailable */
    }
  }
}

/** Messages the LLM should see: user turns and finished (or stopped) replies, never errors. */
function isContext(m: ChatMessage): boolean {
  return m.role === 'user' || ((m.state === 'done' || m.state === 'stopped') && m.text.length > 0);
}

function key(id: string, voice: string | null): string {
  return `${id}|${voice ?? 'default'}`;
}

function restore(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return list
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map((m) => (m.state === 'streaming' ? { ...m, state: 'stopped' as const } : m));
  } catch {
    return [];
  }
}
