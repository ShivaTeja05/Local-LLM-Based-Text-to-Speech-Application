import { Expression } from './models';

const CONCERNED = /\b(sorry|sad|down|unfortunately|tough|difficult|worried|afraid|trouble|lonely|ill|poorly|hard time)\b/i;
const HAPPY = /\b(lovely|brilliant|wonderful|great|glad|delighted|fantastic|cheers|fun|marvellous|splendid|enjoy|happy)\b|!/i;

/** A light, rule-based read of a reply's tone, used only for the avatar's face. */
export function expressionFor(text: string | null | undefined): Expression {
  if (!text) return 'neutral';
  if (CONCERNED.test(text)) return 'concerned';
  if (HAPPY.test(text)) return 'happy';
  return 'neutral';
}
