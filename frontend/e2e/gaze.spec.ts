import { Page, expect, test } from '@playwright/test';

import { composer, finishedReplies } from './helpers';

/** The eyes' current offset in SVG units, read from the transform the avatar sets. */
async function eyes(page: Page): Promise<{ x: number; y: number }> {
  const transform = (await page.locator('app-avatar.portrait .eyes').getAttribute('transform')) ?? '';
  const [x, y] = (/translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform) ?? ['', '0', '0']).slice(1).map(Number);
  return { x, y };
}

test('Ellie watches the pointer and typing while quiet, and looks at the user while speaking', async ({ page }) => {
  await page.goto('/');
  const avatar = page.locator('app-avatar.portrait');
  await expect(avatar).toBeVisible();
  const box = (await avatar.boundingBox())!;
  const eyeY = box.y + box.height * (116 / 240);

  // Pointer far to the left, then far to the right of her face.
  await page.mouse.move(2, eyeY);
  await expect.poll(async () => (await eyes(page)).x).toBeLessThan(-3);
  await page.mouse.move(1430, eyeY);
  await expect.poll(async () => (await eyes(page)).x).toBeGreaterThan(3);
  // Pointer below her: she looks down.
  await page.mouse.move(box.x + box.width / 2, 895);
  await expect.poll(async () => (await eyes(page)).y).toBeGreaterThan(2);

  // Typing: she glances at the message box (to her right and below, on a desktop layout).
  await page.mouse.move(2, 2);
  await composer(page).pressSequentially('How are you?');
  await expect.poll(async () => (await eyes(page)).x).toBeGreaterThan(0);

  // Speaking: she looks straight out at the user, whatever the pointer does.
  await composer(page).press('Enter');
  await expect(avatar).toHaveClass(/is-speaking/, { timeout: 30_000 });
  await page.mouse.move(2, eyeY);
  await page.waitForTimeout(100);
  expect(await page.locator('app-avatar.portrait .eyes').getAttribute('transform')).toBe('translate(0 0)');

  // Quiet again: she follows the pointer once more.
  await expect(finishedReplies(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(avatar).toHaveClass(/is-idle/, { timeout: 60_000 });
  await page.mouse.move(1430, eyeY);
  await expect.poll(async () => (await eyes(page)).x).toBeGreaterThan(3);
});
