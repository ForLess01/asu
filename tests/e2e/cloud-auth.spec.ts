import { test, expect, type Page } from '@playwright/test';
import { emptyWorkspace, revise, type Workspace } from '../../packages/domain/src/index';

const accountA = 'a0000000-0000-4000-8000-000000000001', accountB = 'b0000000-0000-4000-8000-000000000002';
type Snapshot = { id: string; revision: number; payload: Workspace };
function seeded(label = 'Remote household'): Snapshot {
  const payload = revise(emptyWorkspace(), state => { state.household = { label, district: 'Pueblo Libre', department: 'LIMA', eps: 'SEDAPAL', occupancy: 4 }; });
  return { id: payload.id, revision: 5, payload };
}

// Mock only the cloud boundary. No raw credentials are retained in traces or screenshots.
async function mockCloud(page: Page, options: { outcome?: string; logoutFails?: boolean; conflict?: boolean; remote?: Snapshot } = {}) {
  const remotes = new Map<string, Snapshot>(); if (options.remote) remotes.set(accountA, options.remote);
  const authRequests: unknown[] = [], writes: Workspace[] = [];
  await page.route('**/__mock_auth', async route => { authRequests.push(route.request().postDataJSON()); await route.fulfill({ json: { outcome: options.outcome ?? 'connected' } }); });
  await page.route('**/__mock_workspace*', async route => {
    const id = new URL(route.request().url()).searchParams.get('id')!;
    if (route.request().method() === 'GET') { await route.fulfill({ json: { snapshot: remotes.get(id) ?? null } }); return; }
    const { state, baseline } = route.request().postDataJSON(); writes.push(state);
    if (options.conflict || (baseline?.revision ?? 0) !== (remotes.get(id)?.revision ?? 0)) {
      if (options.conflict) remotes.set(id, seeded('Updated on another device'));
      await route.fulfill({ status: 409, json: { code: '40001' } }); return;
    }
    const snapshot = { id: remotes.get(id)?.id ?? state.id, revision: (remotes.get(id)?.revision ?? 0) + 1, payload: state };
    remotes.set(id, snapshot); await route.fulfill({ json: snapshot });
  });
  await page.route('**/src/cloud.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    let identity = JSON.parse(sessionStorage.getItem('mock-identity') || 'null');
    const listeners = new Set();
    const session = () => identity ? { user: identity } : null;
    const emit = () => { sessionStorage.setItem('mock-identity', JSON.stringify(identity)); for (const listener of listeners) listener('SIGNED_IN', session()); };
    export const cloud = { auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      onAuthStateChange: listener => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; },
      signOut: async () => { if (${!!options.logoutFails}) return { error: new Error('service-unavailable') }; identity = null; emit(); return { error: null }; }
    } };
    export async function authenticateEmail(action, fields) {
      const { outcome } = await (await fetch('/__mock_auth', { method: 'POST', body: JSON.stringify({ action, fields }) })).json();
      if (outcome === 'error') throw new Error('service-unavailable');
      if (outcome === 'connected') { identity = { id: fields.email.startsWith('second') ? '${accountB}' : '${accountA}', email: fields.email }; emit(); }
      return outcome;
    }
    export async function googleSignInUrl() { throw new Error('provider-disabled'); }
    export async function fetchSnapshot(id) { return (await (await fetch('/__mock_workspace?id=' + id)).json()).snapshot; }
    export async function pushSnapshot(state, baseline, id) {
      const response = await fetch('/__mock_workspace?id=' + id, { method: 'POST', body: JSON.stringify({ state, baseline }) });
      if (!response.ok) throw { code: '40001' }; return response.json();
    }
  ` }));
  await page.goto('/#settings');
  return { authRequests, writes, remotes };
}
async function signIn(page: Page, email = 'mock-person@example.com') {
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('fictional-test-only-password');
  await page.getByRole('button', { name: 'Ingresar con correo', exact: true }).click();
  await expect(page.getByText('Cuenta conectada · guardado automático', { exact: true })).toBeVisible();
}
async function exported(page: Page) {
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar mis datos JSON', exact: true }).click();
  const stream = await (await download).createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test('signup validates, clears credentials and automatically saves a guest plan without manual upload', async ({ page }) => {
  const mocked = await mockCloud(page);
  await page.getByLabel('Nombre del hogar', { exact: true }).fill('Guest household');
  await page.getByLabel('Distrito', { exact: true }).fill('Pueblo Libre');
  await page.getByRole('button', { name: 'Crear mi plan local', exact: true }).click();
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Nombre de la cuenta', { exact: true }).focus(); await page.getByLabel('Nombre de la cuenta', { exact: true }).blur();
  await expect(page.getByRole('alert')).toContainText('nombre'); expect(mocked.authRequests).toHaveLength(0);
  await page.getByLabel('Nombre de la cuenta', { exact: true }).fill('Persona de prueba');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('not-email'); await page.getByLabel('Correo electrónico', { exact: true }).blur();
  await expect(page.getByRole('alert')).toContainText('correo');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('mock-person@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('short'); await page.getByLabel('Contraseña', { exact: true }).blur();
  await expect(page.getByRole('alert')).toContainText('8');
  await page.getByLabel('Contraseña', { exact: true }).fill('fictional-test-only-password');
  await page.getByLabel('Contraseña', { exact: true }).press('Tab');
  await expect(page.getByRole('button', { name: 'Registrarme con correo', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Registrarme con correo', exact: true }).click();
  await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon');
  expect(mocked.remotes.get(accountA)?.payload.household?.label).toBe('Guest household');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Subir mi plan', exact: true })).toHaveCount(0);
  const data = await exported(page);
  for (const forbidden of ['fictional-test-only-password', 'mock-person@example.com', 'Persona de prueba', accountA]) expect(data).not.toContain(forbidden);
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Guest household');
  await expect(page.getByTestId('account-save-status')).toHaveCount(0);
});

test('signin hydrates remote seed data, saves edits outside Settings and recovers on reload', async ({ page }) => {
  const mocked = await mockCloud(page, { remote: seeded() }); await signIn(page);
  await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Remote household');
  await page.locator('a[href="#tasks"]:visible').first().click();
  await page.getByLabel('Qué hay que hacer').fill('Automatically synced task');
  await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
  await expect.poll(() => mocked.remotes.get(accountA)?.payload.tasks[0]?.title).toBe('Automatically synced task');
  await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon');
  expect(mocked.remotes.get(accountA)?.payload.tasks[0].title).toBe('Automatically synced task');
  await page.reload(); await expect(page.getByLabel('Automatically synced task', { exact: true })).toBeVisible();
  await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon');
});

test('offline edits are queued durably and synchronize automatically on reconnect', async ({ page }) => {
  const mocked = await mockCloud(page, { remote: seeded() }); await signIn(page);
  await page.locator('a[href="#tasks"]:visible').first().click(); await page.context().setOffline(true);
  await page.getByLabel('Qué hay que hacer').fill('Offline task'); await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
  await expect(page.getByTestId('account-save-status')).toHaveText('Sin conexión · copia local');
  expect(mocked.writes).toHaveLength(0);
  const pending = await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('asu-household-v1'); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    return new Promise<boolean>((resolve, reject) => { const request = db.transaction('workspaces').objectStore('workspaces').get('account:' + id); request.onsuccess = () => resolve(JSON.parse(request.result).pending); request.onerror = reject; });
  }, accountA);
  expect(pending).toBe(true); await page.context().setOffline(false);
  await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon');
  expect(mocked.remotes.get(accountA)?.payload.tasks[0].title).toBe('Offline task');
});

test('conflicts stop automatic writes and remote replacement requires an explicit choice', async ({ page }) => {
  const mocked = await mockCloud(page, { remote: seeded(), conflict: true }); await signIn(page);
  await page.getByLabel('Nombre del hogar', { exact: true }).fill('My local edit'); await page.getByRole('button', { name: 'Guardar hogar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Otro dispositivo');
  expect(mocked.writes).toHaveLength(1);
  expect(JSON.parse(await exported(page)).household.label).toBe('My local edit');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Usar copia de Neon', exact: true }).click();
  await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Updated on another device');
  expect(mocked.writes).toHaveLength(1);
});

test('a failed logout preserves the connected account and its data', async ({ page }) => {
  await mockCloud(page, { remote: seeded('Private account A'), logoutFails: true }); await signIn(page);
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await expect(page.getByText('Cuenta conectada · guardado automático', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Private account A');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
});

test('account changes never expose the previous account plan as guest or another account', async ({ page }) => {
  const mocked = await mockCloud(page, { remote: seeded('Private account A') }); await signIn(page);
  await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Private account A');
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('');
  await signIn(page, 'second@example.com');
  await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('');
  await page.getByLabel('Nombre del hogar', { exact: true }).fill('Account B');
  await page.getByLabel('Distrito', { exact: true }).fill('Pueblo Libre');
  await page.getByRole('button', { name: 'Crear mi plan', exact: true }).click();
  await expect.poll(() => mocked.remotes.get(accountB)?.payload.household?.label).toBe('Account B');
  expect(mocked.remotes.get(accountA)?.payload.household?.label).toBe('Private account A');
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await signIn(page); await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Private account A');
});

for (const action of ['signin', 'signup'] as const) {
  test(`${action} errors clear passwords without changing local data`, async ({ page }) => {
    const mocked = await mockCloud(page, { outcome: 'error' }), revision = await page.getByText(/versión local/).textContent();
    if (action === 'signup') { await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click(); await page.getByLabel('Nombre de la cuenta', { exact: true }).fill('Persona'); }
    await page.getByLabel('Correo electrónico', { exact: true }).fill('mock-person@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('fictional-test-only-password');
    await page.getByRole('button', { name: action === 'signup' ? 'Registrarme con correo' : 'Ingresar con correo', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('No se pudo conectar'); await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(page.getByText(/versión local/)).toHaveText(revision!); expect(mocked.writes).toHaveLength(0);
  });
}

test('verification, disabled Google, offline and example mode remain explicit', async ({ page }) => {
  const mocked = await mockCloud(page, { outcome: 'verification-required' });
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await page.getByLabel('Email address', { exact: true }).fill('mock-person@example.com'); await page.getByLabel('Password', { exact: true }).fill('fictional-test-only-password');
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect with Google', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Google');
  await page.context().setOffline(true); await expect(page.getByRole('button', { name: 'Sign in with email', exact: true })).toBeDisabled();
  await page.context().setOffline(false); await page.getByRole('button', { name: 'Open example', exact: true }).click();
  await page.locator('a[href="#settings"]:visible').first().click();
  await expect(page.getByText('El ejemplo no se sincroniza. Vuelve a tus datos para conectar una cuenta.', { exact: true })).toBeVisible();
  expect(mocked.writes).toHaveLength(0);
});
