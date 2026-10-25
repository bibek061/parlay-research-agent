import { TIME_ZONE } from './domain';
export function easternDate(value: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Error('Use a valid date in YYYY-MM-DD format.');
  return value;
}
export function addDay(value: string): string { return new Date(Date.parse(validateDate(value)) + 86400000).toISOString().slice(0, 10); }
