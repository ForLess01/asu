import { createClient } from '@supabase/supabase-js';
import { parseWorkspace, type Workspace } from '../../../packages/domain/src/index';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const cloud = url && key ? createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } }) : null;
export type CloudSnapshot = { id: string; revision: number; payload: Workspace };

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
