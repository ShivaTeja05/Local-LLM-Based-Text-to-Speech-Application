import { pauseAfter, wantsBreath } from './audio-player.service';

describe('natural pauses between sentences', () => {
  it('pauses a little longer after a question than after a statement, and least after a clause', () => {
    expect(pauseAfter('How are you?')).toBeGreaterThan(pauseAfter('I am well.'));
    expect(pauseAfter('I am well.')).toBeGreaterThan(pauseAfter('Well, first of all,'));
  });

  it('pauses longer after a long sentence, as a speaker needs more breath', () => {
    const long = 'Tea arrived in Britain in the seventeenth century and quickly became part of daily life for almost everyone.';
    expect(pauseAfter(long)).toBeGreaterThan(pauseAfter('Tea is lovely.'));
  });

  it('keeps every pause within a natural conversational range', () => {
    for (const s of ['Yes.', 'Really?', 'And then,', 'Hmm', 'A '.repeat(40) + 'end.']) {
      const ms = pauseAfter(s);
      expect(ms).toBeGreaterThanOrEqual(150);
      expect(ms).toBeLessThanOrEqual(650);
    }
  });

  it('copes with closing quotes and brackets after the punctuation', () => {
    expect(pauseAfter('She said "lovely!"')).toBe(pauseAfter('She said lovely!'));
  });

  it('breathes before a long sentence or after a long one, not between short ones', () => {
    expect(wantsBreath('Yes.', 'Short one.')).toBe(false);
    expect(wantsBreath('Yes.', 'Here is a much longer sentence that would need a breath first.')).toBe(true);
    expect(wantsBreath('This was a very long sentence that went on and on about the weather and the trains and the tea.', 'Ok.')).toBe(true);
  });
});
