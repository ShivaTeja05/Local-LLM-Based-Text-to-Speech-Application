import { SentenceSplitter, splitSentences } from './sentence-splitter';

/** Feed text token by token, the way the LLM streams it. */
function stream(text: string, size = 3): { during: string[]; rest: string[] } {
  const s = new SentenceSplitter();
  const during: string[] = [];
  for (let i = 0; i < text.length; i += size) during.push(...s.push(text.slice(i, i + size)));
  return { during, rest: s.flush() };
}

describe('SentenceSplitter', () => {
  it('emits each sentence as soon as the next one starts', () => {
    const { during, rest } = stream("I'm very well, thank you. How are you?");
    expect(during).toEqual(["I'm very well, thank you."]);
    expect(rest).toEqual(['How are you?']);
  });

  it('handles ! ? … and closing quotes', () => {
    expect(splitSentences('Brilliant! Fancy a cuppa? I said "lovely." Then… we left.')).toEqual([
      'Brilliant!',
      'Fancy a cuppa?',
      'I said "lovely."',
      'Then…',
      'we left.',
    ]);
  });

  it('does not split decimals, prices or times', () => {
    expect(splitSentences('It costs £5.50 today. Meet at 3.30 then.')).toEqual(['It costs £5.50 today.', 'Meet at 3.30 then.']);
  });

  it('waits when a full stop is the last character (it may become a decimal)', () => {
    const s = new SentenceSplitter();
    expect(s.push('It is 5.')).toEqual([]);
    expect(s.push('50 pounds. Next')).toEqual(['It is 5.50 pounds.']);
  });

  it('does not split common abbreviations or initials', () => {
    expect(splitSentences('Ask Dr. Smith, e.g. on Monday. J. Bloggs agreed.')).toEqual([
      'Ask Dr. Smith, e.g. on Monday.',
      'J. Bloggs agreed.',
    ]);
  });

  it('still splits a sentence that is just "No."', () => {
    expect(splitSentences("No. I don't think so.")).toEqual(['No.', "I don't think so."]);
  });

  it('breaks a long run with no full stop at a comma', () => {
    const long = 'Well, ' + 'there is a lot to say about the Lake District, '.repeat(6) + 'and more';
    const out = new SentenceSplitter(220).push(long);
    expect(out.length).toBe(1);
    expect(out[0].endsWith(',')).toBe(true);
    expect(out[0].length).toBeLessThanOrEqual(long.length);
  });

  it('early start: speaks the opening words at the first comma, without waiting for the sentence', () => {
    const s = new SentenceSplitter({ earlyStart: true });
    const got: string[] = [];
    for (const t of ["I'm ", 'very ', 'well ', 'indeed ', 'this ', 'morning, ', 'thank ', 'you ', 'for ', 'asking. ', 'How']) got.push(...s.push(t));
    expect(got).toEqual(["I'm very well indeed this morning,", 'thank you for asking.']);
    expect(s.flush()).toEqual(['How']);
  });

  it('early start: with no comma, starts after about twelve words and never on "the" or "when"', () => {
    const s = new SentenceSplitter({ earlyStart: true });
    const text = 'The Lake District is lovely in autumn when the trees turn to gold and red and orange';
    const got: string[] = [];
    for (const w of text.split(' ')) got.push(...s.push(w + ' '));
    expect(got.length).toBe(1);
    const first = got[0].split(' ');
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(12);
    expect(['the', 'to', 'a', 'and', 'when']).not.toContain(first[first.length - 1].toLowerCase());
    expect((got[0] + ' ' + s.flush().join(' ')).trim()).toBe(text);
  });

  it('early start only shapes the first piece; later ones are whole sentences', () => {
    const s = new SentenceSplitter({ earlyStart: true });
    const out: string[] = [];
    for (const w of 'Oh hello there my dear old friend, lovely to see you. It is a sunny day, so let us go out. Bye'.split(' ')) out.push(...s.push(w + ' '));
    out.push(...s.flush());
    expect(out).toEqual(['Oh hello there my dear old friend,', 'lovely to see you.', 'It is a sunny day, so let us go out.', 'Bye']);
  });

  it('early start: a long second sentence is cut at a comma too, once it is long enough', () => {
    const s = new SentenceSplitter({ earlyStart: true });
    const text = 'Tea is lovely. It arrived in Britain in the seventeenth century as a rather costly luxury, ' +
      'and within a hundred years it was drunk by almost everyone in the country. Lovely';
    const out: string[] = [];
    for (const w of text.split(' ')) out.push(...s.push(w + ' '));
    out.push(...s.flush());
    expect(out).toEqual([
      'Tea is lovely.',
      'It arrived in Britain in the seventeenth century as a rather costly luxury,',
      'and within a hundred years it was drunk by almost everyone in the country.',
      'Lovely',
    ]);
  });

  it('early start waits for a short first sentence rather than splitting it', () => {
    const s = new SentenceSplitter({ earlyStart: true });
    expect(s.push('Hello, ')).toEqual([]);
    expect(s.push('Sam! How ')).toEqual(['Hello, Sam!']);
  });

  it('counts how much text has been handed out', () => {
    const s = new SentenceSplitter({ earlyStart: true });
    s.push('One two three four, five six. Seven');
    expect(s.consumed).toBe('One two three four, five six.'.length);
  });

  it('returns nothing for empty input', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});
