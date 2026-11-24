import { expect, test } from '@playwright/test';

import { noHorizontalScroll, storedRecord } from './helpers';

test('recorded results stay visible when only the standard model is available', async ({ page }) => {
  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    const health = await response.json();
    health.llm.models = ['llama3.2:3b'];
    await route.fulfill({ response, json: health });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Compare models', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded evaluation' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '86.7%', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare replies', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
});

test('live comparison uses isolated same-prompt seeded requests, and can play either reply', async ({ page, request }) => {
  const health = await (await request.get('/api/health')).json();
  test.skip(!health.comparison || !health.llm.models?.includes('ellie-british'), 'comparison backend and v2 model required');
  const sent: any[] = [];
  let speechCalls = 0;
  page.on('request', r => {
    if (r.url().endsWith('/api/chat/stream')) sent.push(JSON.parse(r.postData() ?? '{}'));
    if (r.url().endsWith('/api/tts')) speechCalls++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Compare models', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message for both models' }).fill('How are you?');
  await page.getByRole('button', { name: 'Compare replies', exact: true }).click();
  await expect(page.locator('.reply-card[data-state="done"]')).toHaveCount(2);
  expect(sent.map(r => r.model)).toEqual(['llama3.2:3b', 'ellie-british']);
  for (const r of sent) {
    expect(r.messages).toEqual([{ role: 'user', content: 'How are you?' }]);
    expect(r.prompt_style).toBe('short');
    expect(r.seed).toBe(1000);
    expect(r.memory).toBeUndefined();
  }
  expect(await storedRecord(page, 'conversation')).toBeNull();
  await page.getByRole('article', { name: 'Fine-tuned v2 comparison reply' }).getByRole('button', { name: 'Play reply' }).click();
  await expect.poll(() => speechCalls).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Ellie' })).toBeVisible();
});
