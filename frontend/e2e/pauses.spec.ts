import { Page, expect, test } from '@playwright/test';

import { finishedReplies, say } from './helpers';

/**
 * Natural pauses, measured in the real browser: every Web Audio clip's start time and length is
 * recorded, and the silence between one sentence ending and the next starting is checked.
 */
type Played = { at: number; seconds: number; lead: number; trail: number };

async function recordPlayback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const played: { at: number; seconds: number; lead: number; trail: number }[] = [];
    (window as unknown as { __played: typeof played }).__played = played;
    // Silence inside the clip itself (ms), so the gap a listener hears can be worked out.
    const quiet = (b: AudioBuffer | null) => {
      if (!b) return { lead: 0, trail: 0 };
      const d = b.getChannelData(0), win = Math.round(b.sampleRate * 0.01);
      const loud = (i: number) => { let s = 0; for (let k = i; k < i + win && k < d.length; k++) s += d[k] * d[k]; return Math.sqrt(s / win) > 0.01; };
      let a = 0; while (a < d.length && !loud(a)) a += win;
      let z = d.length - win; while (z > a && !loud(z)) z -= win;
      return { lead: (a / b.sampleRate) * 1000, trail: ((d.length - z - win) / b.sampleRate) * 1000 };
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when?: number, ...rest: number[]) {
      const delay = when ? Math.max(0, when - this.context.currentTime) : 0;
      played.push({ at: performance.now() + delay * 1000, seconds: this.buffer?.duration ?? 0, ...quiet(this.buffer) });
      return start.call(this, when, ...rest);
    };
  });
}

async function speechGaps(page: Page): Promise<{ gaps: number[]; heard: number[]; breaths: number }> {
  // Wait until the whole reply has been spoken.
  await expect(page.locator('#stage-line')).not.toHaveText(/Speaking|Getting ready/, { timeout: 60_000 });
  const played = await page.evaluate(() => (window as unknown as { __played: Played[] }).__played);
  const breaths = played.filter((p) => Math.abs(p.seconds - 0.32) < 0.005).length;
  const speech = played.filter((p) => Math.abs(p.seconds - 0.32) >= 0.005).sort((a, b) => a.at - b.at);
  const gaps = speech.slice(1).map((p, i) => p.at - (speech[i].at + speech[i].seconds * 1000));
  // What a listener hears: the gap plus the silence at the end of one clip and the start of the next.
  const heard = gaps.map((g, i) => g + speech[i].trail + speech[i + 1].lead);
  return { gaps, heard, breaths };
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
  console.log(`pauses on: heard ${on.heard.map(Math.round).join(', ')} ms, ${on.breaths} breath(s)`);
  // Human-sized and even: every silence a listener hears is between the tiny gap after a phrase cut
  // early (so it flows on) and a long sentence pause (each clip's own random silence is trimmed).
  expect(Math.min(...on.heard)).toBeGreaterThanOrEqual(80);
  expect(Math.max(...on.heard)).toBeLessThan(900);

  await pauses.click();
  await expect(pauses).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(() => ((window as unknown as { __played: Played[] }).__played.length = 0));
  await say(page, ASK);
  const off = await speechGaps(page);
  console.log(`pauses off: heard ${off.heard.map(Math.round).join(', ')} ms, ${off.breaths} breath(s)`);
  expect(off.breaths).toBe(0);
  if (off.gaps.length) expect(median(off.gaps)).toBeLessThan(median(on.gaps));
  await expect(finishedReplies(page)).toHaveCount(2);
});
