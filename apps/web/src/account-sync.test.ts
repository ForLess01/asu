import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, revise } from '../../../packages/domain/src/index';
import { AccountSync, type AccountRecord, type RemoteVersion } from './account-sync';
import type { CloudSnapshot } from './cloud';

const user = { id: 'a0000000-0000-4000-8000-000000000001', email: 'test@example.com' };
function fixture() {
  const saved = new Map<string, AccountRecord>();
  let remote: { id: string; revision: number; payload: ReturnType<typeof emptyWorkspace> } | null = null;
  const fetch = vi.fn(async () => structuredClone(remote));
  const push = vi.fn(async (state: ReturnType<typeof emptyWorkspace>, baseline: RemoteVersion | null, _identity: string) => {
    if ((baseline?.revision ?? 0) !== (remote?.revision ?? 0)) throw { code: '40001' };
    remote = { id: remote?.id ?? state.id, revision: (remote?.revision ?? 0) + 1, payload: structuredClone(state) };
    return structuredClone(remote);
  });
  const sync = new AccountSync({
    read: async id => structuredClone(saved.get(id) ?? null),
    write: async (id, record, expected) => {
      if ((saved.get(id)?.state.revision ?? null) !== expected) throw new Error('local-conflict');
      saved.set(id, structuredClone(record));
    }, fetch, push,
  });
  return { sync, saved, fetch, push, setRemote: (value: typeof remote) => { remote = value; }, remote: () => remote };
}

