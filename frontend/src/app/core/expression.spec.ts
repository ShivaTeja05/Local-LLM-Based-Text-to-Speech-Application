import { expressionFor } from './expression';

describe('expressionFor', () => {
  it('reads tone from the reply', () => {
    expect(expressionFor("Sorry to hear that, it sounds tough.")).toBe('concerned');
    expect(expressionFor('That sounds lovely!')).toBe('happy');
    expect(expressionFor('The train leaves at noon.')).toBe('neutral');
    expect(expressionFor(null)).toBe('neutral');
  });

  it('prefers concern over cheer when both appear', () => {
    expect(expressionFor("Sorry you're feeling down. Lovely of you to share!")).toBe('concerned');
  });
});
