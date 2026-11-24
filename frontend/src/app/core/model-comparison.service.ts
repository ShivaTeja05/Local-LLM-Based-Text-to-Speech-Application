import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { ApiService } from './api.service';
import { StatusService } from './status.service';

export type ComparisonMode = 'short' | 'default';
export interface ComparisonReply {
  model: string;
  label: string;
  text: string;
  state: 'queued' | 'running' | 'done' | 'error' | 'stopped';
  firstTokenMs: number | null;
  totalMs: number | null;
  promptTokens: number | null;
  truncated: boolean;
  error: string | null;
}

const MODELS = [
  { model: 'llama3.2:3b', label: 'Standard' },
  { model: 'ellie-british', label: 'Fine-tuned v2' },
];

/** Isolated fresh conversations: comparison replies never enter the user's chat or memory. */
@Injectable()
export class ModelComparisonService {
  private readonly api = inject(ApiService);
  private readonly status = inject(StatusService);
  readonly available = computed(() => this.status.health()?.comparison?.version === 1 &&
    !!this.status.health()?.llm.ok && MODELS.every(m => this.status.models().includes(m.model)));
  readonly busy = signal(false);
  readonly prompt = signal('');
  readonly mode = signal<ComparisonMode>('short');
  readonly replies = signal<ComparisonReply[]>([]);
  private abort: AbortController | null = null;
  private runNumber = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  cancel(): void { this.abort?.abort(); }

  async run(prompt: string, mode: ComparisonMode): Promise<void> {
    const text = prompt.trim();
    if (this.busy() || !this.available() || !text || text.length > 500) return;
    const ctrl = new AbortController();
    this.abort = ctrl;
    this.busy.set(true);
    this.prompt.set(text);
    this.mode.set(mode);
    this.replies.set(MODELS.map(m => ({ ...m, text: '', state: 'queued', firstTokenMs: null,
      totalMs: null, promptTokens: null, truncated: false, error: null })));
    const n = this.runNumber++;
    const order = n % 2 ? [...MODELS].reverse() : MODELS;
    try {
      // Sequential requests avoid CPU contention. Alternate which model runs first.
      for (const { model } of order) {
        if (ctrl.signal.aborted) break;
        this.update(model, { state: 'running' });
        const started = performance.now();
        let first = true;
        let done = false;
        try {
          for await (const event of this.api.streamChat([{ role: 'user', text }], ctrl.signal,
            undefined, model, { promptStyle: mode, seed: 1000 + n })) {
            if (ctrl.signal.aborted) break;
            if (event.type === 'token') {
              const row = this.replies().find(r => r.model === model)!;
              const patch: Partial<ComparisonReply> = { text: row.text + event.text };
              if (first && event.text.trim()) {
                patch.firstTokenMs = performance.now() - started;
                first = false;
              }
              this.update(model, patch);
            } else if (event.type === 'error') {
              throw new Error(event.message);
            } else {
              if (event.model !== model) throw new Error('The server returned a different model. Please retry.');
              done = true;
              this.update(model, { text: event.text, state: 'done', totalMs: performance.now() - started,
                promptTokens: event.promptTokens ?? null, truncated: event.truncated });
            }
          }
          if (!done && !ctrl.signal.aborted) throw new Error('The reply ended before it was complete. Please retry.');
        } catch (error) {
          if (!ctrl.signal.aborted) this.update(model, { state: 'error',
            error: error instanceof Error ? error.message : 'Unable to get this reply.' });
        }
      }
    } finally {
      this.replies.update(rows => rows.map(r => r.state === 'queued' || r.state === 'running'
        ? { ...r, state: 'stopped' } : r));
      this.busy.set(false);
      this.abort = null;
    }
  }

  private update(model: string, patch: Partial<ComparisonReply>): void {
    this.replies.update(rows => rows.map(r => r.model === model ? { ...r, ...patch } : r));
  }
}
