import { expect, test } from '@playwright/test';

import { composer, finishedReplies, noHorizontalScroll, replies, say, stageLine, trackTts } from './helpers';

test.describe('Ellie: desktop, real backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Running privately')).toBeVisible();
  });

  test('first screen: greeting, live status, voices, starters', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening)\.$/);
    await expect(page.getByText(/Ellie runs privately, with .+ and the Southern England voice, with no cloud AI services\./)).toBeVisible();
    // Five regional English accents: South (default), North, Midlands, East and West.
    const voices = page.getByRole('radiogroup', { name: 'Voice' }).getByRole('radio');
    await expect(voices).toHaveCount(5);
    for (const region of ['South', 'North', 'Midlands', 'East', 'West']) {
      await expect(page.getByRole('radiogroup', { name: 'Voice' }).getByText(new RegExp(`^${region} ·`))).toBeVisible();
    }
    await expect(page.getByRole('radio', { name: /^Southern England/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Speak replies aloud' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'How are you?' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Ellie, your conversation partner' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await noHorizontalScroll(page);
  });

  test('the brief example: written reply, spoken sentence by sentence, lips move', async ({ page }) => {
    const tts = trackTts(page);
    await page.getByRole('button', { name: 'How are you?' }).click();

    await expect(page.locator('li.msg.user')).toHaveText('How are you?');
    await expect(stageLine(page)).toHaveText('Speaking');

    // Lip-sync: the mouth takes many different shapes per second while speech plays.
    const sync = await page.evaluate(async () => {
      const shapes = new Set<string>();
      let maxLevel = 0;
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const tick = () => {
          shapes.add(document.querySelector('.mouth')!.getAttribute('d')!);
          const m = /scaleX\(([\d.]+)\)/.exec((document.querySelector('.meter span') as HTMLElement).style.transform);
          maxLevel = Math.max(maxLevel, m ? Number(m[1]) : 0);
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      return { shapes: shapes.size, maxLevel };
    });
    expect(sync.shapes).toBeGreaterThan(20);
    expect(sync.maxLevel).toBeGreaterThan(0.2);

    const reply = finishedReplies(page).first();
    await expect(reply).toBeVisible();
    const text = await reply.locator('.reply').innerText();
    expect(text).toMatch(/[.!?]$/);
    expect(text).not.toMatch(/[*#`]/);

    // One speech request per sentence, each with the text of that sentence.
    await expect.poll(() => tts.length).toBeGreaterThanOrEqual(1);
    const spoken = tts.map((r) => r.postDataJSON().text as string);
    expect(text.replace(/\s+/g, ' ')).toContain(spoken[0]);

    // When speech ends, the stage goes back to rest and ▶ Play is offered.
    await expect(stageLine(page)).toHaveText('Ready when you are', { timeout: 45_000 });
    await expect(reply.getByRole('button', { name: 'Play this reply' })).toBeVisible();
  });

  test('replay uses the cached audio: no new speech requests', async ({ page }) => {
    const tts = trackTts(page);
    await say(page, 'Say hello in one short sentence.');
    await expect(stageLine(page)).toHaveText('Ready when you are', { timeout: 45_000 });
    const requests = tts.length;
    expect(requests).toBeGreaterThan(0);

    await finishedReplies(page).last().getByRole('button', { name: 'Play this reply' }).click();
    await expect(stageLine(page)).toHaveText('Speaking');
    expect(tts.length).toBe(requests);

    // ■ Stop on the reply stops it.
    await finishedReplies(page).last().getByRole('button', { name: 'Stop this reply' }).click();
    await expect(stageLine(page)).toHaveText('Ready when you are');
  });

  test('"Stop speaking" on the stage stops the voice', async ({ page }) => {
    await page.getByRole('button', { name: "What's a nice way to spend a rainy Sunday?" }).click();
    await expect(stageLine(page)).toHaveText('Speaking');
    await page.getByRole('button', { name: 'Stop speaking' }).click();
    await expect(page.getByRole('button', { name: 'Stop speaking' })).toBeHidden();
  });

  test('speech off: the reply is written but never spoken', async ({ page }) => {
    const tts = trackTts(page);
    const toggle = page.getByRole('switch', { name: 'Speak replies aloud' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(stageLine(page)).toHaveText('Ready · speech is off');

    await say(page, 'How are you?');
    await page.waitForTimeout(500);
    expect(tts.length).toBe(0);

    // The setting survives a reload.
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Speak replies aloud' })).toHaveAttribute('aria-checked', 'false');

    // ▶ Play still works on demand.
    await finishedReplies(page).last().getByRole('button', { name: 'Play this reply' }).click();
    await expect.poll(() => tts.length).toBeGreaterThan(0);
  });

  test('choosing a voice changes the voice used for speech', async ({ page }) => {
    const tts = trackTts(page);
    await page.getByRole('radio', { name: /^Birmingham/ }).click();
    await expect(page.getByText(/and the Birmingham voice, /)).toBeVisible();
    await say(page, 'Hello!');
    await expect.poll(() => tts.length).toBeGreaterThan(0);
    expect(tts.every((r) => r.postDataJSON().voice === 'uk-midlands')).toBe(true);
  });

  test('voice preview plays a short sample in that voice', async ({ page }) => {
    const tts = trackTts(page);
    await page.getByRole('button', { name: 'Preview Newcastle' }).click();
    await expect.poll(() => tts.length).toBe(1);
    expect(tts[0].postDataJSON()).toEqual({ text: 'Hello, this is the Newcastle voice. Lovely to meet you.', voice: 'uk-north' });
  });

  test('remembers the conversation: follow-up questions use the history', async ({ page }) => {
    await say(page, 'My name is Priya. Please remember it.');
    const answer = await say(page, 'What is my name?');
    expect(answer.toLowerCase()).toContain('priya');
  });

  test('keyboard: Enter sends, Shift+Enter adds a line', async ({ page }) => {
    const box = composer(page);
    await box.fill('First line');
    await box.press('Shift+Enter');
    await box.pressSequentially('second line');
    await expect(box).toHaveValue('First line\nsecond line');
    await expect(page.locator('li.msg.user')).toHaveCount(0);
    await box.press('Enter');
    await expect(page.locator('li.msg.user')).toHaveText('First line\nsecond line');
    await expect(box).toHaveValue('');
  });

  test('the conversation survives a reload; New conversation clears it', async ({ page }) => {
    await say(page, 'Hi there!');
    await page.reload();
    await expect(replies(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page.getByText('Say hello to start')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Say hello to start')).toBeVisible();
  });

  test('backend unreachable mid-chat: friendly error, then Try again works', async ({ page }) => {
    await page.route('**/api/chat/stream', (route) => route.abort('connectionrefused'));
    await composer(page).fill('Are you there?');
    await composer(page).press('Enter');
    const failed = page.locator('li.msg.ellie[data-state="error"]');
    await expect(failed).toContainText("can't reach my brain");
    await expect(stageLine(page)).toHaveText('Something went wrong');

    await page.unroute('**/api/chat/stream');
    await failed.getByRole('button', { name: 'Try again' }).click();
    await expect(finishedReplies(page)).toHaveCount(1);
    await expect(page.locator('li.msg.user')).toHaveCount(1); // the question is not duplicated
  });

  test('speech failing does not break the conversation', async ({ page }) => {
    await page.route('**/api/tts', (route) => route.fulfill({ status: 500, body: '{"detail":"Speech synthesis failed"}' }));
    const text = await say(page, 'Hello!');
    expect(text.length).toBeGreaterThan(0);
    await expect(stageLine(page)).toHaveText('Ready when you are', { timeout: 15_000 });
  });

  test('message length is limited to 500 characters', async ({ page }) => {
    await composer(page).fill('x'.repeat(600));
    await expect(composer(page)).toHaveValue('x'.repeat(500));
    await expect(page.getByText('0 left')).toBeVisible();
  });

  test('appearance: dark and light themes switch and persist', async ({ page }) => {
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).not.toBe(lightBg);
  });

  test('tablet width folds the sidebar into a top bar', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Settings' })).toBeHidden();
    await noHorizontalScroll(page);
  });
});

test('backend offline on load: the screen says so and how to fix it', async ({ page }) => {
  await page.route('**/api/health', (route) => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByText(/can't reach her backend/)).toBeVisible();
  await expect(page.getByText('Backend offline')).toBeVisible();
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Running privately')).toBeVisible();
});
