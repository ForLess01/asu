import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

test('seeded account loads real database data and saves online/offline changes automatically', async ({ browser }, testInfo) => {
  test.skip(process.env.ASU_RUN_SEED_TESTS !== '1', 'Persistent seed-account verification is opt-in.');
  const origin = testInfo.project.use.baseURL!;
  const credentialsFile = resolve('.env.seed.local');
  const fields = Object.fromEntries((await readFile(credentialsFile, 'utf8')).trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  const household = fields.ASU_SEED_HOUSEHOLD ?? 'Hogar de demostración · datos ficticios';
  const tank = fields.ASU_SEED_TANK ?? 'Tanque principal · demo';
  const initialVolume = Number(fields.ASU_SEED_VOLUME ?? 600);
  const containerCount = Number(fields.ASU_SEED_CONTAINER_COUNT ?? 3);
  const checks: Record<string, boolean> = {}, contexts = [], restore = process.env.ASU_RESTORE_SEED !== '0';
  const verify = (name: string, passed: boolean) => { checks[name] = passed; if (!passed) throw new Error(name); };
  let stage = 'signin', failed: string | null = null, edited = false, restored = false;
  const desktop = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } }); contexts.push(desktop);
  const page = await desktop.newPage();
  const signin = async (target: Page) => {
    await target.goto('/#settings');
    await target.getByLabel('Correo electrónico', { exact: true }).fill(fields.ASU_SEED_EMAIL);
    await target.getByLabel('Contraseña', { exact: true }).fill(fields.ASU_SEED_PASSWORD);
    await target.getByRole('button', { name: 'Ingresar con correo', exact: true }).click();
    await expect(target.getByText('Cuenta conectada · guardado automático', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(target.getByTestId('account-save-status')).toHaveText('Guardado en Neon', { timeout: 30000 });
  };
  const reserves = (target: Page) => target.locator('a[href="#reserve"]:visible').first().click();
  const editVolume = async (target: Page, volume: string) => {
    await reserves(target);
    await target.getByRole('button', { name: `Editar ${tank}`, exact: true }).click();
    const dialog = target.getByRole('dialog');
    await dialog.getByLabel('Agua disponible (L)', { exact: true }).fill(volume);
    await dialog.getByRole('button', { name: 'Guardar recipiente', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  try {
    verify('credentials_file_private', ((await stat(credentialsFile)).mode & 0o777) === 0o600);
    await signin(page); verify('real_seed_account_signin', true);
    await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue(household);
    verify('direct_database_seed_hydrated_without_manual_restore', true);
    if (fields.ASU_SEED_DISPLAY_NAME) {
      await expect(page.locator('.account-identity')).toHaveText(fields.ASU_SEED_DISPLAY_NAME);
      verify('managed_profile_name_visible', true);
      await expect(page.getByLabel('Departamento', { exact: true })).toHaveValue(fields.ASU_SEED_DEPARTMENT);
      verify('personalized_department_visible', true);
    }
    if (process.env.ASU_VISUAL_DIRECTORY) await page.screenshot({ path: resolve(process.env.ASU_VISUAL_DIRECTORY, 'asu-account-settings-desktop.png'), fullPage: true, mask: [page.locator('.account-identity')] });
    await reserves(page); await expect(page.getByTestId('container-row')).toHaveCount(containerCount);
    verify('seeded_containers_present', true);
    if (fields.ASU_SEED_DISPLAY_NAME) verify('personalized_container_labels', !/\b(?:demo|prueba|fictici[oa]s?)\b/i.test(await page.getByTestId('container-row').allTextContents().then(values => values.join(' '))));
    stage = 'automatic-online-save';
    const saved = page.waitForResponse(response => response.url().includes('/rpc/update_workspace') && response.request().method() === 'POST');
    await editVolume(page, String(initialVolume-1)); edited = true;
    verify('automatic_online_rpc_succeeded', (await saved).ok());
    await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon', { timeout: 30000 });
    await page.reload(); await expect(page.getByTestId('container-row').filter({ hasText: tank })).toContainText(String(initialVolume-1));
    verify('online_edit_survives_reload', true);
    stage = 'offline-queue';
    await desktop.setOffline(true); await editVolume(page, String(initialVolume-2));
    await expect(page.getByTestId('account-save-status')).toHaveText('Sin conexión · copia local');
    verify('offline_edit_retained', true);
    const resumed = page.waitForResponse(response => response.url().includes('/rpc/update_workspace') && response.request().method() === 'POST');
    await desktop.setOffline(false); verify('reconnect_upload_succeeded', (await resumed).ok());
    await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon', { timeout: 30000 });
    stage = 'second-device';
    const mobile = await browser.newContext({ baseURL: origin, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }); contexts.push(mobile);
    const phone = await mobile.newPage(); await signin(phone);
    if (process.env.ASU_VISUAL_DIRECTORY) await phone.screenshot({ path: resolve(process.env.ASU_VISUAL_DIRECTORY, 'asu-account-settings-mobile.png'), fullPage: true, mask: [phone.locator('.account-identity')] });
    await reserves(phone);
    await expect(phone.getByTestId('container-row').filter({ hasText: tank })).toContainText(String(initialVolume-2));
    verify('second_device_automatically_recovers_latest_edit', true);
    verify('mobile_has_no_horizontal_overflow', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    stage = 'logout-navigation';
    await phone.goto('/#settings');
    stage = 'logout-request';
    await phone.getByRole('button', { name: 'Desconectar', exact: true }).click();
    stage = 'logout-session-cleared';
    await expect(phone.getByTestId('account-save-status')).toHaveCount(0);
    stage = 'logout-isolated-guest';
    await expect(phone.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('');
    verify('logout_returns_to_isolated_guest', true);
  } catch { failed = stage; }
  finally {
    if (edited && restore) {
      try {
        await desktop.setOffline(false); await editVolume(page, String(initialVolume));
        await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon', { timeout: 30000 }); restored = true;
      } catch { failed ??= 'seed-restoration'; }
    }
    await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
    const receipt = { observed_at: new Date().toISOString(), origin, status: failed ? 'failed' : 'passed', failed_stage: failed,
      checks, checks_passed: Object.values(checks).filter(Boolean).length, persistent_seed_account_retained: true,
      original_seed_volume_restored: restored, credentials_or_account_identifiers_included: false };
    await writeFile(resolve('artifacts/verification', origin.startsWith('https:') ? 'autosync-public.json' : 'autosync-local.json'), JSON.stringify(receipt, null, 2)+'\n');
if (failed) throw new Error(`Seed-account verification failed at ${failed}; credential-bearing errors suppressed.`);
  }
});

test('personalized home water and reserve visuals', async ({ browser }, testInfo) => {
  test.skip(process.env.ASU_RUN_SEED_TESTS !== '1' || !process.env.ASU_VISUAL_DIRECTORY, 'Private visual inspection requires explicit opt-in and output directory.');
  const fields = Object.fromEntries((await readFile(resolve('.env.seed.local'), 'utf8')).trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i+1)]; }));
  for (const [kind, width, height] of [['desktop', 1440, 1000], ['mobile', 375, 812]] as const) {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, reducedMotion: 'no-preference' });
    try {
      const page = await context.newPage(); await page.goto('/#settings');
      await page.getByLabel('Correo electrónico', { exact: true }).fill(fields.ASU_SEED_EMAIL);
      await page.getByLabel('Contraseña', { exact: true }).fill(fields.ASU_SEED_PASSWORD);
      await page.getByRole('button', { name: 'Ingresar con correo', exact: true }).click();
      await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon', { timeout: 30000 });
      await page.locator('a[href="#home"]:visible').first().click();
      await expect(page.locator('.household-context')).toContainText(fields.ASU_SEED_HOUSEHOLD);
      const wave = page.locator('.water-wave').first(), start = await wave.evaluate(element => getComputedStyle(element).transform);
      await expect.poll(() => wave.evaluate(element => getComputedStyle(element).transform)).not.toBe(start);
      await page.screenshot({ path: resolve(process.env.ASU_VISUAL_DIRECTORY!, `asu-personal-home-${kind}.png`), fullPage: true });
      await page.locator('a[href="#reserve"]:visible').first().click();
      await page.screenshot({ path: resolve(process.env.ASU_VISUAL_DIRECTORY!, `asu-personal-reserve-${kind}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } catch { throw new Error(`Personalized ${kind} visual inspection failed; private errors suppressed.`); }
    finally { await context.close(); }
  }
});
