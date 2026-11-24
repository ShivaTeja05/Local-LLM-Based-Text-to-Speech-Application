// Real browser smoke test for a tagged backend URL or the Vercel frontend.
// node deploy/cloudrun/smoke-comparison.cjs <url> [result.json] [screenshot.png] [short|default]
const { chromium, expect } = require('../../frontend/node_modules/@playwright/test');
const fs = require('node:fs');

(async () => {
  const url = process.argv[2];
  const mode = process.argv[5] ?? 'short';
  if (!url || !/^https?:\/\//.test(url)) throw new Error('Supply the demo URL');
  if (!['short', 'default'].includes(mode)) throw new Error('Unknown comparison mode');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(120_000);
    const errors = [];
    const sent = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().endsWith('/api/chat/stream')) sent.push(request.postDataJSON());
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const api = await page.evaluate(() => window.ELLIE_API_BASE || location.origin);
    const response = await page.request.get(api + '/api/health', { timeout: 120_000 });
    expect(response.ok()).toBeTruthy();
    const health = await response.json();
    expect(health.llm.model).toBe('llama3.2:3b');
    expect(health.llm.models).toEqual(['llama3.2:3b', 'ellie-british']);
    expect(health.comparison.version).toBe(1);
    await page.getByRole('button', { name: 'Compare models', exact: true }).click();
    await page.getByLabel('Comparison', { exact: true }).selectOption(mode);
    await expect(page.getByRole('cell', { name: '86.7%', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Compare replies', exact: true }).click();
    await expect(page.locator('.reply-card[data-state="done"]')).toHaveCount(2, { timeout: 120_000 });
    expect(sent.map(r => r.model)).toEqual(['llama3.2:3b', 'ellie-british']);
    for (const request of sent) {
      expect(request.prompt_style).toBe(mode);
      expect(request.seed).toBe(1000);
      expect(request.messages).toEqual([{ role: 'user', content: 'How are you?' }]);
      expect(request.memory).toBeUndefined();
    }
    const results = [];
    const voices = [];
    for (const name of ['Standard', 'Fine-tuned v2']) {
      const card = page.getByRole('article', { name: name + ' comparison reply', exact: true });
      const text = await card.locator('.reply-text').innerText();
      expect(text.length).toBeGreaterThan(0);
      results.push({ model: name, text, metrics: await card.locator('dl').innerText() });
      const speech = page.waitForRequest(r => r.url().endsWith('/api/tts') &&
        text.includes(r.postDataJSON().text.trim()));
      await card.getByRole('button', { name: 'Play reply', exact: true }).click();
      const audio = await (await speech).response();
      expect(audio).not.toBeNull();
      expect(audio.status()).toBe(200);
      expect((await audio.body()).subarray(0, 4).toString()).toBe('RIFF');
      voices.push(audio.request().postDataJSON().voice ?? 'server-default');
    }
    expect(voices[0]).toBe(voices[1]);
    expect(errors).toEqual([]);
    if (process.argv[4]) await page.screenshot({ path: process.argv[4] });
    const result = { url, api, health, mode, results, playbackVoice: voices[0], pageErrors: errors,
      matchedMessageAndSeed: true, checkedAt: new Date().toISOString() };
    if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
