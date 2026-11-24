import { Injectable, signal } from '@angular/core';

/** What Ellie keeps, all of it in this browser only. */
export type RecordKey = 'conversation' | 'memory' | 'my-voice';

export interface StoredRecord<T = unknown> {
  key: RecordKey;
  value: T;
  /** When it was last written (ms since 1970). */
  updatedAt: number;
}

const DB_NAME = 'ellie';
const STORE = 'records';
const FALLBACK_PREFIX = 'ellie.db.';
/** Anything not touched for this long is deleted the next time Ellie opens. */
export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Ellie's local database: one IndexedDB store in the user's own browser, holding the conversation,
 * the long-chat memory note and the "my voice" fingerprint. Nothing personal is kept on the server.
 *
 * Every record carries its last-written time; on start-up, records older than 30 days are deleted.
 * `records` is a live list for the "Your data" panel, and every record can be deleted on its own or
 * all together. Where IndexedDB is unavailable (some private windows, tests) the same records live in
 * localStorage, with the same expiry and deletion.
 */
@Injectable({ providedIn: 'root' })
export class LocalDbService {
  /** Everything stored right now (for the Your data panel). */
  readonly records = signal<StoredRecord[]>([]);
  /** Where the records live: 'indexeddb', 'localstorage' (fallback) or 'none' (storage blocked). */
  readonly backend = signal<'indexeddb' | 'localstorage' | 'none'>('none');

  private readonly ready: Promise<IDBDatabase | null> = this.open();

  async get<T>(key: RecordKey): Promise<T | null> {
    const db = await this.ready;
    const record = db ? await this.request<StoredRecord<T>>(db, 'readonly', (s) => s.get(key)) : this.fallbackGet<T>(key);
    return record?.value ?? null;
  }

  async put<T>(key: RecordKey, value: T): Promise<void> {
    const record: StoredRecord<T> = { key, value, updatedAt: Date.now() };
    const db = await this.ready;
    if (db) await this.request(db, 'readwrite', (s) => s.put(record));
    else this.fallbackPut(record);
    await this.refresh();
  }

  async delete(key: RecordKey): Promise<void> {
    const db = await this.ready;
    if (db) await this.request(db, 'readwrite', (s) => s.delete(key));
    else this.fallbackDelete(key);
    await this.refresh();
  }

  /** Delete everything Ellie has stored in this browser. */
  async clear(): Promise<void> {
    const db = await this.ready;
    if (db) await this.request(db, 'readwrite', (s) => s.clear());
    for (const key of ['conversation', 'memory', 'my-voice'] as RecordKey[]) this.fallbackDelete(key);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const db = await this.ready;
    const all = db
      ? (await this.request<StoredRecord[]>(db, 'readonly', (s) => s.getAll())) ?? []
      : (['conversation', 'memory', 'my-voice'] as RecordKey[]).map((k) => this.fallbackGet(k)).filter((r) => !!r);
    this.records.set(all as StoredRecord[]);
  }

  // --- set-up and expiry ---------------------------------------------------------------------
  private async open(): Promise<IDBDatabase | null> {
    let db: IDBDatabase | null = null;
    try {
      if (typeof indexedDB !== 'undefined') {
        db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('blocked'));
        });
        this.backend.set('indexeddb');
      }
    } catch {
      db = null;
    }
    if (!db) this.backend.set(this.fallbackWorks() ? 'localstorage' : 'none');
    await this.expire(db);
    return db;
  }

  private async expire(db: IDBDatabase | null): Promise<void> {
    const cutoff = Date.now() - RETENTION_MS;
    if (db) {
      const all = (await this.request<StoredRecord[]>(db, 'readonly', (s) => s.getAll())) ?? [];
      for (const r of all.filter((r) => r.updatedAt < cutoff)) await this.request(db, 'readwrite', (s) => s.delete(r.key));
      this.records.set(all.filter((r) => r.updatedAt >= cutoff));
    } else {
      const kept: StoredRecord[] = [];
      for (const key of ['conversation', 'memory', 'my-voice'] as RecordKey[]) {
        const r = this.fallbackGet(key);
        if (r && r.updatedAt < cutoff) this.fallbackDelete(key);
        else if (r) kept.push(r);
      }
      this.records.set(kept);
    }
  }

  private request<T>(db: IDBDatabase, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
    return new Promise((resolve) => {
      try {
        const req = op(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  // --- localStorage fallback -----------------------------------------------------------------
  private fallbackWorks(): boolean {
    try {
      localStorage.setItem(FALLBACK_PREFIX + 'test', '1');
      localStorage.removeItem(FALLBACK_PREFIX + 'test');
      return true;
    } catch {
      return false;
    }
  }

  private fallbackGet<T>(key: RecordKey): StoredRecord<T> | null {
    try {
      const r = JSON.parse(localStorage.getItem(FALLBACK_PREFIX + key) ?? 'null') as StoredRecord<T> | null;
      return r && typeof r.updatedAt === 'number' ? r : null;
    } catch {
      return null;
    }
  }

  private fallbackPut(record: StoredRecord): void {
    try {
      localStorage.setItem(FALLBACK_PREFIX + record.key, JSON.stringify(record));
    } catch {
      /* storage blocked: kept for this visit only */
    }
  }

  private fallbackDelete(key: RecordKey): void {
    try {
      localStorage.removeItem(FALLBACK_PREFIX + key);
    } catch {
      /* nothing was kept */
    }
  }
}
