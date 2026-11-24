import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';

import { AudioPlayerService } from './core/audio-player.service';
import { ConversationService } from './core/conversation.service';
import { expressionFor } from './core/expression';
import { AvatarState, MY_VOICE } from './core/models';
import { MyVoiceService } from './core/my-voice.service';
import { SettingsService } from './core/settings.service';
import { StatusService } from './core/status.service';
import { VoiceInputService } from './core/voice-input.service';
import { Avatar } from './ui/avatar';
import { handFor } from './ui/gesture';
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
  protected readonly voice = inject(VoiceInputService);
  private readonly myVoice = inject(MyVoiceService);

  private readonly sheet = viewChild.required<ElementRef<HTMLDialogElement>>('sheet');
  protected readonly drafting = signal(false);
  /** The voice in use, so the avatar can show its character. */
  protected readonly voiceId = computed(() => {
    const id = this.settings.voiceId() ?? this.status.defaultVoice()?.id ?? null;
    return id === MY_VOICE ? (this.myVoice.voice()?.base ?? null) : id; // my voice: the base voice's character
  });
  /** Cues a hello wave: when Ellie is ready, on her first reply, and on New conversation. */
  private readonly hello = signal(0);
  protected readonly waveCue = computed(() => this.hello() + this.chat.fresh());
  private greetedReady = false;
  private greetedReply: string | null = null;
  private readonly greetWhenReady = effect(() => {
    if (this.status.connection() !== 'ok' || this.greetedReady) return;
    this.greetedReady = true;
    setTimeout(() => this.hello.update((n) => n + 1), 400);
  });
  private readonly greetOnFirstReply = effect(() => {
    const sentence = this.player.sentence();
    const id = sentence && this.player.speakingId();
    if (!id) return;
    untracked(() => {
      const first = this.chat.messages().find((m) => m.role === 'assistant');
      if (first?.id === id && this.greetedReply !== id) {
        this.greetedReply = id;
        // Only if her first sentence has no gesture of its own (a thumbs up, a question's open palm...).
        if (!handFor(sentence.text, sentence.n)) this.hello.update((n) => n + 1);
      }
    });
  });
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
        return this.status.waking()
          ? 'Waking Ellie up… after a quiet spell, the first visit takes up to a minute.'
          : 'Connecting to the local model…';
      case 'offline':
        return "Ellie can't reach her backend just now. Please try again in a minute.";
      case 'degraded':
        return h?.llm.ok
          ? `Ellie can write with ${h.llm.model}, but speech is unavailable.`
          : "Ellie's language model isn't available right now.";
      default:
        return this.settings.voiceId() === MY_VOICE
          ? `Ellie runs privately, with ${h?.llm.model}, speaking British English in your own voice.`
          : `Ellie runs privately, with ${h?.llm.model} and the ${this.status.voiceLabel(this.settings.voiceId())} voice, with no cloud AI services.`;
    }
  });

  protected readonly avatarState = computed<AvatarState>(() => {
    if (this.voice.state() === 'recording') return 'listening';
    if (this.player.sounding()) return 'speaking';
    if (this.chat.generating() || this.player.isSpeaking() || this.chat.preparingId()) return 'thinking';
    if (this.chat.lastAssistant()?.state === 'error') return 'error';
    if (this.voice.state() === 'transcribing') return 'thinking';
    if (this.drafting()) return 'listening';
    return 'idle';
  });

  protected readonly expression = computed(() =>
    this.avatarState() === 'error' ? 'concerned' : expressionFor(this.chat.lastAssistant()?.text),
  );

  protected readonly stageLine = computed(() => {
    switch (this.avatarState()) {
      case 'speaking': return 'Speaking';
      case 'thinking':
        if (this.voice.state() === 'transcribing') return 'Writing down what you said…';
        return this.chat.generating() ? 'Thinking…' : 'Getting ready to speak…';
      case 'listening': return this.voice.state() === 'recording' ? 'Listening to you…' : 'Listening';
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
