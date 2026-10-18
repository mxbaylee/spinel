export interface HistoryVersion {
  id: string;
  capturedAt: number;
  name: string | null;
  beforeRestore?: boolean | number;
}
export const historyDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
export function dayVersions(versions: HistoryVersion[], day: string) {
  return versions
    .filter((version) => historyDay(version.capturedAt) === day)
    .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));
}
export function historyMonth(month: string): (string | null)[] {
  const [year, index] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1));
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return [
    ...Array.from({ length: first.getUTCDay() }, () => null),
    ...Array.from({ length }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`),
  ];
}
export function shiftHistoryMonth(month: string, delta: number) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + delta, 1)).toISOString().slice(0, 7);
}
export function historyVersionLabel(version: HistoryVersion) {
  const time = new Date(version.capturedAt).toISOString().slice(11, 19);
  return `${time} UTC — ${version.name ?? 'Unnamed version'}${version.beforeRestore ? ' — Before restore' : ''}`;
}
