import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js';
import { parseWorkspace, type Workspace } from '../../../packages/domain/src/index';
import publicCloud from './cloud-public.json';

type PublicCloudConfiguration = { enabled?: boolean; authUrl?: string; dataApiUrl?: string };
export function resolveCloudConfiguration(env: Record<string, unknown>, fallback: PublicCloudConfiguration = publicCloud): { authUrl: string; dataApiUrl: string } | null {
  // An explicit override is atomic: never combine a partial/disabled override with another project's URLs.
  const overridden = env.VITE_NEON_AUTH_URL !== undefined || env.VITE_NEON_DATA_API_URL !== undefined;
  const authUrl = overridden ? env.VITE_NEON_AUTH_URL : fallback.enabled ? fallback.authUrl : undefined;
  const dataApiUrl = overridden ? env.VITE_NEON_DATA_API_URL : fallback.enabled ? fallback.dataApiUrl : undefined;
  const isPublicUrl = (value: unknown): value is string => {
    if (typeof value !== 'string' || !value || value.trim() !== value) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  return isPublicUrl(authUrl) && isPublicUrl(dataApiUrl) ? { authUrl, dataApiUrl } : null;
}

const configuration = resolveCloudConfiguration(import.meta.env);
export const cloud = configuration ? createClient({ auth: { url: configuration.authUrl, adapter: SupabaseAuthAdapter() }, dataApi: { url: configuration.dataApiUrl } }) : null;
export type CloudSnapshot = { id: string; revision: number; payload: Workspace };
export type CloudIdentity = { id: string; email?: string };

export async function authenticateEmail(action: 'signup' | 'signin', fields: { name: string; email: string; password: string }): Promise<'connected' | 'verification-required'> {
  if (!cloud) throw new Error('cloud-unconfigured');
  const { email, password, name } = fields;
  const result = action === 'signup'
    ? await cloud.auth.signUp({ email, password, options: { data: { name, displayName: name } } })
    : await cloud.auth.signInWithPassword({ email, password });
  // The beta adapter reports session_not_found after a signup that needs email verification.
  // This is pending, not proof of registration, an email delivery, or a connected account.
  if (result.error?.code === 'email_not_confirmed' || (action === 'signup' && result.error?.code === 'session_not_found')) return 'verification-required';
  if (result.error) throw result.error;
  if (!result.data.session?.user) {
    if (action === 'signup') return 'verification-required';
    throw new Error('auth-session-unconfirmed');
  }
  return 'connected';
}

export async function googleSignInUrl(callbackURL: string): Promise<string> {
  if (!cloud) throw new Error('cloud-unconfigured');
  // In 0.8.0-beta signInWithOAuth discards Better Auth's returned error. Use its public client
  // to check the response before redirecting, rather than reporting a disabled provider as success.
  const { data, error } = await cloud.auth.getBetterAuthInstance().signIn.social({ provider: 'google', callbackURL, disableRedirect: true });
  if (error) throw error;
  if (!data?.url || new URL(data.url).protocol !== 'https:') throw new Error('oauth-unavailable');
  return data.url;
}

export async function fetchSnapshot(): Promise<CloudSnapshot | null> {
  if (!cloud) throw new Error('cloud-unconfigured');
  const { data, error } = await cloud.from('household_workspaces').select('id,revision,payload').limit(1).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, revision: data.revision, payload: parseWorkspace(JSON.stringify(data.payload)) } : null;
}

export async function pushSnapshot(state: Workspace, snapshot: CloudSnapshot | null): Promise<CloudSnapshot> {
  if (!cloud) throw new Error('cloud-unconfigured');
  const payload = parseWorkspace(JSON.stringify(state));
  const { data, error } = await cloud.rpc('update_workspace', {
    p_workspace_id: snapshot?.id ?? state.id,
    p_payload: payload,
    p_expected_revision: snapshot?.revision ?? 0,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.revision !== 'number') throw new Error('invalid-sync-response');
  return { id: result.id, revision: result.revision, payload };
}
