import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, ApiService } from './api.service';
import { AudioPlayerService, Clip } from './audio-player.service';
import { ChatMessage, Memory, newId, MY_VOICE } from './models';
import { LocalDbService } from './local-db.service';
import { MyVoiceService } from './my-voice.service';
import { SentenceSplitter, splitSentences } from './sentence-splitter';
import { SettingsService } from './settings.service';
import { StatusService } from './status.service';

const NO_MEMORY: Memory = { note: '', turns: 0 };
export const MAX_CHARS = 500; // matches the backend's MAX_USER_CHARS
export const BUSY_REPLY = "You're sending messages a little quickly for me. Give me a few seconds, then try again.";
export const OFFLINE_REPLY = "Sorry, I can't reach my brain just now. Is the backend running? Do try again in a moment.";

/**
 * One conversation: sends the transcript, streams Ellie's reply into the list, and speaks it
 * sentence by sentence while it is still being written. Speech for each reply is cached per
 * voice, so ▶ replay plays instantly and makes no new requests.
 */
@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly api = inject(ApiService);
  private readonly myVoice = inject(MyVoiceService);
  private readonly player = inject(AudioPlayerService);
  private readonly settings = inject(SettingsService);
  private readonly status = inject(StatusService);

  private readonly db = inject(LocalDbService);

  /** The conversation, kept in the local database in this browser (LocalDbService). */
  readonly messages = signal<ChatMessage[]>([]);
  /** Rolling note of turns the model can no longer see (kept here: the backend is stateless). */
  readonly memory = signal<Memory>(NO_MEMORY);
  /** Resolves once the saved conversation (if any) has been read back. */
  readonly loaded: Promise<void> = this.load();
  /** Counts fresh starts (New conversation), so the avatar can wave hello. */
  readonly fresh = signal(0);
  /** The message the user has just sent (`n` counts up), so the avatar can react to it. */
  readonly lastSent = signal<{ text: string; n: number } | null>(null);
  /** True while a reply is being generated. */
  readonly generating = signal(false);
  /** Id of the reply whose speech is being prepared for replay. */
  readonly preparingId = signal<string | null>(null);
  readonly lastAssistant = computed(() => [...this.messages()].reverse().find((m) => m.role === 'assistant') ?? null);

  private abort: AbortController | null = null;
  private readonly audio = new Map<string, Clip[]>();

  async send(raw: string): Promise<void> {
    const text = raw.trim().slice(0, MAX_CHARS);
    if (!text || this.generating()) return;

    this.player.resumeAudio(); // inside the user's gesture, before any await
    this.player.stop();

    this.lastSent.update((last) => ({ text, n: (last?.n ?? 0) + 1 }));

    const user: ChatMessage = { id: newId(), role: 'user', text, state: 'done', createdAt: Date.now() };
    const reply: ChatMessage = { id: newId(), role: 'assistant', text: '', state: 'streaming', createdAt: Date.now() };
    const history = [...this.messages().filter(isContext), user];
    this.messages.update((list) => [...list, user, reply]);

    const speak = this.settings.speechEnabled();
    const voice = this.settings.voiceId();
    const clips: Clip[] = [];
    // Start speaking after the first few words; after that, whole sentences (short pieces throughout
    // for "my voice", which takes longer to make, so it never falls behind).
    const splitter = new SentenceSplitter({ earlyStart: true, shortPieces: voice === MY_VOICE });
    // Speech is requested one piece at a time, in the order it will be heard. Sent all at once, the
    // pieces competed for the server's CPU, and the one needed next could take 8 s instead of 1 s.
    let queue: Promise<unknown> = Promise.resolve();
    const say = (sentence: string) => {
      if (!this.settings.speechEnabled()) return; // switched off mid-reply
      const audio = queue.then(() => this.myVoice.tts(sentence, voice));
      queue = audio.catch(() => undefined);
      const clip: Clip = { audio, text: sentence };
      clip.audio.catch(() => undefined);
      clips.push(clip);
      this.player.enqueue(reply.id, clip);
    };
    if (speak) this.player.begin(reply.id);

    this.abort = new AbortController();
    this.generating.set(true);
    let streamed = '';
    try {
      for await (const ev of this.api.streamChat(history, this.abort.signal, this.memory(), this.modelFor())) {
        if (ev.type === 'token') {
          streamed += ev.text;
          this.patch(reply.id, { text: streamed });
          if (speak) splitter.push(ev.text).forEach(say);
        } else if (ev.type === 'done') {
          this.patch(reply.id, { text: ev.text, state: 'done' });
          if (ev.turnsDropped > this.memory().turns) void this.remember(history, ev.turnsDropped);
          // Speak what is left of the *final* text (the server may trim a cut-off ending): normally
          // the splitter's remainder; if the text changed, whatever follows what was already said.
          if (speak) {
            const said = streamed.slice(0, splitter.consumed);
            if (ev.text.trim() === streamed.trim()) splitter.flush().forEach(say);
            else if (ev.text.startsWith(said)) splitSentences(ev.text.slice(said.length)).forEach(say);
          }
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
        // Rate limited (429) or busy (503): say so, rather than "can't reach my brain".
        const limited = err instanceof ApiError && (err.status === 429 || err.status === 503);
        this.patch(reply.id, { text: limited ? BUSY_REPLY : OFFLINE_REPLY, state: 'error' });
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

  /** The chosen model if the server still offers it, else the server's default (null). */
  private modelFor(): string | null {
    const chosen = this.settings.model();
    return chosen && (this.status.health()?.llm.models ?? []).includes(chosen) ? chosen : null;
  }

  /** In the background: fold the turns the backend has started dropping into the note. */
  private async remember(history: Pick<ChatMessage, 'role' | 'text'>[], upto: number): Promise<void> {
    const before = this.memory();
    try {
      const next = await this.api.memory(history, before, upto);
      if (this.memory() === before) this.memory.set(next); // not reset meanwhile
      this.persist();
    } catch (err) {
      console.warn('Memory update failed; will retry after the next reply', err);
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
      clips = splitSentences(msg.text).map((s) => ({ audio: this.myVoice.tts(s, voice), text: s }));
      clips.forEach((c) => c.audio.catch(() => undefined));
      this.audio.set(key(id, voice), clips);
      // A failed synthesis must not stay cached.
      Promise.all(clips.map((c) => c.audio)).catch(() => this.audio.delete(key(id, voice)));
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

  /** Start again: the conversation and its memory note are deleted from the local database. */
  reset(): void {
    this.abort?.abort();
    this.player.stop();
    this.audio.clear();
    this.messages.set([]);
    this.memory.set(NO_MEMORY);
    this.persist();
    this.fresh.update((n) => n + 1);
  }

  private find(id: string): ChatMessage | undefined {
    return this.messages().find((m) => m.id === id);
  }

  private patch(id: string, changes: Partial<ChatMessage>): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? { ...m, ...changes } : m)));
  }

  /** Save to the local database; an empty conversation (or memory note) is deleted, not stored. */
  private persist(): void {
    const messages = this.messages();
    const memory = this.memory();
    void (messages.length ? this.db.put('conversation', messages) : this.db.delete('conversation'));
    void (memory.note ? this.db.put('memory', memory) : this.db.delete('memory'));
  }

  private async load(): Promise<void> {
    const [messages, memory] = await Promise.all([this.db.get<ChatMessage[]>('conversation'), this.db.get<Memory>('memory')]);
    if (this.messages().length) return; // the user started typing before it loaded: keep theirs
    this.messages.set(cleanMessages(messages));
    this.memory.set(cleanMemory(memory));
  }
}

/** Messages the LLM should see: user turns and finished (or stopped) replies, never errors. */
function isContext(m: ChatMessage): boolean {
  return m.role === 'user' || ((m.state === 'done' || m.state === 'stopped') && m.text.length > 0);
}

function key(id: string, voice: string | null): string {
  return `${id}|${voice ?? 'default'}`;
}

/** A saved conversation, checked: only well-formed messages; one cut off mid-reply counts as stopped. */
function cleanMessages(list: unknown): ChatMessage[] {
  if (!Array.isArray(list)) return [];
  return (list as ChatMessage[])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map((m) => (m.state === 'streaming' ? { ...m, state: 'stopped' as const } : m));
}

function cleanMemory(m: Memory | null): Memory {
  return m && typeof m.note === 'string' && Number.isInteger(m.turns) ? m : NO_MEMORY;
}
