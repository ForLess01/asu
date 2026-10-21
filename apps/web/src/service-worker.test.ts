import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const origin = 'https://asu.example';
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function harness() {
  let release = 'A', offline = false, brokenAsset = false;
  const entries = new Map<string, Response>(), listeners = new Map<string, (event: any) => void>();
  const key = (input: string | Request) => new URL(typeof input === 'string' ? input : input.url, origin).href;
  const network = async (input: string | Request) => {
    if (offline) throw new Error('offline');
    const path = new URL(key(input)).pathname;
    const html = `<!doctype html><script type="module" src="/assets/${release}.js"></script><link rel="stylesheet" href="/assets/${release}.css"><main>Release ${release}</main>`;
    const response = new Response(path === '/' ? html : path.endsWith('.js') ? `globalThis.release = '${release}';` : path.endsWith('.css') ? `/* ${release} styles */` : 'public resource', {
      status: brokenAsset && path.endsWith('.js') ? 503 : 200,
      headers: { 'Content-Type': path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/css' },
    });
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  };
  const cache = {
    match: async (input: string | Request) => entries.get(key(input))?.clone(),
    put: async (input: string | Request, response: Response) => { entries.set(key(input), response.clone()); },
    addAll: async (inputs: string[]) => { for (const input of inputs) await cache.put(input, await network(input)); },
  };
  runInNewContext(source, {
    self: { location: { origin }, addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler), skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, match: cache.match }, fetch: network, URL, Request, Response, Headers, console,
  });
  const dispatch = async (name: string, request?: { url: string; mode: string; method: string; headers: Headers }) => {
    const work: Promise<unknown>[] = []; let response: Promise<Response> | undefined;
    listeners.get(name)!({ request, waitUntil: (promise: Promise<unknown>) => work.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
    const result = response ? await response : undefined;
    await Promise.all(work);
    return result;
  };
  return {
    install: () => dispatch('install'),
    request: (path: string, mode = 'cors', authorization = false) => dispatch('fetch', { url: new URL(path, origin).href, mode, method: 'GET', headers: new Headers(authorization ? { authorization: 'Bearer mock-public-test' } : {}) }),
    release: (value: string) => { release = value; }, offline: () => { offline = true; }, breakAsset: () => { brokenAsset = true; },
  };
}

describe('service-worker shell policy, simulated releases without an application build', () => {
  it('keeps release B HTML and its entry assets coherent after A → controlled online B → offline', async () => {
    const worker = harness();
    await worker.install(); await worker.request('/assets/A.js');
    worker.release('B');
    expect(await (await worker.request('/', 'navigate'))!.text()).toContain('Release B');
    // Go offline before the new page makes its own entry-asset requests.
    worker.offline();
    const html = await (await worker.request('/', 'navigate'))!.text();
    expect(html).toContain('Release B');
    const script = html.match(/src="([^"]+)"/)![1];
    expect(await (await worker.request(script))!.text()).toContain("release = 'B'");
    expect(await (await worker.request('/assets/B.css'))!.text()).toContain('B styles');
  });
  it('does not promote HTML whose new entry assets failed, and retains older client assets', async () => {
    const worker = harness();
    await worker.install(); await worker.request('/assets/A.js');
    worker.release('B'); worker.breakAsset(); await worker.request('/', 'navigate'); worker.offline();
    expect(await (await worker.request('/', 'navigate'))!.text()).toContain('Release A');
    expect(await (await worker.request('/assets/A.js'))!.text()).toContain("release = 'A'");
  });
  it('still bypasses authenticated, API and model requests', async () => {
    const worker = harness();
    expect(await worker.request('/assets/private.js', 'cors', true)).toBeUndefined();
    expect(await worker.request('/rest/workspaces')).toBeUndefined();
    expect(await worker.request('/models/current/model.json')).toBeUndefined();
  });
});
