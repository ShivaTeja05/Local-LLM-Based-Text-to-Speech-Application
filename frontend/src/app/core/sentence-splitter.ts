/**
 * Splits a token stream into sentences as they complete, so speech for sentence one can
 * start while the LLM is still writing sentence two (docs/ARCHITECTURE.md §2).
 *
 * A sentence ends at . ! ? or … (plus any closing quotes/brackets) followed by whitespace.
 * A terminator at the very end of the buffer is not trusted yet: "5." may become "5.50".
 * Common abbreviations ("Mr.", "e.g.") and initials ("J. Smith") do not end a sentence.
 * A very long run with no terminator is split at a comma so speech never waits too long.
 */
const ABBREVIATIONS = new Set([
  // "no" is deliberately absent: "No. I don't think so." is common in conversation.
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'mt', 'ave',
]);
const TERMINATORS = '.!?…';
const CLOSERS = '"\'”’)]';

export class SentenceSplitter {
  private buffer = '';

  constructor(private readonly maxChars = 220) {}

  push(text: string): string[] {
    this.buffer += text;
    return this.extract();
  }

  /** End of stream: whatever is left is the last sentence. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
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
