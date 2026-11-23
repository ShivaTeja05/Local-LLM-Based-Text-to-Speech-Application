import { expect, test } from '@playwright/test';

import { finishedReplies, say } from './helpers';

/** The Standard / Fine-tuned switch: only shown when the server has the LoRA model installed. */
test('model switch sends the fine-tuned model and the reply says which answered', async ({ page, request }) => {
  const health = await (await request.get('/api/health')).json();
  const models: string[] = health.llm.models ?? [];
  test.skip(models.length < 2, 'the fine-tuned model is not installed (training/ollama/install.sh)');

  const sent: (string | undefined)[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/chat/stream')) sent.push(JSON.parse(r.postData() ?? '{}').model);
  });
  await page.goto('/');
  const group = page.getByRole('radiogroup', { name: 'Model' });
  await expect(group.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');

  await group.getByRole('radio', { name: 'Fine-tuned' }).click();
  await expect(page.getByText(/LoRA adapter trained on Ellie's style/)).toBeVisible();
  const text = await say(page, 'How are you?');
  expect(text.length).toBeGreaterThan(0);
  expect(sent.at(-1)).toBe(models[1]);

  await page.reload(); // the choice is remembered
  await expect(page.getByRole('radiogroup', { name: 'Model' }).getByRole('radio', { name: 'Fine-tuned' }))
    .toHaveAttribute('aria-checked', 'true');

  await page.getByRole('radiogroup', { name: 'Model' }).getByRole('radio', { name: 'Standard' }).click();
  await say(page, 'And what about you?');
  expect(sent.at(-1)).toBeUndefined(); // the default model is not named in the request
  await expect(finishedReplies(page)).toHaveCount(2);
});
