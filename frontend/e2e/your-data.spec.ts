import { expect, test } from '@playwright/test';

import { composer, finishedReplies } from './helpers';

const sse = (text: string) =>
  `event: token\ndata: ${JSON.stringify({ t: text })}\n\n` +
  `event: done\ndata: ${JSON.stringify({ text, truncated: false, model: 'llama3.2:3b', turns_dropped: 0, prompt_tokens: 10 })}\n\n`;

/** What the browser's own database (IndexedDB) holds for Ellie. */
const stored = (page: import('@playwright/test').Page) => page.evaluate(() => new Promise<string[]>((resolve) => {
  const req = indexedDB.open('ellie');
  req.onsuccess = () => {
    const tx = req.result.transaction('records', 'readonly').objectStore('records').getAllKeys();
    tx.onsuccess = () => resolve((tx.result as string[]).sort());
  };
}));

test('Your data lists what is stored in the browser database, and each item can be deleted', async ({ page }) => {
  await page.route('**/api/chat/stream', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('Lovely to hear from you.') }));
  await page.goto('/');
  await page.getByRole('switch', { name: 'Speak replies aloud' }).first().click(); // quiet, quicker
  await composer(page).fill('Hello Ellie');
  await composer(page).press('Enter');
  await expect(finishedReplies(page)).toHaveCount(1);
  await expect.poll(() => stored(page)).toEqual(['conversation']); // kept in IndexedDB, not on the server

  // Survives closing the tab: a reload reads it back from the database.
  await page.reload();
  await expect(finishedReplies(page)).toHaveCount(1);

  await page.locator('.sidebar').getByRole('button', { name: 'Your data & privacy' }).click();
  const panel = page.getByRole('dialog', { name: 'Your data' });
  await expect(panel).toContainText("this browser's built-in database (IndexedDB)");
  await expect(panel.getByRole('listitem').filter({ hasText: 'Conversation' })).toContainText('2 messages');
  await panel.getByRole('button', { name: 'Delete: Conversation' }).click();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Conversation' })).toHaveCount(0);
  await expect.poll(() => stored(page)).toEqual([]);
  await expect(finishedReplies(page)).toHaveCount(0);

  // Delete everything needs a second click.
  await panel.getByRole('button', { name: 'Delete everything' }).click();
  await expect(panel.getByRole('button', { name: 'Click again to delete everything' })).toBeVisible();
  await panel.getByRole('button', { name: 'Click again to delete everything' }).click();
  await expect(page.getByRole('switch', { name: 'Speak replies aloud' }).first()).toHaveAttribute('aria-checked', 'true'); // preferences reset
  await panel.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(finishedReplies(page)).toHaveCount(0);
});
