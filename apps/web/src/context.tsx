import { createContext, useContext } from 'react';
import type { Workspace } from '../../../packages/domain/src/index';
import type { StorageKey } from './storage';
import type { Account } from './useAccount';
import type { MotionPreference } from './useMotion';

export type Page = 'home' | 'reserve' | 'plan' | 'incidents' | 'tasks' | 'settings' | 'lab';
export type AsuContext = {
  state: Workspace; mode: StorageKey; busy: boolean; online: boolean; now: number;
  account: Account;
  motion: MotionPreference;
  t: (es: string, en: string) => string;
  commit: (next: Workspace) => Promise<boolean>;
  notify: (message: string, error?: boolean) => void;
  navigate: (page: Page) => void;
  switchMode: (mode: StorageKey) => Promise<void>;
};
export const Context = createContext<AsuContext | null>(null);
export function useAsu(): AsuContext {
  const value = useContext(Context);
  if (!value) throw new Error('Missing Asu context');
  return value;
}
