import { test, expect } from '@playwright/test';

test('household fields use reference choices, validate arbitrary text and complete unique prefixes with Tab', async ({ page }) => {
  await page.goto('/');
  const department = page.getByLabel('Departamento', { exact: true });
  await expect(department).toHaveJSProperty('tagName', 'SELECT');
  await expect(department.locator('option')).toHaveCount(26);
  await page.getByLabel('Nombre del hogar', { exact: true }).fill('Keyboard household');
  const district = page.getByLabel('Distrito', { exact: true });
  await district.fill('Not a district'); await district.press('Tab');
  await expect(page.getByRole('alert')).toContainText('Selecciona una opción');
  await district.fill('Pueblo Li'); await district.press('Tab');
  await expect(district).toHaveValue('Pueblo Libre');
  await page.getByRole('button', { name: 'Crear mi plan local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu hogar, mejor preparado.' })).toBeVisible();
});

test('changing department resets dependent fields and does not silently accept an unrelated district', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Nombre del hogar', { exact: true }).fill('Regional household');
  await page.getByLabel('Distrito', { exact: true }).fill('Pueblo Libre');
  await page.getByLabel('Departamento', { exact: true }).selectOption('AREQUIPA');
  await expect(page.getByLabel('Distrito', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Empresa de agua (EPS)', { exact: true })).toHaveValue('');
  await page.getByLabel('Distrito', { exact: true }).fill('Pueblo Libre'); await page.getByLabel('Distrito', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Distrito', { exact: true }).fill('Arequipa'); await page.getByLabel('Distrito', { exact: true }).press('Tab');
  await page.getByLabel('Empresa de agua (EPS)', { exact: true }).fill('SEDAPAR');
  await page.getByRole('button', { name: 'Crear mi plan local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu hogar, mejor preparado.' })).toBeVisible();
});

test('newer or unlisted districts and providers require an explicit not-listed choice', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Nombre del hogar', { exact: true }).fill('Unlisted household');
  await page.getByLabel('Mi distrito no figura en el catálogo', { exact: true }).check();
  await page.getByLabel('Distrito', { exact: true }).fill('Nuevo distrito de prueba');
  await page.getByLabel('Mi prestadora no figura en la lista', { exact: true }).check();
  await page.getByLabel('Empresa de agua (EPS)', { exact: true }).fill('Prestadora de prueba');
  await page.getByRole('button', { name: 'Crear mi plan local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu hogar, mejor preparado.' })).toBeVisible();
});

test('container suggestions complete names without inventing measurements', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Nombre del hogar', { exact: true }).fill('Suggestion household');
  await page.getByLabel('Distrito', { exact: true }).fill('Pueblo Libre');
  await page.getByRole('button', { name: 'Crear mi plan local', exact: true }).click();
  await page.locator('a[href="#reserve"]:visible').first().click();
  await page.getByRole('button', { name: 'Añadir recipiente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del recipiente', { exact: true }).fill('Cis');
  await dialog.getByLabel('Nombre del recipiente', { exact: true }).press('Tab');
  await expect(dialog.getByLabel('Nombre del recipiente', { exact: true })).toHaveValue('Cisterna');
  await expect(dialog.getByLabel('Capacidad (L)', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Agua disponible (L)', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Uso del agua', { exact: true })).toHaveJSProperty('tagName', 'SELECT');
});
