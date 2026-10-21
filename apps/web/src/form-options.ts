import catalog from './form-catalog.json';

export type FormOption = { value: string; label?: string };
export const departments: string[] = catalog.departments;
export const utilities: string[] = catalog.utilities;
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
export function matchOption(value: string, options: FormOption[]): FormOption | undefined {
  return options.find(option => normalize(option.value) === normalize(value));
}
export function completeOption(value: string, options: FormOption[]): FormOption | undefined {
  if (normalize(value).length < 2) return undefined;
  const matches = options.filter(option => normalize(option.value).startsWith(normalize(value)));
  return matches.length === 1 ? matches[0] : undefined;
}
export function districtOptions(department: string): FormOption[] {
  const rows = (catalog.districts as Record<string, string[][]>)[department] ?? [];
  const unique = [...new Map(rows.map(row => [`${row[1]}|${row[2]}`, row])).values()];
  return unique.map(([, name, province]) => ({
    value: unique.filter(row => row[1] === name).length > 1 ? `${name} (${province})` : name,
    label: `${name} · ${province}`,
  })).sort((a, b) => a.value.localeCompare(b.value, 'es'));
}
