import type { MetricKey, Take } from './model';

function dateKey(value: number) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function practiceDays(takes: Take[], days: number, now = Date.now()) {
  const totals = new Map<string, number>();
  for (const take of takes) totals.set(dateKey(take.created), (totals.get(dateKey(take.created)) ?? 0) + take.duration);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (days - i - 1));
    return { key: dateKey(date.getTime()), label: date.toLocaleDateString(undefined, { weekday: 'short' }), seconds: totals.get(dateKey(date.getTime())) ?? 0 };
  });
}
export function currentStreak(takes: Take[], now = Date.now()) {
  const dates = new Set(takes.map(take => dateKey(take.created)));
  const day = new Date(now);
  if (!dates.has(dateKey(now))) day.setDate(day.getDate() - 1);
  let length = 0;
  while (dates.has(dateKey(day.getTime()))) { length++; day.setDate(day.getDate() - 1); }
  return length;
}
export function categoryAverage(takes: Take[], key: MetricKey) {
  const values = takes.flatMap(take => take.report?.metrics.filter(m => m.key === key && m.score !== null).map(m => m.score!) ?? []);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}
