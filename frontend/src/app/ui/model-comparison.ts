import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

import { AudioPlayerService } from '../core/audio-player.service';
import { EVALUATION_RESULTS } from '../core/evaluation-results';
import { ComparisonMode, ModelComparisonService } from '../core/model-comparison.service';
import { MyVoiceService } from '../core/my-voice.service';
import { splitSentences } from '../core/sentence-splitter';
import { SettingsService } from '../core/settings.service';

@Component({
  selector: 'app-model-comparison',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ModelComparisonService],
  templateUrl: './model-comparison.html',
  styleUrl: './model-comparison.scss',
})
export class ModelComparison {
  protected readonly comparison = inject(ModelComparisonService);
  protected readonly player = inject(AudioPlayerService);
  private readonly settings = inject(SettingsService);
  private readonly voice = inject(MyVoiceService);
  protected readonly recorded = EVALUATION_RESULTS;
  protected readonly draft = signal('How are you?');
  protected readonly mode = signal<ComparisonMode>('short');
  protected readonly presets = ['How are you?', 'Give me a recipe for pancakes.', 'How far away is the Moon?'];
  private readonly audio = new Map<string, { audio: Promise<ArrayBuffer>; text: string }[]>();

  constructor() { inject(DestroyRef).onDestroy(() => this.player.stop()); }

  protected input(event: Event): void { this.draft.set((event.target as HTMLTextAreaElement).value); }
  protected chooseMode(event: Event): void {
    this.mode.set((event.target as HTMLSelectElement).value as ComparisonMode);
  }
  protected run(): void {
    this.player.stop();
    this.audio.clear();
    void this.comparison.run(this.draft(), this.mode());
  }
  protected words(text: string): number { return (text.match(/[\w']+/g) ?? []).length; }
  protected seconds(ms: number): string { return (ms / 1000).toFixed(1); }
  protected play(model: string): void {
    const row = this.comparison.replies().find(r => r.model === model);
    if (!row || row.state !== 'done') return;
    const id = `compare:${model}`;
    if (this.player.speakingId() === id) { this.player.stop(); return; }
    this.player.resumeAudio();
    const voice = this.settings.voiceId();
    const key = `${model}/${voice}/${this.voice.voice()?.createdAt ?? ''}`;
    let clips = this.audio.get(key);
    if (!clips) {
      const pieces = splitSentences(row.text).flatMap(s => s.match(/[\s\S]{1,800}(?:\s|$)|\S{1,800}/g) ?? []);
      clips = pieces.map(text => ({ text, audio: this.voice.tts(text.trim(), voice) }));
      this.audio.set(key, clips);
    }
    this.player.play(id, clips);
  }
}
