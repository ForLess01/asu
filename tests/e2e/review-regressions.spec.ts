import { expect, test } from '@playwright/test';

test('lab rejects substituted metrics instead of displaying a ready mixed bundle', async ({ page, context }) => {
  await context.route('**/models/current/metrics.json', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), source_sha256: 'f'.repeat(64), run_id: 'unrelated-source-run' } });
  });
  await page.goto('/#lab');
  await expect(page.getByTestId('model-status')).toHaveText('No disponible', { timeout: 25000 });
  await expect(page.locator('.metrics-json')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ejecutar modelo histórico' })).toHaveCount(0);
});

test('lab rejects a mismatched checksum set', async ({ page, context }) => {
  await context.route('**/models/current/checksums.json', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), 'model.json': '0'.repeat(64) } });
  });
  await page.goto('/#lab');
  await expect(page.getByTestId('model-status')).toHaveText('No disponible', { timeout: 25000 });
  await expect(page.locator('.metrics-json')).toHaveCount(0);
});

test('overdue and stale warnings refresh while idle, and on visibility revalidation', async ({ page }) => {
  const start = new Date('2026-10-21T17:00:00Z');
  await page.clock.install({ time: start });
  await page.goto('/');
  await page.getByRole('button', { name: 'Primero, explorar un ejemplo' }).click();
  await page.locator('a[href="#tasks"]:visible').first().click();
  await page.getByLabel('Qué hay que hacer').fill('Revisar reserva al mediodía');
  await page.getByLabel('Recordar el · Lima (opcional)').fill('2026-10-21T12:01');
  await page.getByRole('button', { name: 'Añadir tarea' }).click();
  await expect(page.getByRole('checkbox', { name: /^Revisar reserva al mediodía/ })).toBeVisible();
  // Drain the unrelated save-toast timeout before observing an otherwise idle page.
  await page.clock.fastForward(6000);
  const due = page.getByText('tareas pendientes con fecha alcanzada.', { exact: false });
  await expect(due).toHaveCount(0);
  await page.clock.fastForward(120000);
  await expect(due).toBeVisible();
  await expect(page.getByText('Hay mediciones de reserva con más de 24 h.', { exact: false })).toHaveCount(0);
  // A system-clock jump models a suspended tab: no timer or user interaction fires.
  await page.clock.setSystemTime(new Date(start.getTime() + 25 * 3600000));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('Hay mediciones de reserva con más de 24 h.', { exact: false })).toBeVisible();
});
