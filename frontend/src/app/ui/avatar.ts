import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, booleanAttribute, computed, effect, inject, input, signal,
  untracked,
} from '@angular/core';

import { AvatarState, Expression } from '../core/models';
import { HandGesture, Mood, handFor, moodFor } from './gesture';
import { lookFor, paletteStyle } from './looks';

/**
 * Ellie's face. Flat SVG on a 240px grid. The mouth is reshaped every frame from the live
 * loudness of the audio being played (AudioPlayerService.level), so lip movement follows
 * the real speech at any speed and with any voice. Blinks at random 2.5-6 s intervals.
 *
 * Gaze: while Ellie is quiet, her eyes follow what the user is doing: the mouse pointer, or the
 * text box they are typing in. While she speaks she looks straight out at the user, and while
 * she thinks she looks up and away.
 *
 * Each voice has its own character (looks.ts): hair, clothes, extras and colours change, while the
 * face that talks, blinks and watches stays the same.
 *
 * Body language while speaking: a nod (alternately tilting left and right) as each sentence
 * starts; brows and smile that show the feeling of the sentence being said (moodFor: surprised,
 * asking, sympathetic, thinking it over, serious, cheerful), with a small lift on stressed
 * syllables; and hand gestures (gesture.ts): a wave on hello or
 * goodbye, an open palm on a question, an explaining hand on longer statements. The app also cues a
 * wave when she is ready, on her first reply and on New conversation (waveCue).
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './avatar.html',
  styleUrl: './avatar.scss',
  host: { '[class]': 'hostClass()', '[style]': 'palette()' },
})
export class Avatar {
  readonly state = input<AvatarState>('idle');
  readonly expression = input<Expression>('neutral');
  /** 0..1 loudness of the speech playing right now. */
  readonly level = input(0);
  /** The voice whose character to draw. */
  readonly voice = input<string | null>(null);
  /** A still picture (e.g. in the voice list): no blinking, no watching. */
  readonly still = input(false, { transform: booleanAttribute });
  /** The sentence being spoken (AudioPlayerService.sentence): drives nods, brows and waves. */
  readonly sentence = input<{ text: string; n: number } | null>(null);
  /** Increase to make her wave hello (ready, first reply, New conversation). */
  readonly waveCue = input(0);

  /** Which nod animation runs: alternating names restart the animation for every sentence. */
  protected readonly nod = signal<'nod-a' | 'nod-b' | null>(null);
  /** The hand gesture running now, if any. */
  protected readonly hand = signal<HandGesture | null>(null);
  protected readonly hostClass = computed(() =>
    ['is-' + this.state(), 'feels-' + this.expression(), this.nod(), HAND_CLASS[this.hand() ?? 'none'],
      this.tracking() ? 'tracking' : null]
      .filter(Boolean).join(' '));
  /** The feeling of the sentence she is saying right now (null when not speaking). */
  private readonly mood = computed<Mood | null>(() => {
    const s = this.sentence();
    return this.state() === 'speaking' && s ? moodFor(s.text) : null;
  });
  private lastWave = -Infinity;
  private handTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly look = computed(() => lookFor(this.voice()));
  protected readonly palette = computed(() => paletteStyle(this.look()));
  protected readonly label = computed(() => `Ellie, your conversation partner: ${this.look().description}`);

  protected readonly blinking = signal(false);
  /** Unique per instance: several avatars share the page (the stage and the voice list). */
  protected readonly faceClip = `ellie-face-${nextAvatarId++}`;

  /** Mouth openness 0..1 and smile -1..1. */
  private readonly open = computed(() => (this.state() === 'speaking' ? this.level() : 0));
  private readonly smile = computed(() => {
    // While speaking, the smile follows the sentence; otherwise the reply's overall tone.
    const mood = this.mood();
    if (mood) return MOOD_SMILE[mood];
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
  /** Following the pointer right now: the eyes move with it at once instead of easing. */
  private readonly tracking = computed(() =>
    this.state() !== 'speaking' && this.state() !== 'thinking' && this.watching() !== null);
  protected readonly gaze = computed(() => {
    const state = this.state();
    if (state === 'thinking') return 'translate(3 -4)';
    const look = state === 'speaking' ? null : this.watching();
    return look ? `translate(${look.x.toFixed(2)} ${look.y.toFixed(2)})` : 'translate(0 0)';
  });
  protected readonly cheek = computed(() => {
    const mood = this.mood();
    return (mood ? mood === 'joy' || mood === 'surprise' : this.expression() === 'happy') ? 0.42 : 0.26;
  });

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const schedule = () => {
      this.timer = setTimeout(() => {
        this.blinking.set(!this.still());
        this.timer = setTimeout(() => {
          this.blinking.set(false);
          schedule();
        }, 130);
      }, 2500 + Math.random() * 3500);
    };
    schedule();

    // Body language from the sentence being spoken.
    effect(() => {
      const s = this.sentence();
      if (!s) return;
      untracked(() => {
        if (this.still()) return;
        this.nod.set(s.n % 2 ? 'nod-a' : 'nod-b');
        const hand = handFor(s.text, s.n);
        if (hand) this.gesture(hand);
      });
    });
    effect(() => {
      if (this.waveCue() > 0) untracked(() => this.gesture('wave'));
    });

    // Follow the pointer and typing. Pointer events already arrive once per frame, so the eyes
    // move in the same frame as the cursor; typing (many events at once) is batched per frame.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let target: Point | null = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (this.still()) return;
      const box = host.getBoundingClientRect();
      this.watching.set(target && box.width ? gazeOffset(target, box) : null);
    };
    const lookAt = (point: Point | null) => {
      target = point;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onPointer = (e: PointerEvent) => {
      target = { x: e.clientX, y: e.clientY };
      update();
    };
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
      clearTimeout(this.handTimer);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('input', onType);
      document.removeEventListener('mouseout', lookAway);
      window.removeEventListener('blur', reset);
    });
  }

  /** Start a hand gesture. A wave takes over from anything else (at most one every 2.5 s, so two
   *  greetings in a row get one wave); other gestures never cut one short. */
  private gesture(kind: HandGesture): void {
    if (this.still()) return;
    if (kind === 'wave') {
      const now = performance.now();
      if (now - this.lastWave < 2500) return;
      this.lastWave = now;
    } else if (this.hand()) {
      return;
    }
    this.hand.set(null); // restart the animation even if the same gesture was running
    queueMicrotask(() => {
      this.hand.set(kind);
      clearTimeout(this.handTimer);
      this.handTimer = setTimeout(() => this.hand.set(null), HAND_MS[kind]);
    });
  }

  /**
   * Brows: while speaking they show the feeling of the sentence, and flick up a little on stressed
   * (louder) syllables, as people's do. Otherwise they follow the state and the reply's tone.
   */
  private brow(side: -1 | 1): string {
    const pivot = side < 0 ? '92 100' : '148 100';
    const lift = (base: number) => `translate(0 ${(base - 2.5 * this.level()).toFixed(2)})`;
    switch (this.mood()) {
      case 'surprise': return 'translate(0 -8)';
      case 'question': return 'translate(0 -6)';
      case 'sympathy': return `rotate(${side * 12} ${pivot}) translate(0 -1)`; // inner ends up
      case 'thoughtful': return side < 0 ? `translate(0 -6) rotate(-5 ${pivot})` : 'translate(0 1)'; // one brow up
      case 'serious': return `rotate(${-side * 8} ${pivot}) translate(0 1.5)`; // inner ends down, a slight frown
      case 'joy': return lift(-3);
      case 'neutral': return lift(-1);
    }
    if (this.expression() === 'concerned') return `rotate(${side * 9} ${pivot})`;
    if (this.state() === 'thinking') return 'translate(0 -3)';
    if (this.state() === 'listening' || this.expression() === 'happy') return 'translate(0 -1.5)';
    return 'translate(0 0)';
  }
}

