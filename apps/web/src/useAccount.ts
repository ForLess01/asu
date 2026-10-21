import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '../../../packages/domain/src/index';
import { AccountSync } from './account-sync';
import { cloud, fetchSnapshot, pushSnapshot, type CloudIdentity } from './cloud';
import { readAccount, writeAccount } from './storage';
import { accountIdentity } from './identity';

/** The app, not the Settings route, owns the session and durable upload queue. */
export function useAccount(guest: Workspace | undefined, online: boolean, ready = true) {
  const [sync] = useState(() => new AccountSync({ read: readAccount, write: writeAccount, fetch: fetchSnapshot, push: pushSnapshot }));
  const [view, setView] = useState(sync.view), [checking, setChecking] = useState(!!cloud);
  const guestRef = useRef(guest); guestRef.current = guest;
  useEffect(() => sync.subscribe(setView), [sync]);
  useEffect(() => { sync.setOnline(online); }, [sync, online]);
  const refreshSession = async () => {
    if (!cloud) return;
    const { data, error } = await cloud.auth.getSession();
    if (error) throw error;
    await sync.connect(accountIdentity(data.session?.user ?? null), guestRef.current);
    setChecking(false);
  };
  useEffect(() => {
    if (!cloud || !ready) return;
    let active = true, events = 0;
    const update = (identity: CloudIdentity | null) => { if (active) { setChecking(false); void sync.connect(accountIdentity(identity), guestRef.current); } };
    const { data } = cloud.auth.onAuthStateChange((_event, session) => { events++; update(session?.user ?? null); });
    const generation = events;
    void cloud.auth.getSession().then(({ data, error }) => {
      if (active && generation === events) { if (error) setChecking(false); else update(data.session?.user ?? null); }
    }).catch(() => { if (active) setChecking(false); });
    const refresh = () => { if (document.visibilityState === 'visible') void sync.refresh(); };
    addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { active = false; data.subscription.unsubscribe(); sync.dispose(); removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [sync, ready]);
  const signOut = async () => {
    if (!cloud) return;
    const { error } = await cloud.auth.signOut();
    if (error) throw error;
    await sync.connect(null);
  };
  return { ...view, checking, sync, refreshSession, signOut };
}
export type Account = ReturnType<typeof useAccount>;
