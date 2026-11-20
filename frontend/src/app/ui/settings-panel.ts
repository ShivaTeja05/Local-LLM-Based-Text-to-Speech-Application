import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';

import { ApiService } from '../core/api.service';
import { AudioPlayerService } from '../core/audio-player.service';
import { ConversationService } from '../core/conversation.service';
import { SettingsService, ThemeChoice } from '../core/settings.service';
import { StatusService, shortName } from '../core/status.service';
import { Icon } from './icon';

let nextUid = 0;

@Component({
  selector: 'app-settings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.scss',
})
export class SettingsPanel {
  protected readonly settings = inject(SettingsService);
  protected readonly status = inject(StatusService);
  protected readonly player = inject(AudioPlayerService);
  private readonly conversation = inject(ConversationService);
  private readonly api = inject(ApiService);

  /** Emitted after an action that should close the phone sheet. */
  readonly done = output<void>();

  /** Unique per instance, so heading ids never collide (sidebar + phone sheet). */
  protected readonly uid = `sp${nextUid++}`;

  protected readonly themes: { id: ThemeChoice; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];

  protected readonly selectedVoice = computed(() => this.settings.voiceId() ?? this.status.defaultVoice()?.id ?? null);

  protected readonly statusLine = computed(() => {
    switch (this.status.connection()) {
      case 'ok': return 'Running locally';
      case 'degraded': return this.status.health()?.llm.ok ? 'Speech unavailable' : 'Model unavailable';
      case 'offline': return 'Backend offline';
      default: return 'Connecting…';
    }
  });

  protected readonly statusDetail = computed(() => {
    const h = this.status.health();
    if (this.status.connection() === 'offline') return 'Start the backend on port 8000';
    if (!h) return '';
    if (!h.llm.ok) return h.llm.error ?? `${h.llm.model} is not loaded`;
    if (!h.tts.ok) return h.tts.error ?? 'No voice installed';
    return `${h.llm.model} · ${h.tts.engine} · ${h.tts.voices} voices`;
  });

  protected newConversation(): void {
    this.conversation.reset();
    this.done.emit();
  }

  protected chooseVoice(id: string): void {
    this.settings.voiceId.set(id);
  }

  protected toggleSpeech(): void {
    const on = !this.settings.speechEnabled();
    this.settings.speechEnabled.set(on);
    if (!on) this.player.stop();
  }

  /** ▶ beside a voice: a short sample in that voice. */
  protected preview(id: string, label: string, event: Event): void {
    event.stopPropagation();
    this.player.resumeAudio();
    const previewId = `preview:${id}`;
    if (this.player.speakingId() === previewId) {
      this.player.stop();
      return;
    }
    const clip = this.api.tts(`Hello, I'm ${shortName(label)}. Lovely to meet you.`, id);
    this.player.play(previewId, [clip]);
  }

  protected name(label: string): string {
    return shortName(label);
  }

  protected accent(label: string): string {
    const m = /\((.*)\)/.exec(label);
    return m ? m[1] : '';
  }
}
