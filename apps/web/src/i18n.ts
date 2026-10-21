export type Locale = 'es-PE' | 'en';
export function translator(locale: Locale) { return (es: string, en: string) => locale === 'en' ? en : es; }
export function formatNumber(value: number, locale: Locale, digits = 1) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}
export function formatTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'America/Lima', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
export function inputTime(value = new Date().toISOString()): string {
  return new Date(Date.parse(value) - 5 * 3600000).toISOString().slice(0, 16);
}
export function fromLimaInput(value: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw new Error('invalid-time');
  const parsed = new Date(`${value}:00-05:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid-time');
  return parsed.toISOString();
}
