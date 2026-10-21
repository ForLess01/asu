import { z } from 'zod';

const finite = z.number().finite();
export const MAX_TREE_NODES = 8191;
const MAX_TREE_DEPTH = 64;
const nodes = <T extends z.ZodType>(schema: T) => z.array(schema).min(1).max(MAX_TREE_NODES);
const treeSchema = z.object({
  children_left: nodes(z.number().int()), children_right: nodes(z.number().int()),
  feature: nodes(z.number().int()), threshold: nodes(finite), value: nodes(finite),
}).strict().superRefine((t, ctx) => {
  const n = t.value.length;
  if (n > MAX_TREE_NODES || [t.children_left, t.children_right, t.feature, t.threshold].some(a => a.length !== n)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid tree arrays' }); return;
  }
  const stack = [{ node: 0, depth: 0 }], visited = new Set<number>();
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (node < 0 || node >= n || visited.has(node) || depth > MAX_TREE_DEPTH) { ctx.addIssue({ code: 'custom', message: 'Invalid tree graph' }); return; }
    visited.add(node);
    if (t.children_left[node] === -1 && t.children_right[node] === -1) continue;
    if (t.feature[node] < 0 || t.feature[node] >= 5) { ctx.addIssue({ code: 'custom', message: 'Invalid feature' }); return; }
    stack.push({ node: t.children_left[node], depth: depth + 1 }, { node: t.children_right[node], depth: depth + 1 });
  }
  if (visited.size !== n) ctx.addIssue({ code: 'custom', message: 'Unreachable tree nodes' });
});
const ensembleSchema = z.object({ init: finite, learning_rate: finite.nonnegative(), trees: z.array(treeSchema).max(1000) });
const categories = z.array(z.string().min(1)).nonempty().refine(a => new Set(a).size === a.length);
export const modelSchema = z.object({
  schema_version: z.literal(1), model_version: z.string().min(1), status: z.literal('experimental'),
  target_semantics: z.literal('reported_duration_not_actual_restoration'), label_semantics_approved: z.literal(false),
  feature_order: z.tuple([z.literal('month'), z.literal('weekday'), z.literal('hour'), z.literal('eps'), z.literal('department')]),
  preprocessing: z.object({ categories: z.object({ eps: categories, department: categories }), unknown_value: finite }),
  models: z.object({ p10: ensembleSchema, p50: ensembleSchema, p90: ensembleSchema }),
  calibration: z.object({ offset_hours: finite.nonnegative(), nominal_coverage: finite.gt(0).lt(1), method: z.string().optional(), partition: z.string().optional() }),
  support: z.object({ eps_codes: categories, departments: categories, combinations: z.array(z.object({ eps: z.string().min(1), department: z.string().min(1) })).min(1).max(10000) }),
  data_cutoff: z.iso.date(), source_sha256: z.string().min(1),
}).superRefine((model, ctx) => {
  const pairs = new Set<string>();
  for (const pair of model.support.combinations) {
    const key = JSON.stringify([pair.eps, pair.department]);
    if (pairs.has(key) || !model.support.eps_codes.includes(pair.eps) || !model.support.departments.includes(pair.department) || !model.preprocessing.categories.eps.includes(pair.eps) || !model.preprocessing.categories.department.includes(pair.department)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid supported combination' }); return;
    }
    pairs.add(key);
  }
});
export type PortableModel = z.infer<typeof modelSchema>;
export function validateModel(value: unknown): PortableModel { return modelSchema.parse(value); }

export function predict(model: PortableModel, features: number[]): [number, number, number] {
  if (features.length !== 5 || features.some(x => !Number.isFinite(x))) throw new Error('invalid-features');
  const inputs = features.map(Math.fround);
  const quantiles = (['p10', 'p50', 'p90'] as const).map(key => {
    const ensemble = model.models[key];
    let prediction = ensemble.init;
    for (const tree of ensemble.trees) {
      let node = 0, traversed = 0;
      while (tree.children_left[node] !== -1) {
        if (++traversed > MAX_TREE_DEPTH || node < 0 || node >= tree.value.length) throw new Error('invalid-tree');
        node = inputs[tree.feature[node]] <= tree.threshold[node] ? tree.children_left[node] : tree.children_right[node];
      }
      prediction += ensemble.learning_rate * tree.value[node];
    }
    return Math.max(0, prediction);
  }).sort((a, b) => a - b);
  const offset = model.calibration.offset_hours;
  return [Math.max(0, quantiles[0] - offset), quantiles[1], quantiles[2] + offset];
}

