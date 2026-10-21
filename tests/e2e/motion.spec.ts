import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/');
  await page.getByLabel('Nombre del hogar', { exact: true }).fill('Motion household');
  await page.getByLabel('Distrito', { exact: true }).fill('Pueblo Libre');
  await page.getByRole('button', { name: 'Crear mi plan local', exact: true }).click();
  await page.locator('a[href="#reserve"]:visible').first().click();
  await page.getByRole('button', { name: 'Añadir recipiente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del recipiente', { exact: true }).fill('Water tank');
  await dialog.getByLabel('Capacidad (L)', { exact: true }).fill('200');
  await dialog.getByLabel('Agua disponible (L)', { exact: true }).fill('120');
  await dialog.getByRole('button', { name: 'Guardar recipiente', exact: true }).click();
  await page.locator('a[href="#home"]:visible').first().click();
}

test('water moves visually without changing liters and task completion receives feedback', async ({ page }) => {
  await setup(page);
  const water = page.locator('.tank-column[data-category="other"] .water-wave').first();
  await expect(water).toHaveCSS('animation-name', 'water-drift');
  const before = await water.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => water.evaluate(element => getComputedStyle(element).transform)).not.toBe(before);
  await expect(page.locator('.tank-column[data-category="other"] .tank-fill')).toHaveAttribute('data-level', '0.6');
  await page.locator('a[href="#tasks"]:visible').first().click();
  await page.getByLabel('Qué hay que hacer', { exact: true }).fill('Review reserve');
  await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
  await page.getByLabel('Review reserve', { exact: true }).check();
  await expect(page.locator('.task-list .completed .completion-mark')).toBeVisible();
  await expect(page.getByLabel('Review reserve', { exact: true })).toBeChecked();
  await page.locator('a[href="#home"]:visible').first().click();
  await expect(page.locator('.tank-column[data-category="other"] .tank-fill')).toHaveAttribute('data-level', '0.6');
});

test('motion can be disabled per device and system reduced motion is respected', async ({ page }) => {
  await setup(page); await page.locator('a[href="#settings"]:visible').first().click();
  const toggle = page.getByLabel('Animaciones de la interfaz', { exact: true });
  await expect(toggle).toBeChecked(); await toggle.uncheck();
  await page.locator('a[href="#home"]:visible').first().click();
  await expect(page.locator('.water-wave').first()).toHaveCSS('animation-name', 'none');
  await page.reload(); await expect(page.locator('.water-wave').first()).toHaveCSS('animation-name', 'none');
  await page.locator('a[href="#settings"]:visible').first().click(); await toggle.check();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(toggle).toBeDisabled();
  await page.locator('a[href="#home"]:visible').first().click();
  await expect(page.locator('.water-wave').first()).toHaveCSS('animation-name', 'none');
});
