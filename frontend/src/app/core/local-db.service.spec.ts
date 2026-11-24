import { TestBed } from '@angular/core/testing';

import { LocalDbService, RETENTION_DAYS } from './local-db.service';

/** In the unit-test browser there is no IndexedDB, so this exercises the localStorage fallback. */
describe('LocalDbService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  const fresh = () => {
    TestBed.resetTestingModule();
    return TestBed.inject(LocalDbService);
  };

  it('stores, reads back, lists and deletes each record', async () => {
    const db = fresh();
    await db.put('conversation', [{ text: 'hi' }]);
    await db.put('my-voice', { base: 'uk-east' });
    expect(await fresh().get('conversation')).toEqual([{ text: 'hi' }]);
    expect(db.records().map((r) => r.key).sort()).toEqual(['conversation', 'my-voice']);
    await db.delete('my-voice');
    expect(await db.get('my-voice')).toBeNull();
    expect(db.records().map((r) => r.key)).toEqual(['conversation']);
  });

  it('deletes everything at once', async () => {
    const db = fresh();
    await db.put('conversation', [1]);
    await db.put('memory', { note: 'x' });
    await db.clear();
    expect(db.records()).toEqual([]);
    expect(await fresh().get('conversation')).toBeNull();
  });

  it(`deletes anything unused for ${RETENTION_DAYS} days when Ellie next opens`, async () => {
    const old = Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    localStorage.setItem('ellie.db.conversation', JSON.stringify({ key: 'conversation', value: [1], updatedAt: old }));
    localStorage.setItem('ellie.db.my-voice', JSON.stringify({ key: 'my-voice', value: { base: 'x' }, updatedAt: Date.now() }));
    const db = fresh();
    expect(await db.get('conversation')).toBeNull();
    expect(await db.get('my-voice')).toEqual({ base: 'x' });
    expect(localStorage.getItem('ellie.db.conversation')).toBeNull();
  });
});
