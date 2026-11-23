import { pauseAfter, speechBounds, wantsBreath } from './audio-player.service';

describe('natural pauses between sentences', () => {
  it('pauses a little longer after a question than after a statement, and least after a clause', () => {
    expect(pauseAfter('How are you?')).toBeGreaterThan(pauseAfter('I am well.'));
    expect(pauseAfter('I am well.')).toBeGreaterThan(pauseAfter('Well, first of all,'));
  });

  it('pauses longer after a long sentence, as a speaker needs more breath', () => {
    const long = 'Tea arrived in Britain in the seventeenth century and quickly became part of daily life for almost everyone.';
    expect(pauseAfter(long)).toBeGreaterThan(pauseAfter('Tea is lovely.'));
  });

  it('pauses about twice as long at a full stop as at a comma, as people do', () => {
    const ratio = pauseAfter('I am well.') / pauseAfter('Well, first of all,');
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });

  it('barely pauses where a phrase was cut early, so it flows on', () => {
    expect(pauseAfter('The Lake District is lovely at this time of year')).toBeLessThan(150);
  });

  it('keeps every pause within a natural conversational range', () => {
    for (const s of ['Yes.', 'Really?', 'And then,', 'A '.repeat(40) + 'end.']) {
      const ms = pauseAfter(s);
      expect(ms).toBeGreaterThanOrEqual(200);
      expect(ms).toBeLessThanOrEqual(700);
    }
  });

  it('copes with closing quotes and brackets after the punctuation', () => {
    expect(pauseAfter('She said "lovely!"')).toBe(pauseAfter('She said lovely!'));
  });

  it('breathes every few seconds at a sentence break, not before every sentence', () => {
    const longNext = 'Here is a much longer sentence that would really need a good breath before it starts.';
    expect(wantsBreath('Yes.', 'Short one.', 1)).toBe(false);
    expect(wantsBreath('Yes.', 'Short one.', 4.5)).toBe(true);
    expect(wantsBreath('Yes.', longNext, 3)).toBe(true);
    expect(wantsBreath('Yes.', longNext, 1)).toBe(false);
    expect(wantsBreath('Well, first of all,', longNext, 9)).toBe(false); // never mid-sentence
  });
});

describe('speechBounds', () => {
  const rate = 22050;
  const clip = (silenceBefore: number, speech: number, silenceAfter: number) => {
    const n = (s: number) => Math.round(rate * s);
    const out = new Float32Array(n(silenceBefore) + n(speech) + n(silenceAfter));
    for (let i = 0; i < n(speech); i++) out[n(silenceBefore) + i] = 0.3 * Math.sin(i / 8);
    return out;
  };

  it('trims the silence a voice leaves at either end, keeping a short margin', () => {
    const { start, end } = speechBounds(clip(0.25, 1, 0.3), rate);
    expect(start / rate).toBeGreaterThan(0.2);
    expect(start / rate).toBeLessThan(0.25);
    expect(end / rate).toBeGreaterThan(1.25);
    expect(end / rate).toBeLessThan(1.33);
  });

  it('leaves a clip that starts and ends with speech as it is', () => {
    const samples = clip(0, 1, 0);
    expect(speechBounds(samples, rate)).toEqual({ start: 0, end: samples.length });
  });

  it('leaves a silent clip alone', () => {
    const samples = new Float32Array(rate);
    expect(speechBounds(samples, rate)).toEqual({ start: 0, end: samples.length });
  });
});
