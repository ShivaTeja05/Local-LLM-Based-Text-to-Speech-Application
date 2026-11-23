import { Page, expect, test } from '@playwright/test';

import { finishedReplies, say } from './helpers';

/**
 * Natural pauses, measured in the real browser: every Web Audio clip's start time and length is
 * recorded, and the silence between one sentence ending and the next starting is checked.
 */
type Played = { at: number; seconds: number };

async function recordPlayback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const played: { at: number; seconds: number }[] = [];
    (window as unknown as { __played: typeof played }).__played = played;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when?: number, ...rest: number[]) {
      const delay = when ? Math.max(0, when - this.context.currentTime) : 0;
      played.push({ at: performance.now() + delay * 1000, seconds: this.buffer?.duration ?? 0 });
      return start.call(this, when, ...rest);
    };
  });
}

async function speechGaps(page: Page): Promise<{ gaps: number[]; breaths: number }> {
  // Wait until the whole reply has been spoken.
  await expect(page.locator('#stage-line')).not.toHaveText(/Speaking|Getting ready/, { timeout: 60_000 });
  const played = await page.evaluate(() => (window as unknown as { __played: Played[] }).__played);
  const breaths = played.filter((p) => Math.abs(p.seconds - 0.32) < 0.005).length;
  const speech = played.filter((p) => Math.abs(p.seconds - 0.32) >= 0.005).sort((a, b) => a.at - b.at);
  const gaps = speech.slice(1).map((p, i) => p.at - (speech[i].at + speech[i].seconds * 1000));
  return { gaps, breaths };
}

const ASK = 'In three or four sentences, tell me why the British love tea.';

test('sentences are separated by natural pauses, and the switch turns them off', async ({ page }) => {
  test.setTimeout(150_000);
  await recordPlayback(page);
  await page.goto('/');
  const pauses = page.getByRole('switch', { name: 'Natural pauses and breaths' });
  await expect(pauses).toHaveAttribute('aria-checked', 'true'); // on by default

  await say(page, ASK);
  const on = await speechGaps(page);
  test.skip(on.gaps.length < 1, 'the reply was a single sentence, so there was nothing to pause between');
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`pauses on: gaps ${on.gaps.map(Math.round).join(', ')} ms, ${on.breaths} breath(s)`);
  expect(median(on.gaps)).toBeGreaterThanOrEqual(140);
  expect(Math.max(...on.gaps)).toBeLessThan(1200);

  await pauses.click();
  await expect(pauses).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(() => ((window as unknown as { __played: Played[] }).__played.length = 0));
  await say(page, ASK);
  const off = await speechGaps(page);
  console.log(`pauses off: gaps ${off.gaps.map(Math.round).join(', ')} ms, ${off.breaths} breath(s)`);
  expect(off.breaths).toBe(0);
  if (off.gaps.length) expect(median(off.gaps)).toBeLessThan(median(on.gaps));
  await expect(finishedReplies(page)).toHaveCount(2);
});
