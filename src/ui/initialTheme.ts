import { palettes } from './palette.ts';

// Public HTML needs these existing tokens before application CSS/JS arrives.
const names = [
  'sp-bg',
  'sp-text',
  'sp-muted',
  'sp-accent',
  'sp-on-accent',
  'gem-edge',
  ...Array.from({ length: 6 }, (_, i) => `gem-${i + 1}`),
];
const colors = (mode: 'light' | 'dark') =>
  names.map((name) => `--${name}:${palettes[mode][name]}`).join(';');
export const initialThemeCss = `:root{${colors('light')}}:root[data-theme=dark]{${colors('dark')}}@media(prefers-color-scheme:dark){:root:not([data-theme=light]){${colors('dark')}}}`;

/** Serialized into public HTML; deliberately self-contained and storage-failure safe. */
function chooseInitialTheme() {
  let preference = 'system';
  try {
    preference = localStorage.getItem('spinel-theme') ?? 'system';
  } catch {
    /* System remains available. */
  }
  const dark =
    preference === 'dark' ||
    (preference !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
export const initialThemeScript = `(${chooseInitialTheme.toString()})()`;
