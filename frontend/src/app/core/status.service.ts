import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { ApiService } from './api.service';
import { Health, Voice } from './models';

export type Connection = 'checking' | 'ok' | 'degraded' | 'offline';

/** Backend health (polled) and the installed voices. */
@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly api = inject(ApiService);

  readonly health = signal<Health | null>(null);
  readonly connection = signal<Connection>('checking');
  readonly voices = signal<Voice[]>([]);
  readonly checkedAt = signal<Date | null>(null);

  readonly model = computed(() => this.health()?.llm.model ?? null);
  readonly defaultVoice = computed(() => this.voices().find((v) => v.is_default) ?? this.voices()[0] ?? null);

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  start(intervalMs = 15000): void {
    void this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  async refresh(): Promise<void> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    try {
      const h = await this.api.health(ctrl.signal);
      this.health.set(h);
      this.connection.set(h.status === 'ok' ? 'ok' : 'degraded');
      if (!this.voices().length && h.tts.ok) this.voices.set(await this.api.voices());
    } catch {
      this.connection.set('offline');
    } finally {
      clearTimeout(timeout);
      this.checkedAt.set(new Date());
    }
  }

  voiceLabel(id: string | null): string {
    const v = id ? this.voices().find((x) => x.id === id) : this.defaultVoice();
    return v ? shortName(v.label) : 'the default';
  }
}

/** "Cori (female, southern English)" → "Cori". */
export function shortName(label: string): string {
  return label.split(' (')[0];
}
