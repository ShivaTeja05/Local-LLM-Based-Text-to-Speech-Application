import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';

import { AudioPlayerService } from './core/audio-player.service';
import { ConversationService } from './core/conversation.service';
import { expressionFor } from './core/expression';
import { AvatarState } from './core/models';
import { SettingsService } from './core/settings.service';
import { StatusService } from './core/status.service';
import { Avatar } from './ui/avatar';
import { Conversation } from './ui/conversation';
import { Icon } from './ui/icon';
import { SettingsPanel } from './ui/settings-panel';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Conversation, Icon, SettingsPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly chat = inject(ConversationService);
  protected readonly player = inject(AudioPlayerService);
  protected readonly settings = inject(SettingsService);
  protected readonly status = inject(StatusService);

  private readonly sheet = viewChild.required<ElementRef<HTMLDialogElement>>('sheet');
  protected readonly drafting = signal(false);
  /** The phone sheet's contents exist only while it is open (one settings panel in the DOM). */
  protected readonly sheetOpen = signal(false);
  private readonly now = signal(new Date());

  protected readonly greeting = computed(() => {
    const h = this.now().getHours();
    return h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
  });

  /** The screen's one fact: what Ellie is running on right now, from the live health check. */
  protected readonly subline = computed(() => {
    const h = this.status.health();
    switch (this.status.connection()) {
      case 'checking':
        return 'Connecting to the local model…';
      case 'offline':
        return "Ellie can't reach her backend. Start it on port 8000, then try again.";
      case 'degraded':
        return h?.llm.ok
          ? `Ellie can write with ${h.llm.model}, but speech is unavailable.`
          : "Ellie's language model isn't available right now.";
      default:
        return `Ellie runs on this computer, with ${h?.llm.model} and the ${this.status.voiceLabel(this.settings.voiceId())} voice.`;
    }
  });

  protected readonly avatarState = computed<AvatarState>(() => {
    if (this.player.sounding()) return 'speaking';
    if (this.chat.generating() || this.player.isSpeaking() || this.chat.preparingId()) return 'thinking';
    if (this.chat.lastAssistant()?.state === 'error') return 'error';
    if (this.drafting()) return 'listening';
    return 'idle';
  });

  protected readonly expression = computed(() =>
    this.avatarState() === 'error' ? 'concerned' : expressionFor(this.chat.lastAssistant()?.text),
  );

  protected readonly stageLine = computed(() => {
    switch (this.avatarState()) {
      case 'speaking': return 'Speaking';
      case 'thinking': return this.chat.generating() ? 'Thinking…' : 'Getting ready to speak…';
      case 'listening': return 'Listening';
      case 'error': return 'Something went wrong';
      default: return this.settings.speechEnabled() ? 'Ready when you are' : 'Ready · speech is off';
    }
  });

  constructor() {
    this.status.start();
    const clock = setInterval(() => this.now.set(new Date()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(clock));
  }

  protected toggleSpeech(): void {
    const on = !this.settings.speechEnabled();
    this.settings.speechEnabled.set(on);
    if (!on) this.player.stop();
  }

  protected openSheet(): void {
    this.sheetOpen.set(true);
    this.sheet().nativeElement.showModal();
  }

  protected closeSheet(): void {
    this.sheet().nativeElement.close();
  }

  protected onSheetClick(event: MouseEvent): void {
    if (event.target === this.sheet().nativeElement) this.closeSheet(); // click on the backdrop
  }
}
