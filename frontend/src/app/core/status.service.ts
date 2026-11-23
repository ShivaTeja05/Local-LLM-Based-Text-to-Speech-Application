import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { ApiService } from './api.service';
import { Health, Voice } from './models';
import { SettingsService } from './settings.service';

export type Connection = 'checking' | 'ok' | 'degraded' | 'offline';

/** Backend health (polled) and the installed voices. */
@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly api = inject(ApiService);
  private readonly settings = inject(SettingsService);

  readonly health = signal<Health | null>(null);
  readonly connection = signal<Connection>('checking');
  readonly voices = signal<Voice[]>([]);
  readonly checkedAt = signal<Date | null>(null);
  /** The backend is taking a while to answer: a scale-to-zero server (Cloud Run) is starting up. */
  readonly waking = signal(false);

  readonly model = computed(() => this.health()?.llm.model ?? null);
  /** Models the user can switch between (only when more than one is installed). */
  readonly models = computed(() => this.health()?.llm.models ?? []);
  readonly defaultVoice = computed(() => this.voices().find((v) => v.is_default) ?? this.voices()[0] ?? null);

  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  /** The first check waits up to 90 s: a server that scaled to zero needs time to start and load
   *  the model. Later checks give up after 5 s. */
  start(intervalMs = 15000, firstTimeoutMs = 90_000): void {
    void this.refresh(firstTimeoutMs);
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  async refresh(timeoutMs = 5000): Promise<void> {
    if (this.inFlight) return; // a slow first check (waking server) is still running
    this.inFlight = true;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    const slow = setTimeout(() => this.waking.set(true), 3000);
    try {
      const h = await this.api.health(ctrl.signal);
      this.health.set(h);
      this.connection.set(h.status === 'ok' ? 'ok' : 'degraded');
      if (!this.voices().length && h.tts.ok) {
        const voices = await this.api.voices();
        this.voices.set(voices);
        // A voice remembered from an earlier version may no longer be offered: use the default.
        const chosen = this.settings.voiceId();
        if (chosen && !voices.some((v) => v.id === chosen)) this.settings.voiceId.set(null);
      }
    } catch {
      this.connection.set('offline');
    } finally {
      clearTimeout(timeout);
      clearTimeout(slow);
      this.waking.set(false);
      this.inFlight = false;
      this.checkedAt.set(new Date());
    }
  }

  voiceLabel(id: string | null): string {
    const v = id ? this.voices().find((x) => x.id === id) : this.defaultVoice();
    return v ? shortName(v.label) : 'the default';
  }
}

/** "Newcastle (North · female)" → "Newcastle". */
export function shortName(label: string): string {
  return label.split(' (')[0];
}
