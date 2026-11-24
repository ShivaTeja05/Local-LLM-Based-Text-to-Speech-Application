import { Page, expect, test } from '@playwright/test';

import { composer, finishedReplies } from './helpers';

/** A reply streamed like the real backend, after `delay` ms of "thinking". */
async function replyWith(page: Page, text: string, delay = 0): Promise<void> {
  await page.unroute('**/api/chat/stream');
  await page.route('**/api/chat/stream', async (r) => {
    if (delay) await new Promise((ok) => setTimeout(ok, delay));
    const body = text.split(/(?<= )/).map((t) => `event: token\ndata: ${JSON.stringify({ t })}\n\n`).join('') +
      `event: done\ndata: ${JSON.stringify({ text, truncated: false, model: 'llama3.2:3b', turns_dropped: 0, prompt_tokens: 10 })}\n\n`;
    await r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
}

const avatar = (page: Page) => page.locator('app-avatar.portrait');

async function send(page: Page, message: string): Promise<void> {
  await composer(page).fill(message);
  await composer(page).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(avatar(page)).toHaveClass(/waving/); // the hello once she is ready...
  await expect(avatar(page)).not.toHaveClass(/waving/, { timeout: 6_000 }); // ...is over
  await page.waitForTimeout(500);
});

test('while you type she leans in and nods along', async ({ page }) => {
  await composer(page).pressSequentially('I have been thinking about ', { delay: 20 });
  await expect(avatar(page)).toHaveClass(/is-listening/);
  await expect(avatar(page)).toHaveClass(/nod-(a|b)/);
});

test('she reacts to what you say: laughs, cheers, comforts', async ({ page }) => {
  test.setTimeout(90_000);
  await replyWith(page, 'Ha, that is a good one.', 1500);
  await send(page, 'hahaha that is hilarious');
  await expect(avatar(page)).toHaveClass(/laughing/);
  await expect(finishedReplies(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(avatar(page)).toHaveClass(/is-idle/, { timeout: 30_000 });

  await replyWith(page, 'That is wonderful news.', 1500);
  await send(page, 'I passed my driving test!');
  await expect(avatar(page)).toHaveClass(/cheering/);
  await expect(finishedReplies(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(avatar(page)).toHaveClass(/is-idle/, { timeout: 30_000 });

  await replyWith(page, 'I am so sorry.', 1500);
  await send(page, 'My grandad passed away last week.');
  await expect(avatar(page)).toHaveClass(/comforting/); // not "cheering": passed away is sad news
});

test('a hand to her chin while she thinks, a thumbs up for praise and a shrug when unsure', async ({ page }) => {
  test.setTimeout(90_000);
  await replyWith(page, 'Well done, that is brilliant. Hmm, I am not entirely sure about the rest.', 2500);
  await send(page, 'Tell me what you think of my plan');
  await expect(avatar(page)).toHaveClass(/pondering/, { timeout: 2_400 });
  await expect(avatar(page)).toHaveClass(/thumbs-up/, { timeout: 30_000 });
  await expect(avatar(page)).toHaveClass(/shrugging/, { timeout: 30_000 });
});
