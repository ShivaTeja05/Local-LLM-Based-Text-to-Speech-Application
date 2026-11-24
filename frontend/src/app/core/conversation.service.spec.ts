import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ApiService } from './api.service';
import { AudioPlayerService } from './audio-player.service';
import { BUSY_REPLY, ConversationService, OFFLINE_REPLY } from './conversation.service';
import { ApiError } from './api.service';
import { ChatEvent, ChatMessage, Memory } from './models';
import { SettingsService } from './settings.service';
import { StatusService } from './status.service';

type Script = (signal: AbortSignal) => AsyncGenerator<ChatEvent>;

class FakeApi {
  script: Script = async function* () {
    yield { type: 'token', text: "I'm very " };
    yield { type: 'token', text: 'well, thank you. ' };
    yield { type: 'token', text: 'How are you?' };
    yield { type: 'done', text: "I'm very well, thank you. How are you?", truncated: false, model: 'm', turnsDropped: 0 };
  };
  ttsCalls: { text: string; voice: string | null }[] = [];
  histories: Pick<ChatMessage, 'role' | 'text'>[][] = [];
  memoriesSent: (Memory | undefined)[] = [];
  modelsSent: (string | null | undefined)[] = [];
  memoryCalls: { memory: Memory; upto: number }[] = [];

  streamChat(history: Pick<ChatMessage, 'role' | 'text'>[], signal: AbortSignal, memory?: Memory, model?: string | null) {
    this.histories.push(history);
    this.memoriesSent.push(memory);
    this.modelsSent.push(model);
    return this.script(signal);
  }
  memory(_history: unknown, memory: Memory, upto: number) {
    this.memoryCalls.push({ memory, upto });
    return Promise.resolve({ note: `The user said ${upto} things.`, turns: upto });
  }
  tts(text: string, voice: string | null) {
    this.ttsCalls.push({ text, voice });
    return Promise.resolve(new ArrayBuffer(8));
  }
}

class FakePlayer {
  speakingId = signal<string | null>(null);
  log: string[] = [];
  played: Promise<ArrayBuffer>[][] = [];
  resumeAudio() { this.log.push('resumeAudio'); }
  begin(id: string) { this.log.push('begin'); this.speakingId.set(id); }
  enqueue() { this.log.push('enqueue'); }
  end() { this.log.push('end'); this.speakingId.set(null); }
  stop() { this.log.push('stop'); this.speakingId.set(null); }
  play(id: string, clips: Promise<ArrayBuffer>[]) { this.log.push('play'); this.played.push(clips); this.speakingId.set(id); }
}

