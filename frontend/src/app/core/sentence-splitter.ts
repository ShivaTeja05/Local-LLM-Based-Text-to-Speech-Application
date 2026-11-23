/**
 * Splits a token stream into sentences as they complete, so speech for sentence one can
 * start while the LLM is still writing sentence two (docs/ARCHITECTURE.md §2).
 *
 * A sentence ends at . ! ? or … (plus any closing quotes/brackets) followed by whitespace.
 * A terminator at the very end of the buffer is not trusted yet: "5." may become "5.50".
 * Common abbreviations ("Mr.", "e.g.") and initials ("J. Smith") do not end a sentence.
 * A very long run with no terminator is split at a comma so speech never waits too long.
 *
 * Early start (live replies): the first piece does not wait for the whole first sentence. It is
 * sent at the first comma/semicolon/colon/dash once there are at least six words and 30 characters,
 * or after about twelve words if there is none (never ending on a word like "the" or "when"), so
 * the voice starts while the LLM is still writing. Leading streaming voices buffer a similar amount
 * (around 8 words / 40 characters) before speaking: much shorter pieces lose their natural
 * intonation. Later pieces may be cut at a comma too, but only once they are longer (a growing
 * schedule, like ElevenLabs' 120/160/250-character one), so a long second sentence cannot leave
 * the voice silent while the model is still writing it.
 */
const ABBREVIATIONS = new Set([
  // "no" is deliberately absent: "No. I don't think so." is common in conversation.
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'mt', 'ave',
]);
const TERMINATORS = '.!?…';
/** Words a spoken piece should not end on: the phrase would sound cut off. */
const DANGLING = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'but', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'my', 'your',
  'our', 'their', 'his', 'her', 'its', 'is', 'are', 'was', 'were', 'be', 'that', 'this', 'as', 'so', 'if', 'than',
  'very', 'really', 'quite', 'some', 'any', 'into', 'about', "i'm", "it's", "you're", 'i', 'you', 'we', 'they',
  'when', 'where', 'while', 'because', 'which', 'who', 'what', 'how', 'not', 'can', 'will', 'would', 'could',
  'should', 'have', 'has', 'had', 'do', 'does', 'did', 'just', 'also', 'there', 'these', 'those', 'me', 'him',
]);

/**
 * Early-start schedule per piece: [min words, min characters] before a comma may end it, and the
 * word count after which it is cut even without one. The first piece is short so the voice starts
 * quickly; later ones grow, as the voice has more queued and fewer seams sound better.
 */
const SCHEDULE: [number, number, number][] = [
  [6, 30, 12],
  [10, 60, 20],
  [16, 90, 30],
];

export interface SplitterOptions {
  /** Break a long run with no sentence end at a comma after this many characters. */
  maxChars?: number;
  /** Send the first piece after a few words instead of waiting for the first full sentence. */
  earlyStart?: boolean;
}
const CLOSERS = '"\'”’)]';

export class SentenceSplitter {
  private buffer = '';
  private pushed = 0;
  private emitted = 0;
  private readonly maxChars: number;
  private readonly earlyStart: boolean;

  constructor(options: SplitterOptions | number = {}) {
    const o = typeof options === 'number' ? { maxChars: options } : options;
    this.maxChars = o.maxChars ?? 220;
    this.earlyStart = o.earlyStart ?? false;
  }

  /** How many characters of the input have been handed out as pieces so far. */
  get consumed(): number {
    return this.pushed - this.buffer.length;
  }

  push(text: string): string[] {
    this.buffer += text;
    this.pushed += text.length;
    const out = this.extract();
    this.emitted += out.length;
    return out;
  }

  /** End of stream: whatever is left is the last sentence. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) this.emitted++;
    return rest ? [rest] : [];
  }

  private extract(): string[] {
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      if (!TERMINATORS.includes(this.buffer[i])) continue;
      let j = i + 1;
      while (j < this.buffer.length && (TERMINATORS.includes(this.buffer[j]) || CLOSERS.includes(this.buffer[j]))) j++;
      if (j >= this.buffer.length) break; // wait for the next character
      if (!/\s/.test(this.buffer[j])) { i = j - 1; continue; } // "5.50", "e.g.x"
      if (this.buffer[i] === '.' && this.isAbbreviation(start, i)) { i = j - 1; continue; }
      const sentence = this.buffer.slice(start, j).trim();
      if (sentence) out.push(sentence);
      start = j;
      i = j - 1;
    }
    this.buffer = this.buffer.slice(start);

    if (this.earlyStart && out.length === 0) {
      const [minWords, minChars, forceWords] = SCHEDULE[Math.min(this.emitted, SCHEDULE.length - 1)];
      const early = this.earlyPiece(minWords, minChars, forceWords);
      if (early) out.push(early);
    }

    // Long run without a sentence end: break at the last comma/semicolon after 60 chars.
    if (this.buffer.length > this.maxChars) {
      const cut = Math.max(this.buffer.lastIndexOf(', '), this.buffer.lastIndexOf('; '));
      if (cut > 60) {
        out.push(this.buffer.slice(0, cut + 1).trim());
        this.buffer = this.buffer.slice(cut + 2);
      }
    }
    return out;
  }

  /** The opening words of the sentence being written, if there are enough to speak them now. */
  private earlyPiece(minWords: number, minChars: number, forceWords: number): string | null {
    // Only whole words count: the last one may still be arriving.
    const whole = this.buffer.slice(0, this.buffer.search(/\S*$/));
    const words = [...whole.matchAll(/\S+/g)];
    // A clause break after enough words and characters: ", " "; " ": " " - " " — ".
    for (let k = minWords - 1; k < words.length; k++) {
      const m = words[k];
      if (m.index! + m[0].length < minChars) continue;
      if (/[,;:]$/.test(m[0]) || (k + 1 < words.length && /^[—–-]$/.test(words[k + 1][0]))) {
        if (/^\d/.test(words[k + 1]?.[0] ?? '') && /,$/.test(m[0])) continue; // "1, 2, 3": wait
        return this.take(m.index! + m[0].length);
      }
    }
    // No break yet: after enough words, cut after the last word that doesn't leave the phrase hanging.
    if (words.length < forceWords) return null;
    for (let k = forceWords - 1; k >= forceWords - 5; k--) {
      const w = words[k][0].toLowerCase().replace(/[^a-z']/g, '');
      if (!DANGLING.has(w)) return this.take(words[k].index! + words[k][0].length);
    }
    return null;
  }

  private take(end: number): string {
    const piece = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end).replace(/^\s+/, '');
    return piece;
  }

  private isAbbreviation(sentenceStart: number, dot: number): boolean {
    let k = dot - 1;
    while (k >= sentenceStart && !/\s/.test(this.buffer[k])) k--;
    const word = this.buffer.slice(k + 1, dot).replace(/^["'(“‘]+/, '');
    if (/^[A-Z]$/.test(word)) return true; // an initial, e.g. "J. Smith"
    return ABBREVIATIONS.has(word.toLowerCase());
  }
}

/** Split a complete text into sentences (used for replay and the final remainder). */
export function splitSentences(text: string): string[] {
  const s = new SentenceSplitter();
  return [...s.push(text), ...s.flush()];
}
