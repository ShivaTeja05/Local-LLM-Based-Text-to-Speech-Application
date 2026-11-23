/**
 * Body language read from the sentence being spoken: a question lifts the brows, a greeting or
 * a farewell gets a wave. Both look at the text, which is known before it is heard.
 */

/** Does the sentence ask something? (Allows closing quotes or brackets after the "?".) */
export function isQuestion(text: string): boolean {
  return /\?["'”’)\]]*\s*$/.test(text.trim());
}

const GREETING = /\b(hello|hiya|hi|hey|good (morning|afternoon|evening)|goodbye|bye|cheerio|ta-ra|see you|take care)\b/i;

/** Does the sentence say hello or goodbye? */
export function isGreeting(text: string): boolean {
  return GREETING.test(text);
}

export type HandGesture = 'wave' | 'offer' | 'present';

/**
 * The hand gesture for a sentence as it starts: a wave for hello or goodbye, an open palm
 * ("over to you") for a question, and an explaining hand on every other longer statement, so
 * her hands move while she talks without moving on every single sentence.
 */
export function handFor(text: string, n: number): HandGesture | null {
  if (isGreeting(text)) return 'wave';
  if (isQuestion(text)) return 'offer';
  const words = (text.trim().match(/\S+/g) ?? []).length;
  return words >= 8 && n % 2 === 1 ? 'present' : null;
}

/** How the face reads the sentence being spoken: drives the brows (and the smile) while she says it. */
export type Mood = 'neutral' | 'joy' | 'question' | 'surprise' | 'sympathy' | 'thoughtful' | 'serious';

const SURPRISE = /\b(wow|ooh|oh my|goodness|gosh|blimey|crikey|amazing|incredible|remarkable|no way|fancy that|really\?)|!\?/i;
const SYMPATHY = /\b(sorry|sad|down|unfortunately|tough|difficult|worried|afraid|trouble|lonely|ill|poorly|hard time|miss (?:you|them|her|him)|loss|upset)\b/i;
const THOUGHTFUL = /\b(hmm|not sure|perhaps|maybe|might|it depends|depends on|i suppose|i think|i reckon|probably|possibly|on the other hand|wonder)\b/i;
const SERIOUS = /\b(important|careful|be safe|safety|warning|danger|emergency|seriously|please do|make sure|never|must)\b/i;
const JOY = /\b(lovely|brilliant|wonderful|great|glad|delighted|fantastic|cheers|fun|marvellous|splendid|enjoy|happy|love|perfect|smashing|exciting)\b|!/i;

/**
 * The feeling of one sentence, from its words and punctuation. Checked from the strongest signal
 * down: sympathy first (a kind question still looks kind), then surprise, a question, thinking it
 * over, something serious, and good cheer.
 */
export function moodFor(text: string): Mood {
  if (SYMPATHY.test(text)) return 'sympathy';
  if (SURPRISE.test(text)) return 'surprise';
  if (isQuestion(text)) return 'question';
  if (THOUGHTFUL.test(text)) return 'thoughtful';
  if (SERIOUS.test(text)) return 'serious';
  if (JOY.test(text)) return 'joy';
  return 'neutral';
}
