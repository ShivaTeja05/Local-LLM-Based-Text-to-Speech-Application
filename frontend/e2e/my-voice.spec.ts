import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composer, finishedReplies, storedRecord } from './helpers';

/**
 * Use my voice, end to end with no human: a regional voice reads the passage into Chrome's fake
 * microphone, the backend makes a voice fingerprint from it, and Ellie then answers in that voice.
 */
test('record my voice with consent, hear replies in it, then delete it', async ({ playwright, request, baseURL }) => {
  test.setTimeout(150_000);
  const config = await (await request.get('/config.js')).text();
  const api = /ELLIE_API_BASE\s*=\s*["']([^"']*)["']/.exec(config)?.[1] ?? '';
  const health = await (await request.get(`${api}/api/health`)).json();
  test.skip(!health.clone?.ok, 'Use my voice is not available on this server');

  // "The user": the Birmingham voice reading the passage (about 12 s).
  const wav = await request.post(`${api}/api/tts`, {
    data: {
      voice: 'uk-midlands',
      text: 'The North Wind and the Sun were disputing which was the stronger, when a traveller came along ' +
        'wrapped in a warm cloak. They agreed that the one who first succeeded in making the traveller take ' +
        'his cloak off should be considered stronger than the other.',
    },
  });
  expect(wav.ok()).toBe(true);
  const file = join(tmpdir(), `ellie-myvoice-${Date.now()}.wav`);
  writeFileSync(file, await wav.body());

  const browser = await playwright.chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}%noloop`, '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
    const sidebar = page.locator('.sidebar');
    await page.goto('/');
    await sidebar.getByRole('button', { name: 'Use my voice' }).click();

    const dialog = page.getByRole('dialog', { name: 'Hear yourself speak British English' });
    await expect(dialog).toBeVisible();
    const start = dialog.getByRole('button', { name: 'Start recording' });
    await expect(start).toBeDisabled(); // no recording without consent
    await dialog.getByRole('checkbox').check();
    await start.click();
    await expect(dialog.getByText(/Recording 0:0\d/)).toBeVisible();
    await page.waitForTimeout(14_000); // the reading lasts about 12 s
    await dialog.getByRole('button', { name: 'Done reading' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });

    // My voice now exists, is selected, and is matched to the closest British voice.
    const mine = sidebar.getByRole('radio', { name: /^My voice/ });
    await expect(mine).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.subline')).toContainText('in your own voice');
    const stored = (await storedRecord<{ base: string; fingerprint: string }>(page, 'my-voice'))!; // in the browser's database
    expect(stored.base).toBe('uk-midlands');
    expect(stored.fingerprint.length).toBe(1368);

    // Replies are spoken through the converter: each speech request carries the fingerprint.
    const tts: { voice?: string; fingerprint?: string }[] = [];
    page.on('request', (r) => r.url().endsWith('/api/tts') && tts.push(r.postDataJSON()));
    await composer(page).fill('How are you today?');
    await composer(page).press('Enter');
    await expect(finishedReplies(page)).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator('app-avatar.portrait')).toHaveClass(/is-speaking/, { timeout: 30_000 });
    expect(tts.length).toBeGreaterThan(0);
    expect(tts.every((b) => b.voice === 'uk-midlands' && b.fingerprint === stored.fingerprint)).toBe(true);

    // Delete: gone from the list and from storage, back to the default voice.
    await sidebar.getByRole('button', { name: 'Delete my voice' }).click();
    await expect(mine).toHaveCount(0);
    await expect.poll(() => storedRecord(page, 'my-voice')).toBeNull();
    await expect(page.locator('.subline')).not.toContainText('your own voice');
  } finally {
    await browser.close();
  }
});

test('upload an existing recording to make my voice', async ({ page, request }) => {
  test.setTimeout(90_000);
  const config = await (await request.get('/config.js')).text();
  const api = /ELLIE_API_BASE\s*=\s*["']([^"']*)["']/.exec(config)?.[1] ?? '';
  const health = await (await request.get(`${api}/api/health`)).json();
  test.skip(!health.clone?.ok, 'Use my voice is not available on this server');
  // A recording of "someone": the Suffolk voice, saved as a WAV file.
  const wav = await request.post(`${api}/api/tts`, {
    data: { voice: 'uk-east', text: 'Hello, I grew up on the Suffolk coast, near Southwold. On a sunny day there is ' +
      'nothing better than a walk along the beach, past the colourful huts, and then fish and chips on the pier. ' +
      'In the winter the wind off the North Sea is bitterly cold, so I wrap up warm and head to the pub by the harbour.' },
  });
  await page.goto('/');
  const sidebar = page.locator('.sidebar');
  await sidebar.getByRole('button', { name: 'Use my voice' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hear yourself speak British English' });
  await expect(dialog.getByRole('button', { name: 'Upload a recording' })).toBeDisabled(); // consent first
  await dialog.getByRole('checkbox').check();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'me.wav', mimeType: 'audio/wav', buffer: await wav.body() });
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(sidebar.getByRole('radio', { name: /^My voice/ })).toHaveAttribute('aria-checked', 'true');
  const stored = (await storedRecord<{ base: string; fingerprint: string }>(page, 'my-voice'))!; // in the browser's database
  expect(stored.base).toBe('uk-east'); // matched to the closest British voice
});

test('a file that is not audio is refused with a clear message', async ({ page }) => {
  await page.goto('/');
  const sidebar = page.locator('.sidebar');
  test.skip(!(await sidebar.getByRole('button', { name: 'Use my voice' }).isVisible()), 'Use my voice is not available');
  await sidebar.getByRole('button', { name: 'Use my voice' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hear yourself speak British English' });
  await dialog.getByRole('checkbox').check();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(dialog.getByRole('alert')).toContainText('Please choose an audio file');
});
