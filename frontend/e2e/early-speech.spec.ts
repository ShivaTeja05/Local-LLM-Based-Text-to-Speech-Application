import { expect, test } from '@playwright/test';

import { composer, finishedReplies, trackTts } from './helpers';

const sse = (text: string) =>
  text.split(/(?<= )/).map((t) => `event: token\ndata: ${JSON.stringify({ t })}\n\n`).join('') +
  `event: done\ndata: ${JSON.stringify({ text, truncated: false, model: 'llama3.2:3b', turns_dropped: 0, prompt_tokens: 10 })}\n\n`;

test('speech starts after the first few words, and every word is spoken exactly once', async ({ page }) => {
  // A long first sentence with no comma for a while: the voice must not wait for all of it.
  const reply = 'The Lake District is lovely at this time of year when the trees are turning gold and red. ' +
    'You could stay in a little cottage near Grasmere, and walk up to Easedale Tarn. How does that sound?';
  await page.route('**/api/chat/stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(reply) }));
  const tts = trackTts(page);
  await page.goto('/');
  await composer(page).fill('A weekend idea?');
  await composer(page).press('Enter');
  await expect(finishedReplies(page)).toHaveCount(1);
  await expect.poll(() => tts.length).toBeGreaterThanOrEqual(4);

  const pieces = tts.map((r) => r.postDataJSON().text as string);
  const first = pieces[0].split(' ');
  expect(first.length).toBeLessThanOrEqual(12); // the opening words, not the 19-word sentence
  expect(first.length).toBeGreaterThanOrEqual(8);
  expect(pieces.join(' ')).toBe(reply); // nothing skipped, nothing said twice
});
