import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModel, loadModelBundle } from './index';

const resources = Object.fromEntries(['model.json', 'metrics.json', 'model-card.md', 'checksums.json'].map(name => [name, readFileSync(new URL(`../../../apps/web/public/models/current/${name}`, import.meta.url), 'utf8')]));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
afterEach(() => vi.unstubAllGlobals());

function serve(overrides: Record<string, string> = {}, secondChecksums?: string) {
  let manifests = 0;
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const name = String(url).split('/').pop()!;
    const text = name === 'checksums.json' && ++manifests > 1 && secondChecksums ? secondChecksums : overrides[name] ?? resources[name];
    return text === undefined ? new Response('', { status: 404 }) : new Response(text);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('atomic verified model/evidence bundle', () => {
  it('verifies the actual public files and binds source, model version and evidence run in one receipt', async () => {
    const fetch = serve();
    const bundle = await loadModelBundle();
    expect(bundle.model.model_version).toBe('asu-reported-v1');
    expect(bundle.evidence.source_sha256).toBe(bundle.model.source_sha256);
    expect(bundle.evidence.run_id).toBe(bundle.metrics.run_id);
    expect(bundle.evidence.model_sha256).toBe(hash(resources['model.json']));
    expect(bundle.evidence.metrics_sha256).toBe(hash(resources['metrics.json']));
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/checksums.json'))).toHaveLength(2);
    expect((await loadModel()).model_version).toBe(bundle.model.model_version);
  });
  it('rejects substituted metrics and incorrect checksum sets', async () => {
    serve({ 'metrics.json': JSON.stringify({ ...JSON.parse(resources['metrics.json']), source_sha256: 'f'.repeat(64) }) });
    await expect(loadModelBundle()).rejects.toThrow('integrity-mismatch:metrics.json');
    serve({ 'checksums.json': JSON.stringify({ ...JSON.parse(resources['checksums.json']), 'model.json': '0'.repeat(64) }) });
    await expect(loadModelBundle()).rejects.toThrow('integrity-mismatch:model.json');
  });
  it.each([
    ['source_sha256', 'f'.repeat(64), 'source-mismatch'],
    ['run_id', 'different-experimental-run', 'run-mismatch'],
    ['model_version', 'different-model-version', 'version-mismatch'],
  ])('rejects inconsistent %s even when changed metrics have matching file checksums', async (field, value, reason) => {
    const metrics = JSON.stringify({ ...JSON.parse(resources['metrics.json']), [field]: value });
    serve({ 'metrics.json': metrics, 'checksums.json': JSON.stringify({ ...JSON.parse(resources['checksums.json']), 'metrics.json': hash(metrics) }) });
    await expect(loadModelBundle()).rejects.toThrow(reason);
  });
  it('fails closed when the release checksum set changes during download', async () => {
    serve({}, JSON.stringify({ ...JSON.parse(resources['checksums.json']), 'model.json': '0'.repeat(64) }));
    await expect(loadModelBundle()).rejects.toThrow('bundle-changed');
  });
});
