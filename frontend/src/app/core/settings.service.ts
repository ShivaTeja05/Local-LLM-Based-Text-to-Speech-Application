import { Injectable, effect, signal } from '@angular/core';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'ellie.settings.v1';

interface Stored {
  speechEnabled: boolean;
  voiceId: string | null;
  theme: ThemeChoice;
  model: string | null;
  naturalPauses: boolean;
}

/** Per-browser preferences, remembered in localStorage (wrapped: storage can be blocked). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly initial = load();

  readonly speechEnabled = signal<boolean>(this.initial.speechEnabled);
  /** null = the server's default voice. */
  readonly voiceId = signal<string | null>(this.initial.voiceId);
  readonly theme = signal<ThemeChoice>(this.initial.theme);
  /** null = the server's default model; otherwise one of health.llm.models (e.g. the fine-tune). */
  readonly model = signal<string | null>(this.initial.model);
  /** Pause between sentences like a person would, with a soft breath before long ones. */
  readonly naturalPauses = signal<boolean>(this.initial.naturalPauses);

  /** Back to the defaults (Your data → reset preferences). */
  reset(): void {
    const d = defaults();
    this.speechEnabled.set(d.speechEnabled);
    this.voiceId.set(d.voiceId);
    this.theme.set(d.theme);
    this.model.set(d.model);
    this.naturalPauses.set(d.naturalPauses);
  }

  constructor() {
    effect(() => {
      const value: Stored = {
        speechEnabled: this.speechEnabled(), voiceId: this.voiceId(), theme: this.theme(), model: this.model(),
        naturalPauses: this.naturalPauses(),
      };
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

function defaults(): Stored {
  return { speechEnabled: true, voiceId: null, theme: 'system', model: null, naturalPauses: true };
}

function load(): Stored {
  const defaults_ = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults_;
    const v = JSON.parse(raw) as Partial<Stored>;
    return {
      speechEnabled: typeof v.speechEnabled === 'boolean' ? v.speechEnabled : defaults_.speechEnabled,
      voiceId: typeof v.voiceId === 'string' ? v.voiceId : null,
      theme: v.theme === 'light' || v.theme === 'dark' || v.theme === 'system' ? v.theme : defaults_.theme,
      model: typeof v.model === 'string' ? v.model : null,
      naturalPauses: typeof v.naturalPauses === 'boolean' ? v.naturalPauses : defaults_.naturalPauses,
    };
  } catch {
    return defaults_;
  }
}
