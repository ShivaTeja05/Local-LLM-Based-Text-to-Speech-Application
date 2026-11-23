import { expect, test } from '@playwright/test';

import { composer, finishedReplies } from './helpers';

/** A fixed reply (greeting, statement, question) streamed like the real backend; speech is real. */
const REPLY = 'Hello there! I am doing very well today, thank you for asking me. Windermere is lovely in autumn, with the trees turning gold. How is your week going?';
const sse = (text: string) =>
  text.split(/(?<= )/).map((t) => `event: token\ndata: ${JSON.stringify({ t })}\n\n`).join('') +
  `event: done\ndata: ${JSON.stringify({ text, truncated: false, model: 'llama3.2:3b', turns_dropped: 0, prompt_tokens: 10 })}\n\n`;

test('body language: waves, a nod per sentence, hands while talking, brows up on a question', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/api/chat/stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(REPLY) }));
  await page.goto('/');
  const avatar = page.locator('app-avatar.portrait');

  // She waves once she is ready, then lowers her hand.
  await expect(avatar).toHaveClass(/waving/);
  await expect(avatar).not.toHaveClass(/waving/, { timeout: 5_000 });
  await page.waitForTimeout(2_600);

  await composer(page).fill('Hi Ellie');
  await composer(page).press('Enter');

  // Sentence 1 says hello (and is her first reply): a nod and a wave.
  await expect(avatar).toHaveClass(/is-speaking/, { timeout: 30_000 });
  await expect(avatar).toHaveClass(/nod-a/);
  await expect(avatar).toHaveClass(/waving/);
  // Sentence 2: the nod tilts the other way.
  await expect(avatar).toHaveClass(/nod-b/, { timeout: 15_000 });
  // Sentence 3 is a longer statement: an explaining hand.
  await expect(avatar).toHaveClass(/presenting/, { timeout: 15_000 });
  // Sentence 4 is a question: an open palm, and brows up while she asks it.
  const brow = page.locator('app-avatar.portrait .brow').first();
  await expect(avatar).toHaveClass(/offering/, { timeout: 15_000 });
  await expect(brow).toHaveAttribute('transform', 'translate(0 -6)');
  await expect(finishedReplies(page)).toHaveCount(1);
  await expect(avatar).toHaveClass(/is-idle/, { timeout: 15_000 });
  await expect(brow).not.toHaveAttribute('transform', 'translate(0 -6)');
});

test('New conversation gets a hello wave; the voice list faces stay still', async ({ page }) => {
  await page.goto('/');
  const avatar = page.locator('app-avatar.portrait');
  await expect(avatar).toHaveClass(/waving/); // the hello once she is ready
  await expect(avatar).not.toHaveClass(/waving/, { timeout: 5_000 });
  await page.waitForTimeout(2_600);
  await page.locator('.sidebar').getByRole('button', { name: 'New conversation' }).click();
  await expect(avatar).toHaveClass(/waving/);
  expect(await page.locator('.sidebar app-avatar.waving').count()).toBe(0);
});

test('her brows follow the feeling of each sentence as she says it', async ({ page }) => {
  test.setTimeout(90_000);
  const reply = "Wow, that is amazing news! Oh, I'm so sorry to hear about your cat. " +
    "Hmm, I'm not entirely sure about that. Please make sure you stay safe out there.";
  await page.route('**/api/chat/stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(reply) }));
  await page.goto('/');
  await composer(page).fill('Some news');
  await composer(page).press('Enter');
  const left = page.locator('app-avatar.portrait .brow').first();
  const right = page.locator('app-avatar.portrait .brow').last();
  await expect(left).toHaveAttribute('transform', 'translate(0 -8)', { timeout: 30_000 }); // surprised: both up
  await expect(left).toHaveAttribute('transform', /^rotate\(-12 92 100\)/, { timeout: 15_000 }); // sorry: inner ends up
  await expect(right).toHaveAttribute('transform', /^rotate\(12 148 100\)/);
  await expect(left).toHaveAttribute('transform', /^translate\(0 -6\) rotate\(-5/, { timeout: 15_000 }); // hmm: one brow up
  await expect(right).toHaveAttribute('transform', 'translate(0 1)');
  await expect(left).toHaveAttribute('transform', /^rotate\(8 92 100\)/, { timeout: 15_000 }); // serious: a slight frown
});
