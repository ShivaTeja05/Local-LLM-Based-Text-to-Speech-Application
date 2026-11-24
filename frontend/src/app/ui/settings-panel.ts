import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, output, signal, viewChild,
} from '@angular/core';

import { ApiService } from '../core/api.service';
import { AudioPlayerService } from '../core/audio-player.service';
import { ConversationService } from '../core/conversation.service';
import { LocalDbService, RETENTION_DAYS } from '../core/local-db.service';
import { ChatMessage, MY_VOICE, MyVoice } from '../core/models';
import { MyVoiceService, PASSAGE } from '../core/my-voice.service';
import { SettingsService, ThemeChoice } from '../core/settings.service';
import { StatusService, shortName } from '../core/status.service';
import { Avatar } from './avatar';
import { Icon } from './icon';

let nextUid = 0;

@Component({
  selector: 'app-settings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Icon],
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.scss',
})
export class SettingsPanel {
  protected readonly settings = inject(SettingsService);
  protected readonly status = inject(StatusService);
  protected readonly player = inject(AudioPlayerService);
  private readonly conversation = inject(ConversationService);
  private readonly api = inject(ApiService);
  protected readonly myVoice = inject(MyVoiceService);
  protected readonly MY_VOICE = MY_VOICE;
  protected readonly passage = PASSAGE;
  protected readonly consent = signal(false);
  private readonly recorder = viewChild.required<ElementRef<HTMLDialogElement>>('recorder');
  private readonly dataDialog = viewChild.required<ElementRef<HTMLDialogElement>>('data');
  private readonly db = inject(LocalDbService);
  protected readonly retentionDays = RETENTION_DAYS;
  protected readonly confirmAll = signal(false);
  protected readonly storageLabel = computed(() => ({
    indexeddb: "this browser's built-in database (IndexedDB)",
    localstorage: "this browser's local storage",
    none: 'nothing: storage is blocked, so everything is forgotten when you close the tab',
  })[this.db.backend()]);

  /** One row per thing stored, each with its own delete (Your data panel). */
  protected readonly dataRows = computed(() => {
    const rows: { id: string; name: string; detail: string; action: string; run: () => void }[] = [];
    const records = new Map(this.db.records().map((r) => [r.key, r]));
    const chat = records.get('conversation');
    if (chat) {
      const n = (chat.value as ChatMessage[]).length;
      const note = records.has('memory') ? ', with a memory note of the earlier part' : '';
      rows.push({ id: 'chat', name: 'Conversation', detail: `${n} messages${note} · saved ${ago(chat.updatedAt)}`,
        action: 'Delete', run: () => this.conversation.reset() });
    }
    const voice = records.get('my-voice');
    if (voice) {
      rows.push({ id: 'voice', name: 'My voice',
        detail: `A voice fingerprint (256 numbers), made ${ago((voice.value as MyVoice).createdAt)}. Your recording was not kept.`,
        action: 'Delete', run: () => this.myVoice.remove() });
    }
    rows.push({ id: 'prefs', name: 'Preferences', detail: 'Voice, theme and speech switches', action: 'Reset',
      run: () => this.settings.reset() });
    return rows;
  });
  protected readonly clock = computed(() => {
    const s = this.myVoice.seconds();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  constructor() {
    // Close the recorder once the new voice is ready (it is then selected).
    effect(() => {
      if (this.myVoice.voice() && this.myVoice.state() === 'idle') this.recorder().nativeElement.close();
    });
  }

  protected openData(): void {
    this.confirmAll.set(false);
    void this.db.refresh();
    this.dataDialog().nativeElement.showModal();
  }

  protected closeData(): void {
    this.dataDialog().nativeElement.close();
  }

  /** Two clicks, so it can't happen by accident. */
  protected deleteEverything(): void {
    if (!this.confirmAll()) return this.confirmAll.set(true);
    this.conversation.reset();
    this.myVoice.remove();
    this.settings.reset();
    void this.db.clear();
    this.confirmAll.set(false);
  }

  protected openRecorder(): void {
    this.consent.set(false);
    this.recorder().nativeElement.showModal();
  }

  protected uploadFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again after a problem
    if (file) void this.myVoice.upload(file);
  }

  protected closeRecorder(): void {
    this.recorder().nativeElement.close();
  }

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
      case 'ok': return 'Running privately';
      case 'degraded': return this.status.health()?.llm.ok ? 'Speech unavailable' : 'Model unavailable';
      case 'offline': return 'Backend offline';
      default: return 'Connecting…';
    }
  });

  protected readonly statusDetail = computed(() => {
    const h = this.status.health();
    if (this.status.connection() === 'offline') return 'Locally: start the backend on port 8000';
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
    const text = id === MY_VOICE
      ? 'Hello! This is your own voice, speaking British English. Lovely to meet you.'
      : `Hello, this is the ${shortName(label)} voice. Lovely to meet you.`;
    this.player.play(previewId, [{ audio: this.myVoice.tts(text, id), text }]);
  }

  protected name(label: string): string {
    return shortName(label);
  }

  protected accent(label: string): string {
    const m = /\((.*)\)/.exec(label);
    return m ? m[1].replace(/^Kokoro, /, '') : '';
  }

  protected readonly selectedModel = computed(() => {
    const models = this.status.models();
    const chosen = this.settings.model();
    return chosen && models.includes(chosen) ? chosen : (models[0] ?? null);
  });

  protected chooseModel(id: string): void {
    // The server's default model is stored as null, so a later default change is followed.
    this.settings.model.set(id === this.status.models()[0] ? null : id);
  }

  /** The default model is the base one; any other offered model is a fine-tune of it. */
  protected modelLabel(id: string): string {
    return id === this.status.models()[0] ? 'Standard' : 'Fine-tuned';
  }

  protected readonly modelHint = computed(() =>
    this.selectedModel() === this.status.models()[0]
      ? `${this.selectedModel()}, guided by a detailed style prompt.`
      : `${this.selectedModel()}: a LoRA adapter trained on Ellie's style, with a one-line prompt.`,
  );

  /** Piper and Kokoro voices in their own groups (each voice belongs to one engine). */
  protected readonly voiceGroups = computed(() => {
    const all = this.status.voices();
    return [
      { id: 'piper', title: 'Piper · quick', voices: all.filter((v) => !v.id.startsWith('kokoro-')) },
      { id: 'kokoro', title: 'Kokoro · more natural', voices: all.filter((v) => v.id.startsWith('kokoro-')) },
    ].filter((g) => g.voices.length);
  });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
