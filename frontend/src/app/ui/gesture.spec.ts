import { handFor, isGreeting, isQuestion, moodFor, reactionFor } from './gesture';

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

describe('handFor', () => {
  it('waves at a greeting, offers a palm on a question, explains on longer statements', () => {
    expect(handFor('Hello there, lovely to see you!', 2)).toBe('wave');
    expect(handFor('How has your week been?', 2)).toBe('offer');
    expect(handFor('Windermere is lovely in autumn, with all the trees turning gold.', 1)).toBe('present');
  });

  it('keeps short sentences and every other long one hands-free', () => {
    expect(handFor('That sounds lovely.', 1)).toBeNull();
    expect(handFor('Windermere is lovely in autumn, with all the trees turning gold.', 2)).toBeNull();
  });
});

describe('moodFor', () => {
  it('reads the feeling of each sentence', () => {
    expect(moodFor("Oh, I'm so sorry to hear that.")).toBe('sympathy');
    expect(moodFor('Wow, that is amazing news!')).toBe('surprise');
    expect(moodFor('How has your week been?')).toBe('question');
    expect(moodFor("Hmm, I'm not entirely sure about that.")).toBe('thoughtful');
    expect(moodFor('Please make sure you stay safe out there.')).toBe('serious');
    expect(moodFor('That sounds absolutely lovely.')).toBe('joy');
    expect(moodFor('The train leaves at noon.')).toBe('neutral');
  });

  it('lets kindness win over the question mark', () => {
    expect(moodFor("I'm sorry you're feeling down, do you want to talk?")).toBe('sympathy');
  });

  it('reads a surprised question as surprise', () => {
    expect(moodFor('Really? You climbed Ben Nevis?')).toBe('surprise');
  });
});

describe('more hand gestures', () => {
  it('gives a thumbs up for praise and shrugs when unsure', () => {
    expect(handFor('Well done, that is brilliant news!', 2)).toBe('thumbs');
    expect(handFor("Hmm, I'm not entirely sure about that.", 2)).toBe('shrug');
    expect(handFor('Brilliant, shall we go?', 2)).toBe('offer'); // a question still offers the palm
  });
});

describe('reactionFor: how she reacts to what you say', () => {
  it('comforts sad news, even when it contains a happy-looking word', () => {
    expect(reactionFor('My grandad passed away last week.')).toBe('comfort');
    expect(reactionFor("I'm really stressed about my exams")).toBe('comfort');
  });

  it('cheers good news, laughs at jokes, blushes at compliments, thanks with a hand on heart', () => {
    expect(reactionFor('I passed my driving test!')).toBe('cheer');
    expect(reactionFor('I got the job!!')).toBe('cheer');
    expect(reactionFor('hahaha that is hilarious')).toBe('laugh');
    expect(reactionFor("You're so clever, Ellie")).toBe('blush');
    expect(reactionFor('Thanks a lot!')).toBe('thanks');
    expect(reactionFor('Hello Ellie')).toBe('wave');
  });

  it('does not react to ordinary messages', () => {
    expect(reactionFor('What time is it in London?')).toBeNull();
    expect(reactionFor('Tell me about the Lake District')).toBeNull();
  });
});
