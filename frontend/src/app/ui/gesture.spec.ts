import { isGreeting, isQuestion } from './gesture';

describe('isQuestion', () => {
  it('spots a question, even with a closing quote or bracket', () => {
    expect(isQuestion('How are you?')).toBe(true);
    expect(isQuestion('She asked, "Tea?"')).toBe(true);
    expect(isQuestion('(Fancy a walk?) ')).toBe(true);
  });

  it('ignores statements and questions mid-sentence', () => {
    expect(isQuestion("I'm very well, thank you.")).toBe(false);
    expect(isQuestion('Why? Because it rains a lot.')).toBe(false);
  });
});

describe('isGreeting', () => {
  it('waves at hellos and goodbyes', () => {
    for (const s of ['Hello there!', 'Hi, lovely to meet you.', 'Good morning to you!', 'Cheerio for now.', 'Take care!']) {
      expect(isGreeting(s)).toBe(true);
    }
  });

  it('does not wave at words that only contain a greeting', () => {
    for (const s of ['This is high tea.', 'The weather is behaving.', 'Which shoes?', 'Goodness me.']) {
      expect(isGreeting(s)).toBe(false);
    }
  });
});
