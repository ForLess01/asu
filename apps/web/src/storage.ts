import { emptyWorkspace, parseWorkspace, type Workspace } from '../../../packages/domain/src/index';
import { z } from 'zod';
import { workspaceSchema } from '../../../packages/domain/src/index';
import type { AccountRecord } from './account-sync';

export type StorageKey = 'guest' | 'example';
export const tabId = crypto.randomUUID();
export class ConflictError extends Error { constructor() { super('local-conflict'); } }
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('asu-household-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
    request.onerror = () => reject(new Error('storage-unavailable'));
    request.onblocked = () => reject(new Error('storage-blocked'));
    request.onsuccess = () => resolve(request.result);
  });
  return connection;
}

export async function readWorkspace(key: StorageKey): Promise<Workspace> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspaces', 'readonly');
    const request = transaction.objectStore('workspaces').get(key);
    request.onerror = () => reject(new Error('storage-unavailable'));
    request.onsuccess = () => {
      try { resolve(request.result === undefined ? emptyWorkspace() : parseWorkspace(request.result)); }
      catch { reject(new Error('storage-corrupt')); }
    };
  });
}

/** Compare-and-swap is inside one IDB transaction, including between tabs. */
export async function writeWorkspace(key: StorageKey, next: Workspace, expectedRevision: number): Promise<void> {
  const serialized = JSON.stringify(next);
  parseWorkspace(serialized);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('workspaces', 'readwrite');
    const store = transaction.objectStore('workspaces');
    const request = store.get(key);
    let conflict = false;
    request.onsuccess = () => {
      try {
        const previousRevision = request.result === undefined ? 0 : parseWorkspace(request.result).revision;
        if (previousRevision !== expectedRevision) { conflict = true; transaction.abort(); return; }
        store.put(serialized, key);
      } catch { transaction.abort(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(conflict ? new ConflictError() : new Error('storage-write-failed'));
    transaction.onerror = () => reject(new Error('storage-write-failed'));
  });
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('asu-updates') : null;
  channel?.postMessage({ key, revision: next.revision, sender: tabId }); channel?.close();
}

const accountRecordSchema = z.object({ state: workspaceSchema,
  remote: z.object({ id: z.uuid(), revision: z.number().int().positive() }).nullable(),
  pending: z.boolean(), syncedAt: z.iso.datetime({ offset: true }).nullable(),
});

export async function readAccount(identity: string): Promise<AccountRecord | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('workspaces', 'readonly').objectStore('workspaces').get(`account:${identity}`);
    request.onerror = () => reject(new Error('storage-unavailable'));
    request.onsuccess = () => {
      try { resolve(request.result === undefined ? null : accountRecordSchema.parse(JSON.parse(request.result))); }
      catch { reject(new Error('storage-corrupt')); }
    };
  });
}

/** Workspace and pending/server-revision metadata commit together, never as separate writes. */
export async function writeAccount(identity: string, value: AccountRecord, expectedRevision: number | null): Promise<void> {
  const record = accountRecordSchema.parse(value), db = await database(), key = `account:${identity}`;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('workspaces', 'readwrite'), store = transaction.objectStore('workspaces');
    const request = store.get(key); let conflict = false;
    request.onsuccess = () => {
      try {
        const previous = request.result === undefined ? null : accountRecordSchema.parse(JSON.parse(request.result));
        if ((previous?.state.revision ?? null) !== expectedRevision) { conflict = true; transaction.abort(); return; }
        store.put(JSON.stringify(record), key);
      } catch { transaction.abort(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(conflict ? new ConflictError() : new Error('storage-write-failed'));
    transaction.onerror = () => reject(new Error('storage-write-failed'));
  });
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('asu-updates') : null;
  channel?.postMessage({ key, revision: record.state.revision, sender: tabId }); channel?.close();
}

/** Explicit recovery only: callers confirm before replacing unreadable data. */
export async function recoverWorkspace(key: StorageKey): Promise<Workspace> {
  const db = await database(), state = emptyWorkspace();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('workspaces', 'readwrite');
    transaction.objectStore('workspaces').put(JSON.stringify(state), key);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new Error('storage-write-failed'));
  });
  return state;
}

export function downloadWorkspace(state: Workspace): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `asu-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
