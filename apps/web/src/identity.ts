import type { CloudIdentity } from './cloud';

type Profile = { id: string; email?: string; name?: string; user_metadata?: Record<string, unknown> };
export function accountIdentity(profile: Profile | null): CloudIdentity | null {
  if (!profile) return null;
  const candidate = profile.user_metadata?.displayName ?? profile.user_metadata?.name ?? profile.name;
  const name = typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, 100) : undefined;
  return { id: profile.id, ...(profile.email ? { email: profile.email } : {}), ...(name ? { name } : {}) };
}
