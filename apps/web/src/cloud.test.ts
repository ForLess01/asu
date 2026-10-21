import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Workspace } from '../../../packages/domain/src/index';

const sdk = vi.hoisted(() => ({ createClient: vi.fn(), adapter: vi.fn(() => 'neon-auth-adapter') }));
const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), auth: { signUp: vi.fn(), signInWithPassword: vi.fn(), getSession: vi.fn(), getBetterAuthInstance: vi.fn() } }));
vi.mock('@neondatabase/neon-js', () => ({ createClient: sdk.createClient, SupabaseAuthAdapter: sdk.adapter }));
beforeEach(() => {
  vi.clearAllMocks(); vi.resetModules(); sdk.createClient.mockReturnValue(client);
  vi.stubEnv('VITE_NEON_AUTH_URL', 'https://auth.example.com/asu/auth');
  vi.stubEnv('VITE_NEON_DATA_API_URL', 'https://data.example.com/asu/rest/v1');
});
afterEach(() => vi.unstubAllEnvs());

describe('optional versioned snapshot adapter (mock service, not a live-cloud claim)', () => {
  it('initializes Neon with the compatibility adapter and public URLs, without browser API keys', async () => {
    await import('./cloud');
    expect(sdk.createClient).toHaveBeenCalledExactlyOnceWith({ auth: { url: 'https://auth.example.com/asu/auth', adapter: 'neon-auth-adapter' }, dataApi: { url: 'https://data.example.com/asu/rest/v1' } });
  });
  it('prefers a complete environment override and otherwise uses enabled public configuration', async () => {
    const { resolveCloudConfiguration } = await import('./cloud');
    const config = { enabled: true, authUrl: 'https://public.example.com/auth', dataApiUrl: 'https://public.example.com/rest/v1' };
    expect(resolveCloudConfiguration({}, config)).toEqual({ authUrl: config.authUrl, dataApiUrl: config.dataApiUrl });
    expect(resolveCloudConfiguration({ VITE_NEON_AUTH_URL: 'https://override.example.com/auth', VITE_NEON_DATA_API_URL: 'https://override.example.com/rest/v1' }, config)).toEqual({ authUrl: 'https://override.example.com/auth', dataApiUrl: 'https://override.example.com/rest/v1' });
  });
  it('stays local when disabled or partially configured and never falls back to old Supabase variables', async () => {
    const { resolveCloudConfiguration } = await import('./cloud');
    const config = { enabled: true, authUrl: 'https://public.example.com/auth', dataApiUrl: 'https://public.example.com/rest/v1' };
    expect(resolveCloudConfiguration({}, { ...config, enabled: false })).toBeNull();
    expect(resolveCloudConfiguration({}, { enabled: true })).toBeNull();
    expect(resolveCloudConfiguration({ VITE_NEON_AUTH_URL: 'https://override.example.com/auth' }, config)).toBeNull();
    expect(resolveCloudConfiguration({ VITE_NEON_AUTH_URL: '', VITE_NEON_DATA_API_URL: '' }, config)).toBeNull();
    expect(resolveCloudConfiguration({ VITE_SUPABASE_URL: 'https://legacy.example.com', VITE_SUPABASE_PUBLISHABLE_KEY: 'legacy' }, { enabled: false })).toBeNull();
  });
  it.each(['invalid', 'http://example.com/auth', 'https://name:password@example.com/auth', 'https://example.com/auth?token=value', 'https://example.com/auth#token'])('rejects malformed or credential-bearing URL %s', async authUrl => {
    const { resolveCloudConfiguration } = await import('./cloud');
    expect(resolveCloudConfiguration({ VITE_NEON_AUTH_URL: authUrl, VITE_NEON_DATA_API_URL: 'https://data.example.com/rest/v1' })).toBeNull();
    expect(resolveCloudConfiguration({ VITE_NEON_AUTH_URL: 'https://auth.example.com/auth', VITE_NEON_DATA_API_URL: authUrl })).toBeNull();
  });
  it('rejects cloud operations when explicitly unconfigured without making a request', async () => {
    vi.stubEnv('VITE_NEON_AUTH_URL', ''); vi.stubEnv('VITE_NEON_DATA_API_URL', '');
    const { cloud, fetchSnapshot, pushSnapshot, authenticateEmail } = await import('./cloud');
    expect(cloud).toBeNull();
    await expect(fetchSnapshot()).rejects.toThrow('cloud-unconfigured');
    await expect(pushSnapshot(emptyWorkspace(), null)).rejects.toThrow('cloud-unconfigured');
    await expect(authenticateEmail('signin', { email: 'person@example.com', password: 'test-only-password', name: '' })).rejects.toThrow('cloud-unconfigured');
    expect(sdk.createClient).not.toHaveBeenCalled(); expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled();
  });
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
  it('fetches and validates a remote workspace without accepting unknown credential fields', async () => {
    const state = emptyWorkspace(), maybeSingle = vi.fn().mockResolvedValue({ data: { id: state.id, revision: 3, payload: { ...state, password: 'not-workspace-data' } }, error: null });
    const limit = vi.fn(() => ({ maybeSingle })), select = vi.fn(() => ({ limit })); client.from.mockReturnValue({ select });
    const { fetchSnapshot } = await import('./cloud');
    expect(await fetchSnapshot()).toEqual({ id: state.id, revision: 3, payload: state });
    expect(client.from).toHaveBeenCalledExactlyOnceWith('household_workspaces'); expect(select).toHaveBeenCalledWith('id,revision,payload'); expect(limit).toHaveBeenCalledWith(1);
  });
  it('propagates fetch errors rather than presenting them as an empty account', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error('permission-denied') });
    client.from.mockReturnValue({ select: () => ({ limit: () => ({ maybeSingle }) }) });
    const { fetchSnapshot } = await import('./cloud');
    await expect(fetchSnapshot()).rejects.toThrow('permission-denied'); expect(client.rpc).not.toHaveBeenCalled();
  });
  it('signs up with a name and requires a real session before reporting connected', async () => {
    const { authenticateEmail } = await import('./cloud');
    client.auth.signUp.mockResolvedValue({ data: { session: { user: { id: 'provider-user', email: 'person@example.com' } } }, error: null });
    expect(await authenticateEmail('signup', { name: 'Person', email: 'person@example.com', password: 'test-only-password' })).toBe('connected');
    expect(client.auth.signUp).toHaveBeenCalledExactlyOnceWith({ email: 'person@example.com', password: 'test-only-password', options: { data: { name: 'Person', displayName: 'Person' } } });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('signs in through the password API without uploading household state', async () => {
    const { authenticateEmail } = await import('./cloud');
    client.auth.signInWithPassword.mockResolvedValue({ data: { session: { user: { id: 'provider-user' } } }, error: null });
    expect(await authenticateEmail('signin', { name: '', email: 'person@example.com', password: 'test-only-password' })).toBe('connected');
    expect(client.auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: 'person@example.com', password: 'test-only-password' }); expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(['signup', 'signin'] as const)('propagates %s errors and does not change workspace data', async action => {
    const state = emptyWorkspace(), before = JSON.stringify(state), error = new Error('invalid-credentials');
    client.auth.signUp.mockResolvedValue({ data: { session: null }, error }); client.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error });
    const { authenticateEmail } = await import('./cloud');
    await expect(authenticateEmail(action, { name: 'Person', email: 'person@example.com', password: 'test-only-password' })).rejects.toThrow('invalid-credentials');
    expect(JSON.stringify(state)).toBe(before); expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled();
  });
  it('reports verification/session confirmation as pending, never a connected account', async () => {
    const { authenticateEmail } = await import('./cloud');
    client.auth.signUp.mockResolvedValue({ data: { session: null }, error: { code: 'session_not_found' } });
    expect(await authenticateEmail('signup', { name: 'Person', email: 'person@example.com', password: 'test-only-password' })).toBe('verification-required');
    client.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'email_not_confirmed' } });
    expect(await authenticateEmail('signin', { name: '', email: 'person@example.com', password: 'test-only-password' })).toBe('verification-required');
    client.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });
    await expect(authenticateEmail('signin', { name: '', email: 'person@example.com', password: 'test-only-password' })).rejects.toThrow('auth-session-unconfirmed');
  });
  it('surfaces Google provider errors which the beta compatibility adapter otherwise discards', async () => {
    const social = vi.fn().mockResolvedValue({ data: null, error: new Error('provider-disabled') });
    client.auth.getBetterAuthInstance.mockReturnValue({ signIn: { social } });
    const { googleSignInUrl } = await import('./cloud');
    await expect(googleSignInUrl('http://127.0.0.1:5184')).rejects.toThrow('provider-disabled');
    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: 'http://127.0.0.1:5184', disableRedirect: true });
  });
});