describe('account-isolated durable automatic synchronization', () => {
  it('hydrates a signed-in account from Neon without overwriting the guest plan', async () => {
    const f = fixture(), remote = revise(emptyWorkspace(), s => { s.household = { label: 'Remote home', district: 'Pueblo Libre', department: 'LIMA', eps: 'SEDAPAL', occupancy: 4 }; });
    f.setRemote({ id: remote.id, revision: 7, payload: remote });
    const guest = revise(emptyWorkspace(), s => { s.tasks.push({ id: 'guest-task', title: 'Guest only', done: false, dueAt: null }); });
    await f.sync.connect(user, guest);
    expect(f.sync.view.record?.state.household?.label).toBe('Remote home');
    expect(guest.tasks[0].title).toBe('Guest only'); expect(f.push).not.toHaveBeenCalled();
    expect(f.saved.get(user.id)?.remote?.revision).toBe(7);
  });
  it('automatically persists edits with the fetched server revision and excludes identity from payloads', async () => {
    const f = fixture(); await f.sync.connect(user);
    await f.sync.save(revise(f.sync.view.record!.state, s => { s.tasks.push({ id: 'task', title: 'Saved automatically', done: false, dueAt: null }); }));
    await f.sync.flush();
    expect(f.remote()?.payload.tasks[0].title).toBe('Saved automatically');
    expect(f.sync.view.status).toBe('synced'); expect(f.saved.get(user.id)?.pending).toBe(false);
    expect(JSON.stringify(f.remote()?.payload)).not.toContain(user.email);
    expect(f.push.mock.calls[0][2]).toBe(user.id);
  });
  it('keeps offline edits durable across controller reload and uploads after reconnecting', async () => {
    const f = fixture(); await f.sync.connect(user); f.sync.setOnline(false);
    await f.sync.save(revise(f.sync.view.record!.state, s => { s.tasks.push({ id: 'offline', title: 'Offline edit', done: false, dueAt: null }); }));
    expect(f.push).not.toHaveBeenCalled(); expect(f.saved.get(user.id)?.pending).toBe(true);
    f.sync.dispose(); const cached = f.saved.get(user.id)!;
    const g = fixture(); g.saved.set(user.id, cached); await g.sync.connect(user); await g.sync.flush();
    expect(g.remote()?.payload.tasks[0].title).toBe('Offline edit'); expect(g.sync.view.status).toBe('synced');
  });
  it('does not overwrite a newer remote revision after offline edits; resolution is explicit', async () => {
    const f = fixture(); await f.sync.connect(user); f.sync.setOnline(false);
    await f.sync.save(revise(f.sync.view.record!.state, s => { s.tasks.push({ id: 'local', title: 'Local pending', done: false, dueAt: null }); }));
    const remote = revise(emptyWorkspace(), s => { s.tasks.push({ id: 'foreign', title: 'Other device', done: false, dueAt: null }); });
    f.setRemote({ id: remote.id, revision: 3, payload: remote });
    f.sync.setOnline(true); await f.sync.refresh();
    expect(f.sync.view.status).toBe('conflict'); expect(f.push).not.toHaveBeenCalled();
    expect(f.sync.view.record?.state.tasks[0].title).toBe('Local pending');
    await f.sync.resolve('remote'); expect(f.sync.view.record?.state.tasks[0].title).toBe('Other device');
  });
  it('isolates accounts and ignores a late response after the session changes', async () => {
    const f = fixture(); await f.sync.connect(user);
    let finish!: (value: CloudSnapshot) => void;
    f.push.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await f.sync.save(revise(f.sync.view.record!.state, s => { s.tasks.push({ id: 'a', title: 'Account A', done: false, dueAt: null }); }));
    const upload = f.sync.flush();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await f.sync.connect({ id: 'b0000000-0000-4000-8000-000000000002' });
    finish({ id: crypto.randomUUID(), revision: 1, payload: emptyWorkspace() }); await upload;
    expect(f.sync.view.identity?.id).toBe('b0000000-0000-4000-8000-000000000002');
    expect(f.sync.view.record?.state.tasks).toEqual([]); expect(f.saved.get(user.id)?.pending).toBe(true);
  });
  it('keeps a second edit queued when an earlier edit is still uploading', async () => {
    const f = fixture(); await f.sync.connect(user);
    let finish!: () => void;
    f.push.mockImplementationOnce(async (state) => {
      await new Promise<void>(resolve => { finish = resolve; });
      const value = { id: state.id, revision: 1, payload: structuredClone(state) }; f.setRemote(value); return value;
    });
    await f.sync.save(revise(f.sync.view.record!.state, s => { s.tasks.push({ id: 'a', title: 'First', done: false, dueAt: null }); }));
    const upload = f.sync.flush(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await f.sync.save(revise(f.sync.view.record!.state, s => { s.tasks[0].title = 'Second'; }));
    finish(); await upload;
    expect(f.remote()?.payload.tasks[0].title).toBe('Second'); expect(f.remote()?.revision).toBe(2);
    expect(f.sync.view.record?.pending).toBe(false);
  });
  it('recognizes a committed write whose acknowledgement was lost without duplicating it', async () => {
    const f = fixture(); await f.sync.connect(user); f.sync.setOnline(false);
    await f.sync.save(revise(f.sync.view.record!.state, s => { s.tasks.push({ id: 'a', title: 'Already committed', done: false, dueAt: null }); }));
    const state = f.sync.view.record!.state;
    f.setRemote({ id: state.id, revision: 1, payload: structuredClone(state) });
    f.sync.setOnline(true); await f.sync.refresh(); await f.sync.flush();
    expect(f.sync.view.status).toBe('synced'); expect(f.push).not.toHaveBeenCalled();
  });
  it('does not change local revisions or workspace identity when the server is unchanged', async () => {
    const f = fixture(); await f.sync.connect(user);
    const before = structuredClone(f.sync.view.record);
    await f.sync.refresh(); await f.sync.refresh();
    expect(f.sync.view.record).toEqual(before);
    expect(f.push).not.toHaveBeenCalled();
  });
  it('rejects a stale form callback from another account even if its local revision matches', async () => {
    const f = fixture(); await f.sync.connect(user);
    const old = revise(f.sync.view.record!.state, state => { state.tasks.push({ id: 'private-a', title: 'Account A', done: false, dueAt: null }); });
    await f.sync.connect({ id: 'b0000000-0000-4000-8000-000000000002' });
    await expect(f.sync.save(old, user.id)).rejects.toThrow('account-unavailable');
    expect(f.sync.view.record?.state.tasks).toEqual([]); expect(f.push).not.toHaveBeenCalled();
  });
  it('bounds automatic retries while keeping the durable pending copy', async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      await f.sync.connect(user); f.push.mockRejectedValue(new Error('unavailable'));
      await f.sync.save(revise(f.sync.view.record!.state, state => { state.tasks.push({ id: 'pending', title: 'Retained', done: false, dueAt: null }); }));
      await f.sync.flush(); await vi.advanceTimersByTimeAsync(100000);
      expect(f.push).toHaveBeenCalledTimes(6);
      expect(f.saved.get(user.id)?.pending).toBe(true);
      expect(f.sync.view.status).toBe('error');
    } finally { f.sync.dispose(); vi.useRealTimers(); }
  });
});
