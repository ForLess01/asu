import { readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const directory = '/Users/rendoaltar/Developer/ML/informes/asu/figures/screenshots';

test('capture actual report screenshots on isolated Asu dev server', async ({ page }) => {
  const only = process.env.ASU_CAPTURE_ONLY;
  const captions: Array<{ path: string; viewport: { width: number; height: number } | null; captured_at_utc: string; state: string; caption: string }> = [];
  const capture = async (filename: string, caption: string, state = 'guest-demo') => {
    if (only && only !== filename) return;
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByText('Modo ejemplo · datos ficticios separados de tu hogar', { exact: true })).toBeVisible();
    expect(await page.locator('body').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    const path = `${directory}/${filename}`, captured_at_utc = new Date().toISOString();
    await page.screenshot({ path, fullPage: false, animations: 'disabled' });
    captions.push({ path, viewport: page.viewportSize(), captured_at_utc, state, caption });
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Primero, explorar un ejemplo' }).click();
  await expect(page.getByRole('heading', { name: 'Tu hogar, mejor preparado.' })).toBeVisible();
  const contrast = await page.evaluate(() => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map(channel => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((total, channel, i) => total + channel * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const primary = getComputedStyle(document.querySelector('.page-heading .primary')!);
    const description = getComputedStyle(document.querySelector('.page-description')!);
    const main = getComputedStyle(document.documentElement);
    return { primary: ratio(primary.color, primary.backgroundColor), secondaryText: ratio(description.color, main.backgroundColor) };
  });
  expect(contrast.primary).toBeGreaterThanOrEqual(4.5);
  expect(contrast.secondaryText).toBeGreaterThanOrEqual(4.5);
  console.info(JSON.stringify({ measured_text_contrast: contrast }));
  await page.getByRole('button', { name: 'Switch to English' }).focus();
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus-visible');
  await expect(focused).toHaveCount(1);
  expect(await focused.evaluate(node => Number.parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(3);
  await capture('dashboard-desktop.png', 'Asu desktop dashboard with visibly labeled, isolated fictional household reserves; no real household impact or KPIs are claimed.');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('dashboard-mobile.png', 'Asu mobile dashboard at 390 × 844, showing the same explicitly labeled example workspace.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('a[href="#reserve"]:visible').first().click();
  await page.getByRole('button', { name: 'Editar Tanque principal' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture('reserve-editor.png', 'Container editor for an example tank, with explicit example labeling, separate water-use categories and unknown-value controls.');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.locator('a[href="#lab"]:visible').first().click();
  await expect(page.getByTestId('model-status')).toHaveText('Listo · experimental', { timeout: 25000 });
  await page.getByRole('button', { name: 'Ejecutar modelo histórico' }).click();
  await expect(page.getByTestId('prediction-result')).toBeVisible();
  expect(await page.getByTestId('prediction-result').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('model-lab.png', 'Real portable model inference for its historical SEDAPAL/LIMA example. Outputs are experimental reported-duration quantiles, not actual-restoration predictions.', 'guest-demo / real-historical-model');
  await page.locator('a[href="#incidents"]:visible').first().click();
  await page.getByRole('button', { name: 'Registrar un corte', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Inicio del corte · hora de Lima').fill(new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 16));
  await dialog.getByLabel('Fuente de la información').fill('Demostración · observación ficticia, no evento real');
  await dialog.getByRole('button', { name: 'Registrar corte', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Ya volvió el agua' }).click();
  await page.getByRole('button', { name: 'Confirmar retorno observado', exact: true }).click();
  await expect(page.getByTestId('incident-row')).toContainText('Retorno observado');
  await page.getByText('Procedencia e historial de cambios', { exact: true }).click();
  const dismiss = page.getByRole('button', { name: 'Cerrar notificación' });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture('incident-history.png', 'Observed-restoration workflow and provenance for a fictional household incident in the explicitly labeled example workspace; not a real outage or training label.');
  let metadata = captions;
  if (only) {
    expect(captions).toHaveLength(1);
    const previous = JSON.parse(await readFile(`${directory}/captions.json`, 'utf8')) as typeof captions;
    expect(Array.isArray(previous)).toBe(true);
    metadata = previous.map(item => ({ ...item, ...captions.find(caption => caption.path === item.path) }));
    metadata.push(...captions.filter(caption => !previous.some(item => item.path === caption.path)));
  }
  await writeFile(`${directory}/captions.json`, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
});
