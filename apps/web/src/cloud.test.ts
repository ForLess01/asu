import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Workspace } from '../../../packages/domain/src/index';

const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => client }));
beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-value'); });
afterEach(() => vi.unstubAllEnvs());

describe('optional versioned snapshot adapter (mock service, not a live-cloud claim)', () => {
  it('uploads the validated current app schema only, excluding unknown credentials and caches', async () => {
    const { pushSnapshot } = await import('./cloud');
    const state = emptyWorkspace();
    client.rpc.mockResolvedValue({ data: { id: state.id, revision: 1 }, error: null });
    await pushSnapshot({ ...state, authCredentials: 'must-not-send', deviceCache: {} } as Workspace, null);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('update_workspace', { p_workspace_id: state.id, p_expected_revision: 0, p_payload: state });
  });
  it('preserves the remote expected revision and propagates conflicts without retrying writes', async () => {
    const { pushSnapshot } = await import('./cloud');
    const state = emptyWorkspace(), conflict = new Error('revision-conflict');
    client.rpc.mockResolvedValue({ data: null, error: conflict });
    await expect(pushSnapshot(state, { id: state.id, revision: 7, payload: state })).rejects.toThrow('revision-conflict');
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls[0][1].p_expected_revision).toBe(7);
  });
  it('does not write an invalid payload', async () => {
    const { pushSnapshot } = await import('./cloud');
    await expect(pushSnapshot({ ...emptyWorkspace(), schema_version: 99 } as unknown as Workspace, null)).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