describe('ConversationService', () => {
  let api: FakeApi;
  let player: FakePlayer;
  let service: ConversationService;
  let settings: SettingsService;

  function setup(): void {
    api = new FakeApi();
    player = new FakePlayer();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AudioPlayerService, useValue: player },
      ],
    });
    service = TestBed.inject(ConversationService);
    settings = TestBed.inject(SettingsService);
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setup();
  });

  const replies = () => service.messages().filter((m) => m.role === 'assistant');

  it('streams the reply and speaks it sentence by sentence, in order', async () => {
    await service.send('  How are you?  ');
    const [user, reply] = service.messages();
    expect(user).toMatchObject({ role: 'user', text: 'How are you?', state: 'done' });
    expect(reply).toMatchObject({ role: 'assistant', text: "I'm very well, thank you. How are you?", state: 'done' });
    expect(api.ttsCalls.map((c) => c.text)).toEqual(["I'm very well, thank you.", 'How are you?']);
    expect(player.log.slice(0, 3)).toEqual(['resumeAudio', 'stop', 'begin']);
    expect(player.log.filter((l) => l === 'enqueue').length).toBe(2);
    expect(player.log.at(-1)).toBe('end');
    expect(service.generating()).toBe(false);
  });

  it('sends the chosen voice with every speech request', async () => {
    settings.voiceId.set('en_GB-alan-medium');
    await service.send('Hello');
    expect(api.ttsCalls.every((c) => c.voice === 'en_GB-alan-medium')).toBe(true);
  });

  it('with speech off, writes the reply but never calls TTS', async () => {
    settings.speechEnabled.set(false);
    await service.send('How are you?');
    expect(replies()[0].state).toBe('done');
    expect(api.ttsCalls).toEqual([]);
    expect(player.log).not.toContain('begin');
  });

  it('does not speak an ending the server trimmed off', async () => {
    api.script = async function* () {
      yield { type: 'token', text: 'Lovely. ' };
      yield { type: 'token', text: 'And then the' };
      yield { type: 'done', text: 'Lovely.', truncated: true, model: 'm', turnsDropped: 0 };
    };
    await service.send('Tell me more');
    expect(replies()[0].text).toBe('Lovely.');
    expect(api.ttsCalls.map((c) => c.text)).toEqual(['Lovely.']);
  });

  it('shows the server fallback on an error event and stops speech', async () => {
    api.script = async function* () {
      yield { type: 'error', code: 'llm_unavailable', message: 'Sorry, trouble thinking.' };
    };
    await service.send('Hi');
    expect(replies()[0]).toMatchObject({ state: 'error', text: 'Sorry, trouble thinking.' });
    expect(player.log).toContain('stop');
  });

  it('shows an offline message when the request itself fails', async () => {
    api.script = async function* () {
      throw new TypeError('Failed to fetch');
    };
    await service.send('Hi');
    expect(replies()[0]).toMatchObject({ state: 'error', text: OFFLINE_REPLY });
  });

  it('says so when rate limited, instead of the offline message', async () => {
    api.script = async function* () {
      throw new ApiError('Too many requests: please wait a moment and try again.', 429);
    };
    await service.send('Hi');
    expect(replies()[0]).toMatchObject({ state: 'error', text: BUSY_REPLY });
  });

  it('stop keeps the partial reply and marks it stopped', async () => {
    api.script = async function* (signal) {
      yield { type: 'token', text: 'Well, let me think' };
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    };
    const pending = service.send('Long question');
    await new Promise((r) => setTimeout(r));
    expect(service.generating()).toBe(true);
    service.stopGenerating();
    await pending;
    expect(replies()[0]).toMatchObject({ state: 'stopped', text: 'Well, let me think' });
    expect(service.generating()).toBe(false);
  });

  it('replays cached speech without new requests, and re-synthesises for a new voice', async () => {
    await service.send('How are you?');
    const id = replies()[0].id;
    expect(api.ttsCalls.length).toBe(2);

    service.togglePlay(id);
    expect(api.ttsCalls.length).toBe(2); // cached
    expect(player.played.length).toBe(1);

    service.togglePlay(id); // playing → stop
    expect(player.log.at(-1)).toBe('stop');

    settings.voiceId.set('en_GB-alan-medium');
    service.togglePlay(id);
    expect(api.ttsCalls.length).toBe(4);
    expect(api.ttsCalls.slice(2).every((c) => c.voice === 'en_GB-alan-medium')).toBe(true);
  });

  it('can play a reply that was written while speech was off', async () => {
    settings.speechEnabled.set(false);
    await service.send('How are you?');
    service.togglePlay(replies()[0].id);
    expect(api.ttsCalls.length).toBe(2);
    expect(player.log).toContain('play');
  });

  it('sends the whole transcript but leaves failed replies out', async () => {
    api.script = async function* () {
      yield { type: 'error', code: 'llm_error', message: 'Oops' };
    };
    await service.send('First');
    api.script = new FakeApi().script;
    await service.send('Second');
    expect(api.histories[1].map((m) => `${m.role}:${m.text}`)).toEqual(['user:First', 'user:Second']);
  });

  it('retry removes the failed turn and sends the question again', async () => {
    api.script = async function* () {
      yield { type: 'error', code: 'llm_error', message: 'Oops' };
    };
    await service.send('Are you there?');
    api.script = new FakeApi().script;
    service.retry(replies()[0].id);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(service.messages().map((m) => m.text)).toEqual(['Are you there?', "I'm very well, thank you. How are you?"]);
  });

  it('ignores empty input and input while a reply is generating', async () => {
    await service.send('   ');
    expect(service.messages()).toEqual([]);
  });

  it('caps a message at 500 characters', async () => {
    await service.send('x'.repeat(600));
    expect(service.messages()[0].text.length).toBe(500);
  });

  it('sends the chosen model only while the server offers it', async () => {
    const status = TestBed.inject(StatusService);
    const health = (models: string[]) => ({
      status: 'ok' as const,
      llm: { ok: true, backend: 'ollama', model: 'llama3.2:3b', models },
      tts: { ok: true, engine: 'piper', voices: 4 },
    });
    settings.model.set('ellie-british');
    status.health.set(health(['llama3.2:3b', 'ellie-british']));
    await service.send('Hello');
    status.health.set(health(['llama3.2:3b'])); // the fine-tune was removed
    await service.send('Hello again');
    expect(api.modelsSent).toEqual(['ellie-british', null]);
  });

  it('makes no memory note while nothing has been dropped', async () => {
    await service.send('How are you?');
    expect(api.memoryCalls).toEqual([]);
    expect(service.memory()).toEqual({ note: '', turns: 0 });
  });

  it('folds dropped turns into the memory note, then sends the note with later messages', async () => {
    const dropping = (n: number) => async function* () {
      yield { type: 'done' as const, text: 'Right you are.', truncated: false, model: 'm', turnsDropped: n };
    };
    api.script = dropping(6);
    await service.send('Tell me more');
    await new Promise((r) => setTimeout(r));
    expect(api.memoryCalls).toEqual([{ memory: { note: '', turns: 0 }, upto: 6 }]);
    expect(service.memory()).toEqual({ note: 'The user said 6 things.', turns: 6 });

    await service.send('And then?'); // still 6 dropped: note reused, no new memory call
    await new Promise((r) => setTimeout(r));
    expect(api.memoriesSent.at(-1)).toEqual({ note: 'The user said 6 things.', turns: 6 });
    expect(api.memoryCalls.length).toBe(1);

    service.reset();
    expect(service.memory()).toEqual({ note: '', turns: 0 });
  });

  it('keeps the conversation in the local database across a refresh, and new conversation deletes it', async () => {
    const settle = () => new Promise((r) => setTimeout(r, 0)); // writes finish in the background
    await service.send('How are you?');
    await settle();
    TestBed.resetTestingModule();
    setup(); // a fresh service reads the local database
    await service.loaded;
    expect(service.messages().length).toBe(2);
    service.reset();
    await settle();
    expect(service.messages()).toEqual([]);
    TestBed.resetTestingModule();
    setup();
    await service.loaded;
    expect(service.messages()).toEqual([]); // deleted, not just hidden
  });
});
