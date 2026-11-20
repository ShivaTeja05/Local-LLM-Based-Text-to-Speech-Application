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
  llm: { ok: boolean; backend: string; model: string; error?: string };
  tts: { ok: boolean; engine: string; voices: number; error?: string };
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
