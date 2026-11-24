export type Role = 'user' | 'assistant';

/** `stopped` = the user stopped generation part-way; the partial text is kept. */
export type MessageState = 'streaming' | 'done' | 'stopped' | 'error';

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  state: MessageState;
  createdAt: number;
}

export interface Voice {
  id: string;
  label: string;
  is_default: boolean;
}

export interface Health {
  status: 'ok' | 'degraded';
  /** `models`: what a client can choose right now, the default first (e.g. base and fine-tuned). */
  llm: { ok: boolean; backend: string; model: string; models?: string[]; error?: string };
  tts: { ok: boolean; engine: string; voices: number; error?: string };
  /** Voice input (optional: older backends do not report it). */
  stt?: { ok: boolean; engine: string; model?: string; error?: string };
  /** Use my voice: the voice converter (optional). */
  clone?: { ok: boolean; engine: string; error?: string };
}

/** The voice id for "my voice" (a British base voice, re-voiced to sound like the user). */
export const MY_VOICE = 'my-voice';

/** The user's voice fingerprint, kept only in this browser. */
export interface MyVoice {
  fingerprint: string;
  /** The British regional voice closest to the user's, which the converter re-voices. */
  base: string;
  seconds: number;
  createdAt: number;
}

/** Rolling note of the oldest `turns` turns, which no longer fit the model's context window. */
export interface Memory {
  note: string;
  turns: number;
}

/** Events produced by POST /api/chat/stream (see backend/app/api/chat.py). */
export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; text: string; truncated: boolean; model: string; turnsDropped: number }
  | { type: 'error'; code: string; message: string };

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type Expression = 'neutral' | 'happy' | 'concerned';

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
