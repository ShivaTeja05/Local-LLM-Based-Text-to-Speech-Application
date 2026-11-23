import { LOOKS, lookFor, paletteStyle } from './looks';

describe('looks', () => {
  it('gives each of the five regional voices its own character', () => {
    const ids = ['uk-south', 'uk-north', 'uk-midlands', 'uk-east', 'uk-west'];
    const looks = ids.map((id) => lookFor(id));
    expect(new Set(looks.map((l) => `${l.hair}/${l.outfit}`)).size).toBe(5);
    expect(new Set(looks.map((l) => l.description)).size).toBe(5);
  });

  it('falls back sensibly for voices without a look of their own', () => {
    expect(lookFor(null)).toBe(LOOKS['uk-south']);
    expect(lookFor('something-new')).toBe(LOOKS['uk-south']);
    expect(lookFor('kokoro-bm_george')).toBe(LOOKS['uk-east']); // a British male Kokoro voice
    expect(lookFor('kokoro-bf_emma')).toBe(LOOKS['uk-south']);
  });

  it('turns the palette into CSS custom properties', () => {
    const style = paletteStyle(LOOKS['uk-west']);
    expect(style).toContain('--skin: #f5d2b6');
    expect(style).toContain('--top: #e3a52a');
    expect(style.split(';')).toHaveLength(10);
  });
});
