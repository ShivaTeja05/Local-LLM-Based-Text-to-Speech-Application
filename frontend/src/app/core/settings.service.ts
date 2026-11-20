import { Injectable, effect, signal } from '@angular/core';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'ellie.settings.v1';

interface Stored {
  speechEnabled: boolean;
  voiceId: string | null;
  theme: ThemeChoice;
}

/** Per-browser preferences, remembered in localStorage (wrapped: storage can be blocked). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly initial = load();

  readonly speechEnabled = signal<boolean>(this.initial.speechEnabled);
  /** null = the server's default voice. */
  readonly voiceId = signal<string | null>(this.initial.voiceId);
  readonly theme = signal<ThemeChoice>(this.initial.theme);

  constructor() {
    effect(() => {
      const value: Stored = { speechEnabled: this.speechEnabled(), voiceId: this.voiceId(), theme: this.theme() };
      try {
        localStorage.setItem(KEY, JSON.stringify(value));
      } catch {
        /* private mode: settings last for this visit only */
      }
    });
    effect(() => {
      const theme = this.theme();
      const root = document.documentElement;
      if (theme === 'system') delete root.dataset['theme'];
      else root.dataset['theme'] = theme;
    });
  }
}

function load(): Stored {
  const defaults: Stored = { speechEnabled: true, voiceId: null, theme: 'system' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const v = JSON.parse(raw) as Partial<Stored>;
    return {
      speechEnabled: typeof v.speechEnabled === 'boolean' ? v.speechEnabled : defaults.speechEnabled,
      voiceId: typeof v.voiceId === 'string' ? v.voiceId : null,
      theme: v.theme === 'light' || v.theme === 'dark' || v.theme === 'system' ? v.theme : defaults.theme,
    };
  } catch {
    return defaults;
  }
}
