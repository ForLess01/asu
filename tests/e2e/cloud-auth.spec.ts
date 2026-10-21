import { test, expect, type Page } from '@playwright/test';

// Mock the cloud boundary, not a hosted-service claim. Unit tests cover the real SDK adapter calls.
// No trace/screenshot records form credentials, even these fictional test-only values.
async function mockCloud(page: Page, outcome: 'connected' | 'error' | 'verification-required' = 'connected', logoutFails = false) {
  const requests: { action: string; fields?: { name: string; email: string; password: string } }[] = [];
  await page.route('**/__mock_auth', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { outcome } });
  });
  await page.route('**/src/cloud.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    let identity = null;
    const listeners = new Set();
    const session = () => identity ? { user: identity } : null;
    const emit = () => { for (const listener of listeners) listener('SIGNED_IN', session()); };
    export const cloud = { auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      onAuthStateChange: listener => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; },
      signOut: async () => { if (${logoutFails}) return { error: new Error('service-unavailable') }; identity = null; emit(); return { error: null }; }
    } };
    export async function authenticateEmail(action, fields) {
      const { outcome } = await (await fetch('/__mock_auth', { method: 'POST', body: JSON.stringify({ action, fields }) })).json();
      if (outcome === 'error') throw new Error('service-unavailable');
      if (outcome === 'connected') { identity = { id: 'mock-provider-id', email: fields.email }; emit(); }
      return outcome;
    }
    export async function googleSignInUrl() { throw new Error('provider-disabled'); }
    export async function fetchSnapshot() { return null; }
    export async function pushSnapshot() { throw new Error('revision-conflict'); }
  ` }));
  await page.goto('/#settings');
  return requests;
}

test('email signup validates inline, clears passwords, exposes identity and keeps credentials out of exports', async ({ page }) => {
  const requests = await mockCloud(page);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Nombre de la cuenta', { exact: true }).focus();
  await page.getByLabel('Nombre de la cuenta', { exact: true }).blur();
  await expect(page.getByRole('alert')).toContainText('nombre');
  expect(requests).toHaveLength(0);
  await page.getByLabel('Nombre de la cuenta', { exact: true }).fill('Persona de prueba');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('not-an-email');
  await page.getByLabel('Correo electrónico', { exact: true }).blur();
  await expect(page.getByRole('alert')).toContainText('correo');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('mock-person@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('short');
  await page.getByLabel('Contraseña', { exact: true }).blur();
  await expect(page.getByRole('alert')).toContainText('8');
  expect(requests).toHaveLength(0);
  await page.getByLabel('Contraseña', { exact: true }).fill('fictional-test-only-password');
  await page.getByLabel('Contraseña', { exact: true }).press('Tab');
  await expect(page.getByRole('button', { name: 'Registrarme con correo', exact: true })).toBeFocused();
  const button = await page.getByRole('button', { name: 'Registrarme con correo', exact: true }).boundingBox();
  expect(button?.height).toBeGreaterThanOrEqual(48);
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Registrarme con correo', exact: true }).click();
  await expect(page.getByText('Cuenta conectada · sincronización manual', { exact: true })).toBeVisible();
  await expect(page.getByText('mock-person@example.com', { exact: true })).toBeVisible();
  expect(requests).toEqual([{ action: 'signup', fields: { name: 'Persona de prueba', email: 'mock-person@example.com', password: 'fictional-test-only-password' } }]);
  await expect(page.getByRole('button', { name: 'Subir mi plan', exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar mis datos JSON' }).click();
  const download = await downloadPromise, stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  const exported = Buffer.concat(chunks).toString();
  expect(exported).not.toContain('fictional-test-only-password'); expect(exported).not.toContain('mock-person@example.com'); expect(exported).not.toContain('Persona de prueba');
  const before = JSON.parse(exported);
  await page.getByRole('button', { name: 'Consultar versión remota', exact: true }).click();
  await expect(page.getByText('Todavía no hay una copia remota.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  await expect(page.getByText('mock-person@example.com', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Subir mi plan', exact: true })).toHaveCount(0);
  const nextDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar mis datos JSON' }).click();
  const nextStream = await (await nextDownload).createReadStream(), nextChunks: Buffer[] = [];
  for await (const chunk of nextStream!) nextChunks.push(chunk);
  expect(JSON.parse(Buffer.concat(nextChunks).toString())).toEqual(before);
});

test('sync conflicts require another fetch and failed logout never clears a connected account', async ({ page }) => {
  await mockCloud(page, 'connected', true);
  const revision = await page.getByText(/versión local/).textContent();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('mock-person@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('fictional-test-only-password');
  await page.getByRole('button', { name: 'Ingresar con correo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Subir mi plan', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Consultar versión remota', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Subir mi plan', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Subir mi plan', exact: true }).click();
  await expect(page.getByText('Sincronización pendiente. Revisa conexión, configuración o conflicto de versión y vuelve a consultar.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subir mi plan', exact: true })).toHaveCount(0);
  await expect(page.getByText('Copia remota guardada.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/versión local/)).toHaveText(revision!);
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await expect(page.getByText('Cuenta conectada · sincronización manual', { exact: true })).toBeVisible();
  await expect(page.getByText('mock-person@example.com', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/versión local/)).toHaveText(revision!);
});

for (const action of ['signin', 'signup'] as const) {
  test(`${action} errors clear the password, do not claim connected or alter local revision`, async ({ page }) => {
    const requests = await mockCloud(page, 'error');
    const revision = await page.getByText(/versión local/).textContent();
    if (action === 'signup') {
      await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
      await page.getByLabel('Nombre de la cuenta', { exact: true }).fill('Persona');
    }
    await page.getByLabel('Correo electrónico', { exact: true }).fill('mock-person@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('fictional-test-only-password');
    await page.getByRole('button', { name: action === 'signup' ? 'Registrarme con correo' : 'Ingresar con correo', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('No se pudo conectar');
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(page.getByText('Cuenta conectada · sincronización manual', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/versión local/)).toHaveText(revision!);
    expect(requests).toHaveLength(1);
  });
}

test('pending email verification and disabled Google remain honest; offline and example mode prevent auth', async ({ page }) => {
  const requests = await mockCloud(page, 'verification-required');
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await page.getByLabel('Email address', { exact: true }).fill('mock-person@example.com');
  await page.getByLabel('Password', { exact: true }).fill('fictional-test-only-password');
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByText('Account connected · manual sync', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect with Google', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Google');
  await page.context().setOffline(true);
  await expect(page.getByRole('button', { name: 'Sign in with email', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Connect with Google', exact: true })).toBeDisabled();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Open example', exact: true }).click();
  // Switching workspaces intentionally returns home and restores that workspace's Spanish locale.
  await page.locator('a[href="#settings"]:visible').first().click();
  await expect(page.getByText('El ejemplo no se sincroniza. Vuelve a tus datos para conectar una cuenta.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);
});
