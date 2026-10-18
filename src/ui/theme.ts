import { palettes } from './palette.ts';
import type { ThemeMode } from './palette.ts';
export type ThemePreference = ThemeMode | 'system';
const key = 'spinel-theme';
let preference: ThemePreference = 'system';
const valid = (value: string | null): ThemePreference =>
  value === 'light' || value === 'dark' ? value : 'system';
export function getPreference() {
  return preference;
}
export function getTheme(): ThemeMode {
  return preference === 'system'
    ? matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : preference;
}
function apply() {
  const theme = getTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  for (const [name, value] of Object.entries(palettes[theme]))
    document.documentElement.style.setProperty(`--${name}`, value);
  window.dispatchEvent(new Event('spinel-theme'));
}
export function setPreference(next: ThemePreference): boolean {
  preference = next;
  apply();
  try {
    localStorage.setItem(key, next);
    return true;
  } catch {
    return false;
  }
}
export function watchTheme(listener: () => void) {
  window.addEventListener('spinel-theme', listener);
  return () => window.removeEventListener('spinel-theme', listener);
}
export function initializeTheme() {
  try {
    preference = valid(localStorage.getItem(key));
  } catch {
    preference = 'system';
  }
  apply();
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) {
      preference = valid(event.newValue);
      apply();
    }
  });
}
