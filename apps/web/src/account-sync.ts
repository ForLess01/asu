import { emptyWorkspace, parseWorkspace, type Workspace } from '../../../packages/domain/src/index';
import type { CloudIdentity, CloudSnapshot } from './cloud';

export type RemoteVersion = Pick<CloudSnapshot, 'id' | 'revision'>;
export type AccountRecord = { state: Workspace; remote: RemoteVersion | null; pending: boolean; syncedAt: string | null };
export type SyncStatus = 'guest' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict';
export type SyncView = { identity: CloudIdentity | null; record: AccountRecord | null; status: SyncStatus };
type Dependencies = {
  read: (identity: string) => Promise<AccountRecord | null>;
  write: (identity: string, record: AccountRecord, expectedLocalRevision: number | null) => Promise<void>;
  fetch: (identity: string) => Promise<CloudSnapshot | null>;
  push: (state: Workspace, baseline: RemoteVersion | null, identity: string) => Promise<RemoteVersion>;
};

/** One account owns one durable local queue. Network responses never select an account. */
export class AccountSync {
  view: SyncView = { identity: null, record: null, status: 'guest' };
  private listeners = new Set<(view: SyncView) => void>();
  private epoch = 0;
  private online = true;
  private ready = false;
  private operations: Promise<unknown> = Promise.resolve();
  private connecting: Promise<void> | null = null;
  private reading: { epoch: number; promise: Promise<void> } | null = null;
  private uploading: { epoch: number; promise: Promise<void> } | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  constructor(private readonly dependencies: Dependencies) {}
  subscribe = (listener: (view: SyncView) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(update: Partial<SyncView>) { this.view = { ...this.view, ...update }; this.listeners.forEach(listener => listener(this.view)); }
  private current(epoch: number) { return epoch === this.epoch && !!this.view.identity; }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operations.then(action); this.operations = result.catch(() => undefined); return result;
  }
  private status(status: SyncStatus) { this.emit({ status }); }
  private cancelRetry() { clearTimeout(this.retry); this.retry = undefined; }
  dispose() { this.epoch++; this.cancelRetry(); this.ready = false; this.connecting = null; this.view = { identity: null, record: null, status: 'guest' }; }
  setOnline(online: boolean) {
    this.online = online;
    if (!online) { this.cancelRetry(); if (this.view.identity) this.status('offline'); }
    else if (this.view.identity) void this.refresh();
  }
  async connect(identity: CloudIdentity | null, guest?: Workspace): Promise<void> {
    if (identity?.id && this.view.identity?.id === identity.id) {
      if (identity.name !== this.view.identity.name || identity.email !== this.view.identity.email) this.emit({ identity });
      if (this.connecting) await this.connecting; else if (!this.ready) await this.refresh();
      return;
    }
    const epoch = ++this.epoch; this.cancelRetry(); this.ready = false; this.attempts = 0;
    this.emit({ identity, record: null, status: identity ? 'loading' : 'guest' });
    if (!identity) return;
    const task = (async () => {
      try {
        await this.operations;
        const stored = await this.dependencies.read(identity.id);
        if (!this.current(epoch)) return;
        // Guest data is adopted only after Neon proves the account has no remote plan.
        this.emit({ record: stored });
        if (!this.online) {
          if (!stored) await this.store(epoch, { state: emptyWorkspace(), remote: null, pending: false, syncedAt: null }, null);
          this.status('offline'); return;
        }
        await this.refresh(guest);
      } catch { if (this.current(epoch)) this.status('error'); }
    })();
    this.connecting = task;
    await task;
    if (epoch === this.epoch) this.connecting = null;
  }
  private async store(epoch: number, record: AccountRecord, expected: number | null) {
    if (!this.current(epoch)) return;
    const id = this.view.identity!.id;
    await this.dependencies.write(id, record, expected);
    if (this.current(epoch)) this.emit({ record });
  }
  async save(next: Workspace, expectedIdentity = this.view.identity?.id): Promise<void> {
    const epoch = this.epoch;
    await this.serial(async () => {
      if (!this.current(epoch) || !this.view.record || this.view.identity?.id !== expectedIdentity) throw new Error('account-unavailable');
      const before = this.view.record;
      if (next.revision !== before.state.revision + 1) throw new Error('local-conflict');
      const state = parseWorkspace(JSON.stringify({ ...next, id: before.state.id }));
      await this.store(epoch, { ...before, state, pending: true }, before.state.revision);
      if (this.current(epoch)) this.status(this.online ? this.view.status === 'conflict' ? 'conflict' : 'syncing' : 'offline');
    });
    if (this.current(epoch) && this.online && this.view.status !== 'conflict') void this.flush();
  }
  private async adopt(epoch: number, remote: CloudSnapshot | null, guest?: Workspace) {
    const before = this.view.record;
    const state = remote ? parseWorkspace(JSON.stringify(remote.payload)) : guest?.household ? parseWorkspace(JSON.stringify({ ...guest, id: crypto.randomUUID() })) : emptyWorkspace();
    // Local revisions order browser writes, independently from server revisions.
    state.revision = Math.max(state.revision, (before?.state.revision ?? -1) + 1);
    await this.store(epoch, { state, remote: remote ? { id: remote.id, revision: remote.revision } : null,
      pending: !remote && !!guest?.household, syncedAt: remote ? new Date().toISOString() : null }, before?.state.revision ?? null);
  }
  async refresh(guest?: Workspace): Promise<void> {
    const epoch = this.epoch;
    if (!this.current(epoch) || !this.online) return;
    if (this.uploading?.epoch === epoch) { await this.uploading.promise; return; }
    if (this.reading?.epoch === epoch) return this.reading.promise;
    const task = (async () => {
      try {
        const remote = await this.dependencies.fetch(this.view.identity!.id);
        await this.serial(async () => {
          if (!this.current(epoch)) return;
          const before = this.view.record;
          if (before?.pending) {
            const sameVersion = (before.remote?.revision ?? 0) === (remote?.revision ?? 0) && (!before.remote || before.remote.id === remote?.id);
            const alreadySaved = remote && JSON.stringify(remote.payload) === JSON.stringify(before.state);
            if (alreadySaved) await this.store(epoch, { ...before, remote: { id: remote.id, revision: remote.revision }, pending: false, syncedAt: new Date().toISOString() }, before.state.revision);
            else if (!sameVersion) { this.ready = false; this.status('conflict'); return; }
          } else if (before?.remote && !remote) { this.ready = false; this.status('conflict'); return; }
          else if (!before || before.remote?.id !== remote?.id || before.remote?.revision !== remote?.revision) await this.adopt(epoch, remote, before ? undefined : guest);
          if (!this.current(epoch)) return;
          this.ready = true;
          if (!this.view.record?.pending) this.attempts = 0;
          this.status(this.online ? this.view.record?.pending ? 'syncing' : 'synced' : 'offline');
        });
      } catch { if (this.current(epoch)) { this.ready = false; this.status(this.online ? 'error' : 'offline'); this.scheduleRetry(epoch); } }
    })();
    this.reading = { epoch, promise: task };
    await task;
    if (this.reading?.epoch === epoch) this.reading = null;
    if (this.current(epoch) && this.ready && this.view.record?.pending) void this.flush();
  }
  flush(): Promise<void> {
    const epoch = this.epoch;
    if (!this.current(epoch) || !this.online || this.view.status === 'conflict') return Promise.resolve();
    if (!this.ready) return this.refresh();
    if (this.uploading?.epoch === epoch) return this.uploading.promise;
    const task = (async () => {
      while (this.current(epoch) && this.online && this.view.record?.pending) {
        const sent = this.view.record, identity = this.view.identity!.id;
        try {
          const remote = await this.dependencies.push(sent.state, sent.remote, identity);
          await this.serial(async () => {
            if (!this.current(epoch) || !this.view.record) return;
            const latest = this.view.record;
            await this.store(epoch, { ...latest, remote: { id: remote.id, revision: remote.revision },
              pending: latest.state.revision !== sent.state.revision, syncedAt: new Date().toISOString() }, latest.state.revision);
            if (this.current(epoch)) { this.attempts = 0; this.status(this.online ? this.view.record?.pending ? 'syncing' : 'synced' : 'offline'); }
          });
        } catch (error) {
          if (this.current(epoch)) {
            this.ready = false;
            this.status((error as { code?: string })?.code === '40001' || (error as Error)?.message === 'local-conflict' ? 'conflict' : this.online ? 'error' : 'offline');
            if (this.view.status !== 'conflict') this.scheduleRetry(epoch);
          }
          return;
        }
      }
    })();
    this.uploading = { epoch, promise: task };
    void task.finally(() => { if (this.uploading?.epoch === epoch) this.uploading = null; });
    return task;
  }
  private scheduleRetry(epoch: number) {
    if (!this.online || this.attempts >= 5 || this.retry) return;
    const delay = 1000 * 2 ** this.attempts++;
    this.retry = setTimeout(() => { this.retry = undefined; if (this.current(epoch)) void this.refresh(); }, delay);
  }
  async resolve(choice: 'local' | 'remote'): Promise<void> {
    const epoch = this.epoch;
    if (!this.current(epoch) || !this.online) return;
    this.cancelRetry(); this.ready = false; this.status('loading');
    try {
      const remote = await this.dependencies.fetch(this.view.identity!.id);
      await this.serial(async () => {
        if (!this.current(epoch) || !this.view.record) return;
        const before = this.view.record;
        if (choice === 'remote') await this.adopt(epoch, remote);
        else await this.store(epoch, { ...before, state: { ...before.state, id: remote?.id ?? before.state.id, revision: before.state.revision + 1 },
          remote: remote ? { id: remote.id, revision: remote.revision } : null, pending: true }, before.state.revision);
        if (this.current(epoch)) { this.ready = true; this.status(choice === 'local' ? 'syncing' : 'synced'); }
      });
      if (this.current(epoch) && choice === 'local') await this.flush();
    } catch { if (this.current(epoch)) this.status('error'); }
  }
  async reloadLocal() {
    const epoch = this.epoch;
    if (!this.current(epoch)) return;
    const record = await this.dependencies.read(this.view.identity!.id);
    if (this.current(epoch)) { this.emit({ record }); this.ready = false; await this.refresh(); }
  }
}
