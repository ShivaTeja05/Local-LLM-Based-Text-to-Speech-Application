import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

import { AvatarState, Expression } from '../core/models';

/**
 * Ellie's face. Flat SVG on a 240px grid. The mouth is reshaped every frame from the live
 * loudness of the audio being played (AudioPlayerService.level), so lip movement follows
 * the real speech at any speed and with any voice. Blinks at random 2.5-6 s intervals.
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './avatar.html',
  styleUrl: './avatar.scss',
  host: { '[class]': '"is-" + state() + " feels-" + expression()' },
})
export class Avatar {
  readonly state = input<AvatarState>('idle');
  readonly expression = input<Expression>('neutral');
  /** 0..1 loudness of the speech playing right now. */
  readonly level = input(0);

  protected readonly blinking = signal(false);

  /** Mouth openness 0..1 and smile -1..1. */
  private readonly open = computed(() => (this.state() === 'speaking' ? this.level() : 0));
  private readonly smile = computed(() => {
    const e = this.expression();
    const base = e === 'happy' ? 0.85 : e === 'concerned' ? -0.35 : 0.45;
    return this.state() === 'thinking' ? Math.min(base, 0.15) : base;
  });

  protected readonly mouth = computed(() => {
    const o = this.open();
    const s = this.smile();
    const cx = 120;
    const cy = 150;
    const half = 13 + 4 * o;
    const corner = cy - 3 * s;
    const top = cy - 1 + 2 * s * (1 - o) - 3 * o;
    const bottom = cy + 3 + 3 * s + 17 * o;
    return `M ${cx - half} ${corner} Q ${cx} ${top} ${cx + half} ${corner} Q ${cx} ${bottom} ${cx - half} ${corner} Z`;
  });

  /** Brow lift by mood: concerned raises the inner ends, thinking raises both. */
  protected readonly leftBrow = computed(() => this.brow(-1));
  protected readonly rightBrow = computed(() => this.brow(1));
  protected readonly gaze = computed(() => (this.state() === 'thinking' ? 'translate(3 -4)' : 'translate(0 0)'));
  protected readonly cheek = computed(() => (this.expression() === 'happy' ? 0.42 : 0.26));

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const schedule = () => {
      this.timer = setTimeout(() => {
        this.blinking.set(true);
        this.timer = setTimeout(() => {
          this.blinking.set(false);
          schedule();
        }, 130);
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  private brow(side: -1 | 1): string {
    const pivot = side < 0 ? '92 100' : '148 100';
    if (this.expression() === 'concerned') return `rotate(${side * 9} ${pivot})`;
    if (this.state() === 'thinking') return 'translate(0 -3)';
    if (this.state() === 'listening' || this.expression() === 'happy') return 'translate(0 -1.5)';
    return 'translate(0 0)';
  }
}
