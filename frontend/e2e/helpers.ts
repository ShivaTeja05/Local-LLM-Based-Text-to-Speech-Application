import { Page, Request, expect } from '@playwright/test';

/** Records every /api/tts request the page makes. */
export function trackTts(page: Page): Request[] {
  const calls: Request[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/tts') && r.method() === 'POST') calls.push(r);
  });
  return calls;
}

export const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Ellie' });
export const replies = (page: Page) => page.locator('li.msg.ellie');
export const finishedReplies = (page: Page) => page.locator('li.msg.ellie[data-state="done"]');
export const stageLine = (page: Page) => page.locator('#stage-line');

/** Type a message, press Enter, and wait until Ellie's reply has finished streaming. */
export async function say(page: Page, text: string): Promise<string> {
  const before = await finishedReplies(page).count();
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await expect(finishedReplies(page)).toHaveCount(before + 1);
  return (await finishedReplies(page).last().locator('.reply').innerText()).trim();
}

export async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** One record from Ellie's local database (IndexedDB "ellie", store "records"), or null. */
export function storedRecord<T = unknown>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => new Promise<T | null>((resolve) => {
    const req = indexedDB.open('ellie');
    req.onsuccess = () => {
      const get = req.result.transaction('records', 'readonly').objectStore('records').get(k);
      get.onsuccess = () => resolve(get.result ? (get.result.value as T) : null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  }), key);
}
