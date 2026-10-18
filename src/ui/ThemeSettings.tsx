import { useState, useSyncExternalStore } from 'react';
import { getPreference, setPreference, watchTheme } from './theme.ts';
import type { ThemePreference } from './theme.ts';
export function ThemeSettings() {
  const preference = useSyncExternalStore(watchTheme, getPreference);
  const [error, setError] = useState('');
  return (
    <section className="welcome theme-settings">
      <h2>Appearance</h2>
      <label>
        Theme
        <select
          value={preference}
          onChange={(event) => {
            setError(
              setPreference(event.target.value as ThemePreference)
                ? ''
                : 'Theme changed for this visit, but this browser could not save your preference.',
            );
          }}
        >
          <option value="system">Follow system</option>
          <option value="light">Vintage · Light</option>
          <option value="dark">Modern · Dark</option>
        </select>
      </label>
      <p>Applies to this browser. Your documents stay the same for everyone.</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
