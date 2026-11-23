import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, signal } from '@angular/core';

import { AvatarState, Expression } from '../core/models';

/**
 * Ellie's face. Flat SVG on a 240px grid. The mouth is reshaped every frame from the live
 * loudness of the audio being played (AudioPlayerService.level), so lip movement follows
 * the real speech at any speed and with any voice. Blinks at random 2.5-6 s intervals.
 *
 * Gaze: while Ellie is quiet, her eyes follow what the user is doing: the mouse pointer, or the
 * text box they are typing in. While she speaks she looks straight out at the user, and while
 * she thinks she looks up and away.
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
  /** Where the eyes point (SVG units) while she is free to look around; null = straight ahead. */
  private readonly watching = signal<Point | null>(null);
  protected readonly gaze = computed(() => {
    const state = this.state();
    if (state === 'thinking') return 'translate(3 -4)';
    const look = state === 'speaking' ? null : this.watching();
    return look ? `translate(${look.x.toFixed(2)} ${look.y.toFixed(2)})` : 'translate(0 0)';
  });
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

    // Follow the pointer and typing, at most once per frame.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let target: Point | null = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = host.getBoundingClientRect();
      this.watching.set(target && box.width ? gazeOffset(target, box) : null);
    };
    const lookAt = (point: Point | null) => {
      target = point;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onPointer = (e: PointerEvent) => lookAt({ x: e.clientX, y: e.clientY });
    const onType = (e: Event) => {
      const box = (e.target as HTMLElement | null)?.getBoundingClientRect?.();
      if (box) lookAt({ x: box.left + Math.min(box.width / 2, 160), y: box.top + box.height / 2 });
    };
    const lookAway = (e: MouseEvent) => !e.relatedTarget && lookAt(null); // pointer left the window
    const reset = () => lookAt(null);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    document.addEventListener('input', onType, { passive: true });
    document.addEventListener('mouseout', lookAway, { passive: true });
    window.addEventListener('blur', reset);

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('input', onType);
      document.removeEventListener('mouseout', lookAway);
      window.removeEventListener('blur', reset);
    });
  }

  private brow(side: -1 | 1): string {
    const pivot = side < 0 ? '92 100' : '148 100';
    if (this.expression() === 'concerned') return `rotate(${side * 9} ${pivot})`;
    if (this.state() === 'thinking') return 'translate(0 -3)';
    if (this.state() === 'listening' || this.expression() === 'happy') return 'translate(0 -1.5)';
    return 'translate(0 0)';
  }
}

export interface Point {
  x: number;
  y: number;
}

/** Eyes' centre on the 240-unit SVG grid, and how far they can move (SVG units). */
const EYES = { x: 120, y: 116 };
const REACH = { x: 4.5, y: 3.5 };

/**
 * How far to move the eyes (SVG units) to look at a point on the screen. They turn fully once the
 * point is about one and a half avatar-widths away, and only partly for nearby points, so small
 * movements close to the face look natural instead of snapping to the edge.
 */
export function gazeOffset(point: Point, avatar: { left: number; top: number; width: number }): Point {
  const scale = avatar.width / 240;
  const dx = point.x - (avatar.left + EYES.x * scale);
  const dy = point.y - (avatar.top + EYES.y * scale);
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: 0, y: 0 };
  const strength = Math.min(1, distance / (avatar.width * 1.5));
  return { x: (dx / distance) * strength * REACH.x, y: (dy / distance) * strength * REACH.y };
}