let nextAvatarId = 0;

/** Host classes and lengths of the hand gestures (the animations are in avatar.scss). */
const HAND_CLASS: Record<HandGesture | 'none', string | null> = {
  wave: 'waving', offer: 'offering', present: 'presenting', none: null,
};
const HAND_MS: Record<HandGesture, number> = { wave: 1900, offer: 1700, present: 1700 };
/** The smile (-1..1) for each sentence feeling. */
const MOOD_SMILE: Record<Mood, number> = {
  neutral: 0.45, joy: 0.9, question: 0.5, surprise: 0.6, sympathy: -0.35, thoughtful: 0.2, serious: 0.05,
};

export interface Point {
  x: number;
  y: number;
}

/** Eyes' centre on the 240-unit SVG grid, and how far they can move (SVG units). */
const EYES = { x: 120, y: 116 };
const REACH = { x: 5.5, y: 4 };

/**
 * How far to move the eyes (SVG units) to look at a point on the screen. They turn fully once the
 * point is about an avatar-width away, and only partly for nearby points, so small movements close
 * to the face look natural instead of snapping to the edge.
 */
export function gazeOffset(point: Point, avatar: { left: number; top: number; width: number }): Point {
  const scale = avatar.width / 240;
  const dx = point.x - (avatar.left + EYES.x * scale);
  const dy = point.y - (avatar.top + EYES.y * scale);
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: 0, y: 0 };
  const strength = Math.min(1, distance / (avatar.width * 0.9));
  return { x: (dx / distance) * strength * REACH.x, y: (dy / distance) * strength * REACH.y };
}