export function featuresTimeLima(startedAt: string): [number, number, number] {
  if (!z.iso.datetime({ offset: true }).safeParse(startedAt).success || !Number.isFinite(Date.parse(startedAt))) throw new Error('invalid-time');
  const date = new Date(Date.parse(startedAt) - 5 * 3600000);
  return [date.getUTCMonth() + 1, (date.getUTCDay() + 6) % 7, date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600];
}

export function featuresFor(model: PortableModel, eps: string, department: string, startedAt: string): number[] {
  const { categories: c } = model.preprocessing;
  if (!model.support.eps_codes.includes(eps) || !model.support.departments.includes(department) || !c.eps.includes(eps) || !c.department.includes(department)) throw new Error('unsupported-category');
  if (!model.support.combinations.some(pair => pair.eps === eps && pair.department === department)) throw new Error('unsupported-combination');
  return [...featuresTimeLima(startedAt), c.eps.indexOf(eps), c.department.indexOf(department)];
}

export function predictActualRestoration(_model: PortableModel): never { throw new Error('actual-restoration-unavailable'); }

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const checksumsSchema = z.object({ 'model.json': digestSchema, 'metrics.json': digestSchema, 'model-card.md': digestSchema }).catchall(digestSchema);
const metricsSchema = z.object({
  schema_version: z.literal(1), status: z.literal('experimental'),
  target_semantics: z.literal('reported_duration_not_actual_restoration'), label_semantics_approved: z.literal(false),
  source_sha256: digestSchema, run_id: z.string().min(1), model_version: z.string().optional(),
}).passthrough();
export type BundleEvidence = {
  checksums_sha256: string; model_sha256: string; metrics_sha256: string; model_card_sha256: string;
  model_version: string; run_id: string; source_sha256: string;
};
export type ModelBundle = { model: PortableModel; metrics: z.infer<typeof metricsSchema>; evidence: BundleEvidence };

async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('integrity-verification-unavailable');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Publish nothing until one stable checksum snapshot binds the entire evidence set. */
export async function loadModelBundle(baseURL = '/models/current/', signal?: AbortSignal): Promise<ModelBundle> {
  const download = async (name: string) => {
    const response = await fetch(`${baseURL}${name}`, { signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('model-bundle-unavailable');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('model-bundle-too-large');
    return bytes;
  };
  const decode = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);
  const manifest = await download('checksums.json');
  const checksums = checksumsSchema.parse(JSON.parse(decode(manifest)));
  const files = await Promise.all((['model.json', 'metrics.json', 'model-card.md'] as const).map(async name => {
    const bytes = await download(name), hash = await sha256(bytes);
    if (hash !== checksums[name]) throw new Error(`integrity-mismatch:${name}`);
    return decode(bytes);
  }));
  const manifestHash = await sha256(manifest);
  if (await sha256(await download('checksums.json')) !== manifestHash) throw new Error('bundle-changed');
  const model = validateModel(JSON.parse(files[0])), metrics = metricsSchema.parse(JSON.parse(files[1]));
  // The v1 model has no run_id: the hashed model card binds its evidence run to
  // the same checksum set. Do not infer a run identifier from a version string.
  const cardValue = (label: string) => files[2].split('\n').map(line => line.split('|').map(cell => cell.trim())).find(cells => cells[1] === label)?.[2]?.replace(/^`|`$/g, '');
  if (metrics.source_sha256 !== model.source_sha256 || cardValue('Source SHA-256') !== model.source_sha256) throw new Error('source-mismatch');
  if (cardValue('Run') !== metrics.run_id) throw new Error('run-mismatch');
  if (metrics.model_version !== undefined && metrics.model_version !== model.model_version) throw new Error('version-mismatch');
  if (predict(model, [1, 0, 0, 0, 0]).some(x => !Number.isFinite(x))) throw new Error('invalid-model-output');
  return { model, metrics, evidence: {
    checksums_sha256: manifestHash, model_sha256: checksums['model.json'], metrics_sha256: checksums['metrics.json'], model_card_sha256: checksums['model-card.md'],
    model_version: model.model_version, run_id: metrics.run_id, source_sha256: model.source_sha256,
  } };
}

export async function loadModel(url = '/models/current/model.json', signal?: AbortSignal): Promise<PortableModel> {
  if (!url.endsWith('/model.json')) throw new Error('unsupported-model-url');
  return (await loadModelBundle(url.slice(0, -'model.json'.length), signal)).model;
}
