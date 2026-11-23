import { expect, test } from '@playwright/test';

import { composer, finishedReplies } from './helpers';

/** A fixed reply (greeting, statement, question) streamed like the real backend; speech is real. */
const REPLY = 'Hello there, lovely to see you! I am doing very well today. How about you, how is your week going?';
const sse = (text: string) =>
  text.split(/(?<= )/).map((t) => `event: token\ndata: ${JSON.stringify({ t })}\n\n`).join('') +
  `event: done\ndata: ${JSON.stringify({ text, truncated: false, model: 'llama3.2:3b', turns_dropped: 0, prompt_tokens: 10 })}\n\n`;

test('body language: a hello wave, a nod per sentence, and raised brows on a question', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/api/chat/stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(REPLY) }));
  await page.goto('/');
  const avatar = page.locator('app-avatar.portrait');

  // She waves when the page opens, then lowers her hand.
  await expect(avatar).toHaveClass(/waving/);
  await expect(avatar).not.toHaveClass(/waving/, { timeout: 5_000 });
  await page.waitForTimeout(2_600);

  await composer(page).fill('Hi Ellie');
  await composer(page).press('Enter');

  // Sentence 1 says hello: a nod and a wave.
  await expect(avatar).toHaveClass(/is-speaking/, { timeout: 30_000 });
  await expect(avatar).toHaveClass(/nod-a/);
  await expect(avatar).toHaveClass(/waving/);
  // Sentence 2: the nod tilts the other way.
  await expect(avatar).toHaveClass(/nod-b/, { timeout: 15_000 });
  // Sentence 3 is a question: brows up while she asks it.
  const brow = page.locator('app-avatar.portrait .brow').first();
  await expect(brow).toHaveAttribute('transform', 'translate(0 -4.5)', { timeout: 15_000 });
  await expect(finishedReplies(page)).toHaveCount(1);
  await expect(avatar).toHaveClass(/is-idle/, { timeout: 15_000 });
  await expect(brow).not.toHaveAttribute('transform', 'translate(0 -4.5)');
});

test('New conversation gets a hello wave; the voice list faces stay still', async ({ page }) => {
  await page.goto('/');
  const avatar = page.locator('app-avatar.portrait');
  await expect(avatar).toHaveClass(/waving/); // the hello on opening the page
  await expect(avatar).not.toHaveClass(/waving/, { timeout: 5_000 });
  await page.waitForTimeout(2_600);
  await page.locator('.sidebar').getByRole('button', { name: 'New conversation' }).click();
  await expect(avatar).toHaveClass(/waving/);
  expect(await page.locator('.sidebar app-avatar.waving').count()).toBe(0);
});
