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

  it('returns nothing for empty input', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});
