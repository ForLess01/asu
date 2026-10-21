import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import type { CloudSnapshot } from '../../apps/web/src/cloud';
import type { Workspace } from '../../packages/domain/src/index';
import publicCloud from '../../apps/web/src/cloud-public.json' with { type: 'json' };

const project = 'green-snow-30498948', branch = 'br-royal-bread-b7dv6ts9';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const connectedLabel = 'Cuenta conectada · sincronización manual';

// The CLI alone accesses its credential store. Never surface command output or an Error
// object that could include a response, account identifier, or inherited configuration.
function cliSucceeded(arguments_: string[]): Promise<boolean> {
  return new Promise(resolve => {
    execFile('neon', [...arguments_, '--output', 'json', '--analytics=false'], { timeout: 30_000, maxBuffer: 1024 * 1024 }, error => resolve(!error));
  });
}

async function settings(page: Page) {
  await page.locator('a[href="#settings"]:visible').first().click();
}

async function connected(page: Page): Promise<boolean> {
  return expect.poll(() => page.getByText(connectedLabel, { exact: true }).isVisible(), { timeout: 30_000, message: 'real-session-connected' }).toBe(true).then(() => true);
}

async function fillCredentials(page: Page, email: string, password: string) {
  // Errors from fill() can contain their argument. Keep all such exceptions out of reporter output.
  try {
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
  } catch { throw new Error('hosted-credential-entry-failed'); }
}

