import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ApiService } from './api.service';
import { ModelComparisonService } from './model-comparison.service';
import { ChatEvent } from './models';
import { StatusService } from './status.service';

describe('ModelComparisonService', () => {
  const models = ['llama3.2:3b', 'ellie-british'];
  let calls: { history: unknown; memory: unknown; model: string; options: unknown }[];
  let script: (model: string, signal: AbortSignal) => AsyncGenerator<ChatEvent>;
  let service: ModelComparisonService;
  let health: ReturnType<typeof signal<any>>;

  beforeEach(() => {
    calls = [];
    health = signal({ llm: { ok: true }, comparison: { version: 1 } });
    script = async function* (model) {
      yield { type: 'token', text: 'Hello.' };
      yield { type: 'done', text: 'Hello.', model, turnsDropped: 0, truncated: false, promptTokens: 50 };
    };
    TestBed.configureTestingModule({ providers: [ModelComparisonService,
      { provide: StatusService, useValue: { health, models: signal(models) } },
      { provide: ApiService, useValue: {
        streamChat(history: unknown, signal: AbortSignal, memory: unknown, model: string, options: unknown) {
          calls.push({ history, memory, model, options });
          return script(model, signal);
        },
      } },
    ] });
    service = TestBed.inject(ModelComparisonService);
  });

  it('isolates histories and gives both models the same seed and prompt mode; alternates order', async () => {
    await service.run('Hello there', 'short');
    expect(calls.map(c => c.model)).toEqual(models);
    for (const call of calls) {
      expect(call.history).toEqual([{ role: 'user', text: 'Hello there' }]);
      expect(call.memory).toBeUndefined();
      expect(call.options).toEqual({ promptStyle: 'short', seed: 1000 });
    }
    expect(service.replies().every(r => r.state === 'done' && r.promptTokens === 50)).toBe(true);
    await service.run('A fresh message', 'default');
    expect(calls.slice(2).map(c => c.model)).toEqual([...models].reverse());
    expect(calls[2].options).toEqual({ promptStyle: 'default', seed: 1001 });
    expect(calls[2].history).toEqual([{ role: 'user', text: 'A fresh message' }]);
  });

  it('reports incomplete streams as errors and still tries the other model', async () => {
    script = async function* (model) {
      yield { type: 'token', text: 'Partial' };
      if (model === models[1]) yield { type: 'done', text: 'Complete.', model,
        turnsDropped: 0, truncated: false };
    };
    await service.run('Hi', 'short');
    expect(service.replies().map(r => r.state)).toEqual(['error', 'done']);
    expect(service.busy()).toBe(false);
  });

  it('stopping a running comparison prevents the queued model and a second run', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    script = async function* () { yield { type: 'token', text: 'Partial' }; await gate; };
    const run = service.run('Hi', 'short');
    await Promise.resolve();
    await service.run('Ignored while busy', 'short');
    service.cancel(); release();
    await run;
    expect(calls.length).toBe(1);
    expect(service.replies().map(r => r.state)).toEqual(['stopped', 'stopped']);
    expect(service.busy()).toBe(false);
  });

  it('does not claim controlled comparison support on an older backend', async () => {
    health.set({ llm: { ok: true } });
    await service.run('Hi', 'short');
    expect(calls.length).toBe(0);
  });
});
