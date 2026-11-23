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