async function signup(page: Page, email: string, password: string, created: Set<string>) {
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Nombre de la cuenta', { exact: true }).fill('Disposable hosted verification');
  await fillCredentials(page, email, password);
  // Capture only this UI-created user's UUID before any session/UI assertion can fail.
  const responsePromise = page.waitForResponse(response => response.url() === `${publicCloud.authUrl}/sign-up/email` && response.request().method() === 'POST', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Registrarme con correo', exact: true }).click();
  const response = await responsePromise;
  const id: unknown = (await response.json()).user?.id;
  if (response.ok() && typeof id === 'string' && uuid.test(id)) created.add(id);
  if (!response.ok() || typeof id !== 'string' || !created.has(id)) throw new Error('hosted-signup-response-unconfirmed');
  await connected(page);
}

async function remote(page: Page): Promise<CloudSnapshot | null> {
  // This is the actual browser client with its actual session-derived JWT. No route or SDK mocks.
  return page.evaluate(async () => {
    const moduleUrl = '/src/cloud.ts';
    const { fetchSnapshot } = await import(moduleUrl);
    return fetchSnapshot();
  });
}

async function localExport(page: Page): Promise<Workspace> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar mis datos JSON', exact: true }).click();
  const stream = await (await downloadPromise).createReadStream(), chunks: Buffer[] = [];
  if (!stream) throw new Error('hosted-export-unavailable');
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function upload(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Subir mi plan', exact: true }).click();
}

test('real Neon Auth, browser recovery, owner isolation and optimistic concurrency', async ({ browser, request }, testInfo) => {
  test.skip(process.env.ASU_RUN_HOSTED_TESTS !== '1', 'Hosted fixtures require explicit opt-in.');
  const expectedOrigin = `http://${process.env.ASU_HOSTED_HOST ?? 'localhost'}:${process.env.ASU_HOSTED_PORT ?? '5186'}`;
  const browserOrigin = testInfo.project.use.baseURL ?? '';
  const evidenceNames: Record<string, string> = {
    'http://localhost:5186': 'neon-hosted.json',
    'http://127.0.0.1:5186': 'neon-hosted-loopback.json',
    'http://127.0.0.1:5174': 'neon-hosted-local-app.json',
    'http://localhost:5174': 'neon-hosted-localhost-local-app.json',
  };
  const evidenceName = evidenceNames[expectedOrigin];
  if (!evidenceName) throw new Error('Hosted verification requires an explicitly supported browser origin.');
  const started = Date.now(), created = new Set<string>(), contexts: BrowserContext[] = [];
  const checks: Record<string, boolean> = {};
  const observedHttpStatuses: Record<string, number> = {};
  let stage = 'public-configuration', passed = false, deleted = 0, cleanupAttempts = 0, serverHtmlVerified = false;
  const verify = (name: string, result: boolean) => { checks[name] = result; if (!result) throw new Error(`hosted-check-failed:${name}`); };
  // Reserved domain and random passwords exist only in this process and the authentication requests.
  const accountA = { email: `asu-hosted-${randomUUID()}@example.com`, password: randomBytes(32).toString('base64url') };
  const accountB = { email: `asu-hosted-${randomUUID()}@example.com`, password: randomBytes(32).toString('base64url') };
  try {
    verify('public_endpoints_match_approved_project', publicCloud.enabled && publicCloud.authUrl === 'https://ep-plain-firefly-b7y8plrb.neonauth.c-13.us-east-1.aws.neon.tech/asu/auth' && publicCloud.dataApiUrl === 'https://ep-plain-firefly-b7y8plrb.apirest.c-13.us-east-1.aws.neon.tech/asu/rest/v1');
    stage = 'supported-browser-origin';
    verify('supported_browser_origin', browserOrigin === expectedOrigin && !!evidenceNames[browserOrigin]);
    // Provider origin/CORS registration belongs to the parent. This suite only verifies it.
    // In particular, port 5174 is an existing server: verify its actual HTML before using it.
    stage = 'asu-server-html';
    const htmlResponse = await request.get(browserOrigin, { timeout: 10_000 }), html = await htmlResponse.text();
    serverHtmlVerified = htmlResponse.ok() && /<title>Asu · Tu agua, con un plan<\/title>/.test(html) && html.includes('/brand/asu-icon.svg') && html.includes('/src/main.tsx');
    if (!serverHtmlVerified) throw new Error('Hosted origin is not a verified Asu development server.');
    const newPage = async () => {
      const context = await browser.newContext({ baseURL: browserOrigin }); contexts.push(context);
      return context.newPage();
    };
    const a = await newPage();
    stage = 'guest-household-setup';
    await a.goto('/');
    if (new URL(a.url()).origin !== browserOrigin) throw new Error('Hosted browser navigated outside the selected origin.');
    await a.getByLabel('Nombre del hogar', { exact: true }).fill('Hosted verification household');
    await a.getByLabel('Distrito', { exact: true }).fill('Pueblo Libre');
    await a.getByRole('button', { name: 'Crear mi plan local', exact: true }).click();
    await a.locator('a[href="#reserve"]:visible').first().click();
    await a.getByRole('button', { name: 'Añadir recipiente', exact: true }).click();
    const dialog = a.getByRole('dialog');
    await dialog.getByLabel('Nombre del recipiente').fill('Hosted verification tank');
    await dialog.getByLabel('Capacidad (L)', { exact: true }).fill('800');
    await dialog.getByLabel('Agua disponible (L)', { exact: true }).fill('600');
    await dialog.getByRole('button', { name: 'Guardar recipiente', exact: true }).click();
    await settings(a);
    stage = 'signup-a';
    await signup(a, accountA.email, accountA.password, created);
    verify('signup_a_real_ui_session', true);
    verify('password_cleared_after_signup', await a.getByLabel('Contraseña', { exact: true }).count() === 0);
    verify('upload_requires_initial_fetch', await a.getByRole('button', { name: 'Subir mi plan', exact: true }).count() === 0);
    stage = 'first-owned-workspace';
    await a.getByRole('button', { name: 'Consultar versión remota', exact: true }).click();
    await expect(a.getByText('Todavía no hay una copia remota.', { exact: true })).toBeVisible();
    verify('account_a_initial_remote_empty', await remote(a) === null);
    await upload(a);
    await expect(a.getByText('Copia remota guardada.', { exact: true })).toBeVisible();
    const initial = await remote(a);
    verify('ui_upload_stored_household_and_container', !!initial && initial.revision === 1 && initial.payload.household?.label === 'Hosted verification household' && initial.payload.containers.length === 1 && initial.payload.containers[0].volume === 600);
    if (!initial) throw new Error('hosted-snapshot-unavailable');
    stage = 'session-reload';
    await a.reload(); await connected(a);
    verify('session_survives_reload', true);
    verify('get_session_returns_user', await a.evaluate(async () => {
      const moduleUrl = '/src/cloud.ts', { cloud } = await import(moduleUrl);
      const { data, error } = await cloud.auth.getSession(); return !error && !!data.session?.user?.id;
    }));
    stage = 'signup-b';
    const b = await newPage(); await b.goto('/#settings');
    await signup(b, accountB.email, accountB.password, created);
    verify('signup_b_real_isolated_session', true);
    await b.getByRole('button', { name: 'Consultar versión remota', exact: true }).click();
    await expect(b.getByText('Todavía no hay una copia remota.', { exact: true })).toBeVisible();
    verify('account_b_initial_remote_empty', await remote(b) === null);
    stage = 'cross-owner-data-api';
    const crossOwner = await b.evaluate(async snapshot => {
      const moduleUrl = '/src/cloud.ts', { cloud } = await import(moduleUrl);
      const read = await cloud.from('household_workspaces').select('id').eq('id', snapshot.id);
      const write = await cloud.rpc('update_workspace', { p_workspace_id: snapshot.id, p_payload: snapshot.payload, p_expected_revision: snapshot.revision });
      return { readDeniedOrEmpty: !!read.error || Array.isArray(read.data) && read.data.length === 0, writeDenied: !!write.error, writeCode: write.error?.code ?? null };
    }, initial);
    verify('cross_owner_select_denied_or_empty', crossOwner.readDeniedOrEmpty);
    verify('cross_owner_rpc_denied', crossOwner.writeDenied && crossOwner.writeCode === '40001');
    verify('cross_owner_attempt_preserves_a', JSON.stringify(await remote(a)) === JSON.stringify(initial));
    verify('cross_owner_attempt_does_not_create_b_workspace', await remote(b) === null);
    stage = 'malformed-and-direct-update';
    const rejected = await a.evaluate(async snapshot => {
      const moduleUrl = '/src/cloud.ts', { cloud } = await import(moduleUrl);
      const malformed = await cloud.rpc('update_workspace', { p_workspace_id: snapshot.id, p_payload: { ...snapshot.payload, schema_version: 99 }, p_expected_revision: snapshot.revision });
      const direct = await cloud.from('household_workspaces').update({ revision: 999 }).eq('id', snapshot.id).select('revision');
      const anotherId = crypto.randomUUID();
      const another = await cloud.rpc('update_workspace', { p_workspace_id: anotherId, p_payload: { ...snapshot.payload, id: anotherId }, p_expected_revision: 0 });
      return { malformedDenied: !!malformed.error && malformed.error.code === '22023', directDenied: !!direct.error && direct.error.code === '42501', secondOwnedDenied: !!another.error && another.error.code === '40001' };
    }, initial);
    verify('malformed_payload_rejected', rejected.malformedDenied);
    verify('direct_table_update_denied', rejected.directDenied);
    verify('second_owned_workspace_denied', rejected.secondOwnedDenied);
    verify('rejected_mutations_preserve_payload_and_revision', JSON.stringify(await remote(a)) === JSON.stringify(initial));
    stage = 'anonymous-and-invalid-jwt';
    const unauthenticated = await b.evaluate(async url => {
      const endpoint = `${url}/household_workspaces?select=id`;
      const anonymous = await fetch(endpoint, { credentials: 'omit' });
      const anonymousBody = await anonymous.json();
      const invalid = await fetch(endpoint, { credentials: 'omit', headers: { Authorization: 'Bearer invalid-test-jwt' } });
      // The Data API gateway can reject missing/malformed authorization with 400 rather than
      // PostgreSQL's 401/403. The same resource/query is known to work with A's real JWT.
      return {
        anonymousStatus: anonymous.status, invalidJwtStatus: invalid.status,
        anonymousDeniedOrEmpty: anonymous.status >= 400 && anonymous.status < 500 || anonymous.ok && Array.isArray(anonymousBody) && anonymousBody.length === 0,
        invalidJwtRejected: invalid.status >= 400 && invalid.status < 500,
      };
    }, publicCloud.dataApiUrl);
    observedHttpStatuses.anonymous = unauthenticated.anonymousStatus;
    observedHttpStatuses.invalid_jwt = unauthenticated.invalidJwtStatus;
    verify('anonymous_cannot_read_workspace', unauthenticated.anonymousDeniedOrEmpty);
    verify('invalid_jwt_rejected', unauthenticated.invalidJwtRejected);
    stage = 'second-device-signin';
    const a2 = await newPage(); await a2.goto('/#settings');
    await fillCredentials(a2, accountA.email, accountA.password);
    await a2.getByRole('button', { name: 'Ingresar con correo', exact: true }).click(); await connected(a2);
    verify('second_device_real_password_signin', true);
    await a2.getByRole('button', { name: 'Consultar versión remota', exact: true }).click();
    await expect(a2.getByRole('button', { name: 'Recuperar copia', exact: true })).toBeVisible();
    a2.once('dialog', prompt => prompt.accept());
    await a2.getByRole('button', { name: 'Recuperar copia', exact: true }).click();
    await expect(a2.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Hosted verification household');
    const restored = await localExport(a2);
    verify('cross_device_household_and_containers_restored', JSON.stringify(restored.household) === JSON.stringify(initial.payload.household) && JSON.stringify(restored.containers) === JSON.stringify(initial.payload.containers));
    verify('export_excludes_identity_and_credentials', !JSON.stringify(restored).includes(accountA.email) && !JSON.stringify(restored).includes(accountA.password));
    stage = 'two-device-stale-revision';
    await a.getByRole('button', { name: 'Consultar versión remota', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Subir mi plan', exact: true })).toBeVisible();
    verify('two_devices_share_fetched_revision', (await remote(a2))?.revision === initial.revision);
    await a.getByLabel('Nombre del hogar', { exact: true }).fill('Hosted winning edit');
    await a.getByRole('button', { name: 'Guardar hogar', exact: true }).click();
    await a2.getByLabel('Nombre del hogar', { exact: true }).fill('Hosted stale edit');
    await a2.getByRole('button', { name: 'Guardar hogar', exact: true }).click();
    const staleLocal = await localExport(a2);
    await upload(a); await expect(a.getByText('Copia remota guardada.', { exact: true })).toBeVisible();
    const winner = await remote(a);
    verify('first_device_revision_advanced_once', !!winner && winner.revision === initial.revision + 1 && winner.payload.household?.label === 'Hosted winning edit');
    let staleWriteRequests = 0;
    a2.on('request', request => { if (request.method() === 'POST' && request.url() === `${publicCloud.dataApiUrl}/rpc/update_workspace`) staleWriteRequests++; });
    await upload(a2);
    await expect(a2.getByText('Sincronización pendiente. Revisa conexión, configuración o conflicto de versión y vuelve a consultar.', { exact: true })).toBeVisible();
    verify('stale_upload_requires_refetch', await a2.getByRole('button', { name: 'Subir mi plan', exact: true }).count() === 0);
    verify('stale_write_not_retried', staleWriteRequests === 1);
    verify('stale_write_preserves_remote', JSON.stringify(await remote(a)) === JSON.stringify(winner));
    verify('stale_write_preserves_local_payload_and_revision', JSON.stringify(await localExport(a2)) === JSON.stringify(staleLocal));
    stage = 'logout-and-reload';
    await a2.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await expect(a2.getByRole('button', { name: 'Ingresar con correo', exact: true })).toBeVisible();
    await a2.reload();
    await expect(a2.getByRole('button', { name: 'Ingresar con correo', exact: true })).toBeVisible();
    verify('logout_survives_reload', await a2.evaluate(async () => {
      const moduleUrl = '/src/cloud.ts', { cloud } = await import(moduleUrl);
      const { data, error } = await cloud.auth.getSession(); return !error && data.session === null;
    }));
    verify('logout_preserves_local_household', JSON.stringify(await localExport(a2)) === JSON.stringify(staleLocal));
    passed = true;
  } catch {
    // No raw SDK/HTTP/Playwright error escapes: those can contain form values or response bodies.
    throw new Error(`Hosted Neon verification failed at ${stage}; sanitized evidence records completed checks.`);
  } finally {
    // Only UUIDs returned by this run's successful signup requests enter this deletion allowlist.
    for (const id of created) {
      if (!uuid.test(id)) continue;
      cleanupAttempts++;
      if (await cliSucceeded(['neon-auth', 'user', 'delete', id, '--project-id', project, '--branch', branch])) deleted++;
    }
    await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
    const cleanupConfirmed = deleted === created.size;
    const evidence = {
      schema_version: 1, source: 'actualNeonAuth+DataAPI+browsernotmock',
      observed_at: new Date().toISOString(), elapsed_ms: Date.now() - started,
      result: passed && cleanupConfirmed ? 'passed' : 'failed',
      failed_stage: passed ? cleanupConfirmed ? null : 'disposable-user-cleanup' : stage,
      browser_origin: browserOrigin, server_html_verified: serverHtmlVerified,
      public_auth_url: publicCloud.authUrl, public_data_api_url: publicCloud.dataApiUrl,
      checks, checks_passed: Object.values(checks).filter(Boolean).length, observed_http_statuses: observedHttpStatuses,
      created_users: created.size, cleanup_attempted_users: cleanupAttempts, cleanup_cli_successes: deleted,
      cleanup_unconfirmed_users: created.size - deleted,
      database_cascade_count_verified: false,
      credentials_or_user_identifiers_included: false,
      google_oauth_verified: false, public_deployment_verified: false,
    };
    await writeFile(new URL(`../../artifacts/verification/${evidenceName}`, import.meta.url), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    if (!cleanupConfirmed) throw new Error('Disposable hosted-user cleanup was not confirmed; see sanitized evidence counts.');
  }
});
