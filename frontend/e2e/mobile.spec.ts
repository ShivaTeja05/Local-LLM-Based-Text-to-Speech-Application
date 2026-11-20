import { expect, test } from '@playwright/test';

import { noHorizontalScroll, say, stageLine } from './helpers';

test.describe('Ellie: phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('top bar replaces the sidebar; settings open in a sheet', async ({ page }) => {
    await expect(page.getByRole('complementary', { name: 'Settings' })).toBeHidden();
    await page.getByRole('button', { name: 'Open settings' }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('radio', { name: /^Cori/ })).toBeVisible();
    await sheet.getByRole('button', { name: 'Close settings' }).click();
    await expect(sheet).toBeHidden();
    await noHorizontalScroll(page);
  });

  test('speech toggle in the top bar', async ({ page }) => {
    const toggle = page.getByRole('banner').getByRole('switch', { name: 'Speak replies aloud' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(stageLine(page)).toHaveText('Ready · speech is off');
  });

  test('a full turn works at phone size, with the composer in reach', async ({ page }) => {
    const text = await say(page, 'How are you?');
    expect(text.length).toBeGreaterThan(0);
    const box = await page.getByRole('textbox', { name: 'Message Ellie' }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await noHorizontalScroll(page);
  });
});
