import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, booleanAttribute, computed, effect, inject, input, isDevMode, signal,
  untracked,
} from '@angular/core';

import { AvatarState, Expression } from '../core/models';
import { HandGesture, Mood, Reaction, handFor, moodFor, reactionFor } from './gesture';
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
 *
 * Like a 3D character she is never frozen and reacts to the user, not just to her own words:
 * breathing and a slight sway at rest; leaning in with small nods while the user types; reacting
 * the moment a message is sent (reactionFor: laughing at a joke, cheering good news, a hand on her
 * heart for sad news or thanks, a blush for a compliment); a hand to her chin while she thinks; a
 * thumbs up for praise and a shrug when unsure.
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
  /** The message the user has just sent (ConversationService.lastSent): she reacts to it. */
  readonly said = input<{ text: string; n: number } | null>(null);

  /** Which nod animation runs: alternating names restart the animation for every sentence. */
  protected readonly nod = signal<'nod-a' | 'nod-b' | null>(null);
  /** The gesture or reaction running now, if any. */
  protected readonly hand = signal<Action | null>(null);
  protected readonly hostClass = computed(() =>
    ['is-' + this.state(), 'feels-' + this.expression(), this.nod(), ACT_CLASS[this.hand() ?? 'none'],
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
  private readonly open = computed(() => {
    const act = this.hand();
    if (act === 'laugh') return 0.55; // an open, laughing smile
    if (act === 'cheer') return Math.max(0.35, this.state() === 'speaking' ? this.level() : 0);
    return this.state() === 'speaking' ? this.level() : 0;
  });
  private readonly smile = computed(() => {
    const act = this.hand();
    if (act && ACT_SMILE[act] !== undefined) return ACT_SMILE[act]!;
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
    const act = this.hand();
    if (act === 'blush') return 'translate(-2 3)'; // a bashful glance down
    if (act === 'chin' || state === 'thinking') return 'translate(3 -4)';
    const look = state === 'speaking' ? null : this.watching();
    return look ? `translate(${look.x.toFixed(2)} ${look.y.toFixed(2)})` : 'translate(0 0)';
  });
  protected readonly cheek = computed(() => {
    const act = this.hand();
    if (act === 'blush') return 0.8;
    if (act === 'laugh' || act === 'cheer' || act === 'thanks') return 0.55;
    const mood = this.mood();
    return (mood ? mood === 'joy' || mood === 'surprise' : this.expression() === 'happy') ? 0.42 : 0.26;
  });

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Blinks every 2.5-6 s, and now and then a quick double blink, as people do.
    const blink = (then: () => void) => {
      this.blinking.set(!this.still());
      this.timer = setTimeout(() => {
        this.blinking.set(false);
        then();
      }, 130);
    };
    const schedule = () => {
      this.timer = setTimeout(() => blink(() => {
        if (Math.random() < 0.2) this.timer = setTimeout(() => blink(schedule), 180);
        else schedule();
      }), 2500 + Math.random() * 3500);
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
    // Development only: trigger an action from the browser console or a test (window.__ellie2d.react('laugh')).
    effect(() => {
      if (isDevMode() && !this.still())
        (window as unknown as { __ellie2d: unknown }).__ellie2d = { react: (k: Action) => this.react(k, k === 'chin' ? 0 : ACT_MS[k]) };
    });
    // React to what the user has just said, the moment it is sent.
    let seenSaid = false;
    effect(() => {
      const said = this.said();
      untracked(() => {
        if (!seenSaid) return void (seenSaid = true); // not to a message from before the page loaded
        const reaction = said && reactionFor(said.text);
        if (reaction) this.react(REACTION_ACTION[reaction]);
      });
    });
    // A hand to her chin while she thinks for more than a moment.
    let ponder: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const thinking = this.state() === 'thinking';
      untracked(() => {
        clearTimeout(ponder);
        if (thinking) ponder = setTimeout(() => !this.hand() && this.state() === 'thinking' && this.react('chin', 0), 900);
        else if (this.hand() === 'chin') this.hand.set(null);
      });
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
    let nodWords = 0;
    const onType = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      const box = el?.getBoundingClientRect?.();
      if (box) lookAt({ x: box.left + Math.min(box.width / 2, 160), y: box.top + box.height / 2 });
      // A small "mm-hm" nod every few words the user types.
      const words = (el?.value ?? '').trim().split(/\s+/).filter(Boolean).length;
      if (words < nodWords) nodWords = 0;
      if (!this.still() && el?.tagName === 'TEXTAREA' && words - nodWords >= 3) {
        nodWords = words;
        this.nod.set(this.nod() === 'nod-a' ? 'nod-b' : 'nod-a');
      }
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
      clearTimeout(ponder);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('input', onType);
      document.removeEventListener('mouseout', lookAway);
      window.removeEventListener('blur', reset);
    });
  }

  /** Start a hand gesture while speaking. A wave takes over from anything else (at most one every
   *  2.5 s, so two greetings in a row get one wave); a new sentence's gesture replaces the last
   *  sentence's, but never cuts short a wave or a reaction to what the user said. */
  private gesture(kind: HandGesture): void {
    if (this.still()) return;
    if (kind === 'wave') {
      const now = performance.now();
      if (now - this.lastWave < 2500) return;
      this.lastWave = now;
    } else if (this.hand() && !SPEECH_GESTURES.has(this.hand()!)) {
      return;
    }
    this.react(kind);
  }

  /** Play an action now (a reaction to the user always takes over). `ms` 0 = until cleared. */
  private react(kind: Action, ms = ACT_MS[kind]): void {
    if (this.still()) return;
    if (kind === 'wave') this.lastWave = performance.now();
    this.hand.set(null); // restart the animation even if the same one was running
    queueMicrotask(() => {
      this.hand.set(kind);
      clearTimeout(this.handTimer);
      if (ms) {
        this.handTimer = setTimeout(() => {
          this.hand.set(null);
          if (this.state() === 'thinking') this.react('chin', 0); // still thinking: back to her chin
        }, ms);
      }
    });
  }

  /**
   * Brows: while speaking they show the feeling of the sentence, and flick up a little on stressed
   * (louder) syllables, as people's do. Otherwise they follow the state and the reply's tone.
   */
  private brow(side: -1 | 1): string {
    const pivot = side < 0 ? '92 100' : '148 100';
    switch (this.hand()) {
      case 'cheer': case 'laugh': return 'translate(0 -5)';
      case 'comfort': return `rotate(${side * 12} ${pivot}) translate(0 -1)`;
      case 'shrug': return 'translate(0 -6)';
      case 'chin': return side < 0 ? `translate(0 -6) rotate(-5 ${pivot})` : 'translate(0 1)';
      case 'blush': case 'thanks': return 'translate(0 -2)';
    }
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

/** Everything she can do with her hands, face and body: speech gestures plus reactions. */
type Action = HandGesture | 'cheer' | 'comfort' | 'thanks' | 'laugh' | 'blush' | 'chin';

/** Host classes and lengths of the actions (the animations are in avatar.scss). */
const ACT_CLASS: Record<Action | 'none', string | null> = {
  wave: 'waving', offer: 'offering', present: 'presenting', thumbs: 'thumbs-up', shrug: 'shrugging',
  cheer: 'cheering', comfort: 'comforting', thanks: 'thanking', laugh: 'laughing', blush: 'blushing',
  chin: 'pondering', none: null,
};
const ACT_MS: Record<Action, number> = {
  wave: 1900, offer: 1700, present: 1700, thumbs: 1700, shrug: 1700,
  cheer: 2000, comfort: 2600, thanks: 2000, laugh: 1800, blush: 2400, chin: 0,
};
/** The smile each action wears (undefined: leave it to the mood). */
const ACT_SMILE: Partial<Record<Action, number>> = {
  cheer: 1, laugh: 1, thanks: 0.9, blush: 0.7, comfort: -0.3, chin: 0.1, thumbs: 0.9,
};
/** Gestures that go with her own sentences (one may replace another); the rest are reactions. */
const SPEECH_GESTURES = new Set<Action>(['offer', 'present', 'thumbs', 'shrug', 'chin']);
/** What she does for each reaction to the user's message. */
const REACTION_ACTION: Record<Reaction, Action> = {
  laugh: 'laugh', cheer: 'cheer', comfort: 'comfort', thanks: 'thanks', blush: 'blush', wave: 'wave',
};
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
