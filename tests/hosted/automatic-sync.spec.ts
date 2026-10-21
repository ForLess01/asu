import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

test('seeded account loads real database data and saves online/offline changes automatically', async ({ browser }, testInfo) => {
  test.skip(process.env.ASU_RUN_SEED_TESTS !== '1', 'Persistent seed-account verification is opt-in.');
  const origin = testInfo.project.use.baseURL!;
  const credentialsFile = resolve('.env.seed.local');
  const fields = Object.fromEntries((await readFile(credentialsFile, 'utf8')).trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
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
    await target.getByRole('button', { name: 'Editar Tanque principal · demo', exact: true }).click();
    const dialog = target.getByRole('dialog');
    await dialog.getByLabel('Agua disponible (L)', { exact: true }).fill(volume);
    await dialog.getByRole('button', { name: 'Guardar recipiente', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  try {
    verify('credentials_file_private', ((await stat(credentialsFile)).mode & 0o777) === 0o600);
    await signin(page); verify('real_seed_account_signin', true);
    await expect(page.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('Hogar de demostración · datos ficticios');
    verify('direct_database_seed_hydrated_without_manual_restore', true);
    if (process.env.ASU_VISUAL_DIRECTORY) await page.screenshot({ path: resolve(process.env.ASU_VISUAL_DIRECTORY, 'asu-account-settings-desktop.png'), fullPage: true, mask: [page.locator('.account-identity')] });
    await reserves(page); await expect(page.getByTestId('container-row')).toHaveCount(3);
    verify('seeded_containers_present', true);
    stage = 'automatic-online-save';
    const saved = page.waitForResponse(response => response.url().includes('/rpc/update_workspace') && response.request().method() === 'POST');
    await editVolume(page, '599'); edited = true;
    verify('automatic_online_rpc_succeeded', (await saved).ok());
    await expect(page.getByTestId('account-save-status')).toHaveText('Guardado en Neon', { timeout: 30000 });
    await page.reload(); await expect(page.getByTestId('container-row').filter({ hasText: 'Tanque principal · demo' })).toContainText('599');
    verify('online_edit_survives_reload', true);
    stage = 'offline-queue';
    await desktop.setOffline(true); await editVolume(page, '598');
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
    await expect(phone.getByTestId('container-row').filter({ hasText: 'Tanque principal · demo' })).toContainText('598');
    verify('second_device_automatically_recovers_latest_edit', true);
    verify('mobile_has_no_horizontal_overflow', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await phone.goto('/#settings'); await phone.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await expect(phone.getByTestId('account-save-status')).toHaveCount(0);
    await expect(phone.getByLabel('Nombre del hogar', { exact: true })).toHaveValue('');
    verify('logout_returns_to_isolated_guest', true);
  } catch { failed = stage; }
  finally {
    if (edited && restore) {
      try {
        await desktop.setOffline(false); await editVolume(page, '600');
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
