import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composer, finishedReplies } from './helpers';

/**
 * Voice input end to end, with no human: Piper speaks a question into a WAV file, Chrome plays
 * that file as its microphone, Whisper on the backend writes it down, and Ellie answers.
 */
test('push-to-talk: speech is written into the box, then answered', async ({ playwright, request, baseURL }) => {
  test.setTimeout(120_000);
  // The API may live elsewhere (frontend on Vercel, backend on Cloud Run): read it like the app does.
  const config = await (await request.get('/config.js')).text();
  const api = /ELLIE_API_BASE\s*=\s*["']([^"']*)["']/.exec(config)?.[1] ?? '';
  const wav = await request.post(`${api}/api/tts`, {
    data: { text: "What's the capital of Australia?", voice: 'uk-midlands' },
  });
  expect(wav.ok()).toBe(true);
  const file = join(tmpdir(), `ellie-mic-${Date.now()}.wav`);
  writeFileSync(file, await wav.body());

  const browser = await playwright.chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream', // grant the microphone without a prompt
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
    await page.goto('/');
    const mic = page.getByRole('button', { name: 'Talk to Ellie' });
    await expect(mic).toBeVisible();

    await mic.click();
    await expect(page.locator('#stage-line')).toHaveText('Listening to you…');
    await expect(page.getByRole('button', { name: 'Stop recording and write it down' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(4000); // the question is about 2 s long
    await page.getByRole('button', { name: 'Stop recording and write it down' }).click();

    await expect(composer(page)).toHaveValue(/capital of australia/i, { timeout: 30_000 });
    expect(await finishedReplies(page).count()).toBe(0); // nothing is sent until the user says so

    await composer(page).press('Enter');
    // The spoken question is now the user's message, and Ellie answers it. (Whether the answer is
    // right is a question about the model, measured over many samples in training/eval/, not here.)
    await expect(page.locator('li.msg.user').last()).toContainText(/capital of australia/i);
    await expect(finishedReplies(page)).toHaveCount(1, { timeout: 60_000 });
    expect((await finishedReplies(page).first().innerText()).trim().length).toBeGreaterThan(10);
  } finally {
    await browser.close();
  }
});

test('Escape throws a recording away', async ({ playwright, baseURL }) => {
  const browser = await playwright.chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  try {
    const page = await browser.newPage({ baseURL });
    let sttCalls = 0;
    page.on('request', (r) => r.url().endsWith('/api/stt') && sttCalls++);
    await page.goto('/');
    await page.getByRole('button', { name: 'Talk to Ellie' }).click();
    await expect(page.locator('#stage-line')).toHaveText('Listening to you…');
    await composer(page).focus();
    await composer(page).press('Escape');
    await expect(page.getByRole('button', { name: 'Talk to Ellie' })).toHaveAttribute('aria-pressed', 'false');
    await expect(composer(page)).toHaveValue('');
    expect(sttCalls).toBe(0);
  } finally {
    await browser.close();
  }
});
