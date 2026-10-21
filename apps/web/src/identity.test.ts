import { describe, expect, it } from 'vitest';
import { accountIdentity } from './identity';

describe('managed account display identity', () => {
  it('reads the installed Neon adapter displayName mapping without exposing session fields', () => {
    expect(accountIdentity({ id: 'owner', email: 'owner@example.com', user_metadata: { displayName: 'Alex', access_token: 'not-an-identity-field' } })).toEqual({ id: 'owner', email: 'owner@example.com', name: 'Alex' });
  });
  it('supports direct Better Auth names and handles missing/malformed metadata', () => {
    expect(accountIdentity({ id: 'owner', name: ' Alex ' })?.name).toBe('Alex');
    expect(accountIdentity({ id: 'owner', user_metadata: { displayName: 42 } })?.name).toBeUndefined();
    expect(accountIdentity(null)).toBeNull();
  });
});
