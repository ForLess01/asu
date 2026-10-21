import { z } from 'zod';

const nonnegative = z.number().finite().nonnegative();
const text = z.string().trim().min(1).max(160);
const timestamp = z.iso.datetime({ offset: true });
export const categorySchema = z.enum(['drinking', 'other']);
export type Category = z.infer<typeof categorySchema>;
export const containerSchema = z.object({
  id: text, name: text, category: categorySchema,
  capacity: z.number().finite().positive().nullable(), volume: nonnegative.nullable(), observedAt: timestamp,
}).refine(validateContainer, { message: 'Volume exceeds capacity' });
export const activitySchema = z.object({
  id: text, name: text, category: categorySchema, liters: nonnegative,
  timesPerDay: z.number().finite().positive().max(1000), essential: z.boolean(), source: text, updatedAt: timestamp,
});
export const incidentSchema = z.object({
  id: text, startedAt: timestamp, restoredAt: timestamp.nullable(), source: text,
  scope: z.literal('household'), precision: z.enum(['exact', 'approximate']),
  updates: z.array(z.object({ at: timestamp, note: text })).max(1000),
}).refine(i => !i.restoredAt || Date.parse(i.restoredAt) >= Date.parse(i.startedAt), { message: 'Invalid restoration' });
export const workspaceSchema = z.object({
  schema_version: z.literal(1), id: z.uuid(), revision: z.number().int().nonnegative(),
  locale: z.enum(['es-PE', 'en']), updatedAt: timestamp,
  household: z.object({ label: text, district: text, department: text, eps: text, occupancy: z.number().int().min(1).max(500) }).nullable(),
  containers: z.array(containerSchema).max(500), activities: z.array(activitySchema).max(500),
  incidents: z.array(incidentSchema).max(2000),
  tasks: z.array(z.object({ id: text, title: text, done: z.boolean(), dueAt: timestamp.nullable() })).max(500),
  scenarios: z.array(z.object({
    id: text, at: timestamp, hours: z.number().positive().max(720),
    deferredIds: z.array(text), replenishment: nonnegative, category: categorySchema,
    baseRevision: z.number().int().nonnegative(),
    inputs: z.object({ reserves: z.record(categorySchema, nonnegative.nullable()), rates: z.record(categorySchema, nonnegative) }),
  })).max(500),
}).superRefine((state, ctx) => {
  for (const collection of [state.containers, state.activities, state.incidents, state.tasks, state.scenarios]) {
    if (new Set(collection.map(item => item.id)).size !== collection.length) ctx.addIssue({ code: 'custom', message: 'Duplicate operation ID' });
  }
  if (state.incidents.filter(i => !i.restoredAt).length > 1) ctx.addIssue({ code: 'custom', message: 'Only one active incident' });
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type Container = z.infer<typeof containerSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type Water = Record<Category, number>;

export function emptyWorkspace(): Workspace {
  return { schema_version: 1, id: crypto.randomUUID(), revision: 0, locale: 'es-PE', updatedAt: new Date().toISOString(), household: null, containers: [], activities: [], incidents: [], tasks: [], scenarios: [] };
}

export function parseWorkspace(json: string): Workspace { return workspaceSchema.parse(JSON.parse(json)); }

export function validateContainer(input: { capacity: number | null; volume: number | null }): boolean {
  return (input.capacity === null || (Number.isFinite(input.capacity) && input.capacity > 0)) &&
    (input.volume === null || (Number.isFinite(input.volume) && input.volume >= 0 && (input.capacity === null || input.volume <= input.capacity)));
}

export function validateIncident(start: string, restored?: string, now = Date.now()): boolean {
  const beginning = Date.parse(start), end = restored ? Date.parse(restored) : now;
  return Number.isFinite(beginning) && Number.isFinite(end) && beginning <= now && end >= beginning && end <= now;
}

export function liters(value: number, unit: 'L' | 'ml' | 'm3'): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('invalid-volume');
  return value * ({ L: 1, ml: 0.001, m3: 1000 }[unit]);
}

export function autonomy(volume: number | null, perHour: number | null): { status: 'known'; hours: number } | { status: 'unknown-reserve' | 'unknown-consumption' } {
  if (volume === null) return { status: 'unknown-reserve' };
  if (perHour === null || perHour <= 0) return { status: 'unknown-consumption' };
  return { status: 'known', hours: volume / perHour };
}

export function balance(current: Water, capacity: Water, replenishment: Water, consumption: Water): Water {
  return Object.fromEntries((['drinking', 'other'] as const).map(k => [k, Math.max(0, Math.min(capacity[k], current[k] + replenishment[k] - consumption[k]))])) as Water;
}

export function compareScenario(volume: number, rate: number, hours: number) {
  const required = rate * hours;
  return { required, remaining: Math.max(0, volume - required), deficit: Math.max(0, required - volume) };
}

export function reserveSummary(containers: Container[], category: Category, now = Date.now()): { volume: number | null; capacity: number | null; stale: boolean } {
  const selected = containers.filter(c => c.category === category);
  return {
    volume: selected.some(c => c.volume === null) ? null : selected.reduce((sum, c) => sum + (c.volume ?? 0), 0),
    capacity: selected.some(c => c.capacity === null) ? null : selected.reduce((sum, c) => sum + (c.capacity ?? 0), 0),
    stale: selected.some(c => now - Date.parse(c.observedAt) > 24 * 3600000),
  };
}

export function hourlyUse(activities: Activity[], category: Category, deferredIds: string[] = []): number {
  return activities.filter(a => a.category === category && (a.essential || !deferredIds.includes(a.id))).reduce((sum, a) => sum + a.liters * a.timesPerDay / 24, 0);
}

/** Every mutation passes through the same validation and revision boundary. */
export function revise(state: Workspace, update: (draft: Workspace) => void): Workspace {
  const draft = structuredClone(state);
  update(draft);
  draft.revision = state.revision + 1;
  draft.updatedAt = new Date().toISOString();
  return workspaceSchema.parse(draft);
}

export function saveContainer(state: Workspace, container: Container): Workspace {
  const parsed = containerSchema.parse(container);
  return revise(state, draft => {
    const index = draft.containers.findIndex(c => c.id === parsed.id);
    if (index === -1) draft.containers.push(parsed); else draft.containers[index] = parsed;
  });
}

export function startIncident(state: Workspace, incident: Incident): Workspace {
  if (!validateIncident(incident.startedAt)) throw new Error('invalid-incident-time');
  return revise(state, draft => { draft.incidents.unshift(incidentSchema.parse(incident)); });
}

export function restoreIncident(state: Workspace, id: string, restoredAt: string, precision: 'exact' | 'approximate'): Workspace {
  return revise(state, draft => {
    const incident = draft.incidents.find(i => i.id === id);
    if (!incident || !validateIncident(incident.startedAt, restoredAt)) throw new Error('invalid-incident-time');
    incident.restoredAt = restoredAt; incident.precision = precision;
    incident.updates.push({ at: new Date().toISOString(), note: 'Household restoration observed; not a training label.' });
  });
}

export function exampleWorkspace(): Workspace {
  const state = emptyWorkspace(), now = new Date().toISOString();
  return revise(state, draft => {
    draft.household = { label: 'Casa de ejemplo', district: 'Pueblo Libre', department: 'LIMA', eps: 'SEDAPAL', occupancy: 4 };
    draft.containers = [
      { id: crypto.randomUUID(), name: 'Tanque principal', category: 'other', capacity: 600, volume: 420, observedAt: now },
      { id: crypto.randomUUID(), name: 'Bidón de cocina', category: 'drinking', capacity: 40, volume: 30, observedAt: now },
    ];
    draft.activities = [
      { id: crypto.randomUUID(), name: 'Bebida y cocina', category: 'drinking', liters: 12, timesPerDay: 1, essential: true, source: 'example', updatedAt: now },
      { id: crypto.randomUUID(), name: 'Higiene del hogar', category: 'other', liters: 60, timesPerDay: 1, essential: true, source: 'example', updatedAt: now },
      { id: crypto.randomUUID(), name: 'Lavado de ropa', category: 'other', liters: 70, timesPerDay: 1, essential: false, source: 'example', updatedAt: now },
    ];
  });
}
