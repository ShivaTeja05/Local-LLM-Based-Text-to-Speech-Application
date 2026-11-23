import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { AudioPlayerService } from '../core/audio-player.service';
import { ConversationService, MAX_CHARS } from '../core/conversation.service';
import { SettingsService } from '../core/settings.service';
import { StatusService } from '../core/status.service';
import { VoiceInputService } from '../core/voice-input.service';
import { Icon } from './icon';

export const STARTERS = [
  'How are you?',
  "What's a nice way to spend a rainy Sunday?",
  'Tell me something about Lancaster.',
  'Which British pudding should I try?',
];

@Component({
  selector: 'app-conversation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './conversation.html',
  styleUrl: './conversation.scss',
})
export class Conversation {
  protected readonly chat = inject(ConversationService);
  protected readonly player = inject(AudioPlayerService);
  protected readonly settings = inject(SettingsService);
  protected readonly status = inject(StatusService);
  protected readonly voice = inject(VoiceInputService);

  /** True while the user has a draft in the composer (the avatar listens). */
  readonly drafting = output<boolean>();

  protected readonly starters = STARTERS;
  protected readonly max = MAX_CHARS;
  protected readonly draft = signal('');
  protected readonly remaining = computed(() => this.max - this.draft().length);
  protected readonly canSend = computed(() => this.draft().trim().length > 0 && !this.chat.generating());

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');
  private stickToBottom = true;

  constructor() {
    // Follow the reply as it streams, unless the user has scrolled up to read.
    afterRenderEffect(() => {
      this.chat.messages();
      const el = this.scroller().nativeElement;
      if (this.stickToBottom) el.scrollTop = el.scrollHeight;
    });
  }

  protected onScroll(): void {
    const el = this.scroller().nativeElement;
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  protected onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    this.drafting.emit(el.value.trim().length > 0);
    this.autosize(el);
  }

  /** 🎤: first click records, second click transcribes into the box (the user then sends). */
  protected async toggleMic(): Promise<void> {
    if (this.voice.state() === 'recording') {
      this.voice.stop();
      return;
    }
    const text = await this.voice.start();
    if (!text) return;
    const el = this.field().nativeElement;
    const joined = [el.value.trim(), text].filter(Boolean).join(' ').slice(0, this.max);
    el.value = joined;
    this.draft.set(joined);
    this.drafting.emit(true);
    this.autosize(el);
    el.focus();
    el.setSelectionRange(joined.length, joined.length);
  }

  protected micLabel(): string {
    switch (this.voice.state()) {
      case 'recording': return 'Stop recording and write it down';
      case 'transcribing': return 'Writing down what you said';
      default: return 'Talk to Ellie';
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.voice.state() === 'recording') {
      event.preventDefault();
      this.voice.cancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  protected submit(text = this.draft()): void {
    if (!text.trim() || this.chat.generating()) return;
    this.stickToBottom = true;
    void this.chat.send(text);
    this.draft.set('');
    this.drafting.emit(false);
    const el = this.field().nativeElement;
    el.value = '';
    this.autosize(el);
    el.focus();
  }

  protected playLabel(id: string): string {
    return this.player.speakingId() === id ? 'Stop' : 'Play';
  }

  private autosize(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }
}
