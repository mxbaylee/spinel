import { useRef, useState, useSyncExternalStore } from 'react';
import { getPreference, setPreference, watchTheme } from '../theme.ts';
import { Button, SegmentedChoice } from './Controls.tsx';
import './themeMenu.css';

const paths = {
  monitor: 'M3 3h18v14H3z M8 21h8 M10 17v4 M14 17v4',
  moon: 'M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10 M18 2v6 M15 5h6',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 1v2 M12 21v2 M1 12h2 M21 12h2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2',
};
function Glyph({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function AppearanceChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <SegmentedChoice
      label="Appearance"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={[
        { value: 'system', label: 'Follow system', icon: <Glyph name="monitor" /> },
        { value: 'light', label: 'Light', icon: <Glyph name="sun" /> },
        { value: 'dark', label: 'Dark', icon: <Glyph name="moon" /> },
      ]}
    />
  );
}
export function ThemeMenu() {
  const preference = useSyncExternalStore(watchTheme, getPreference);
  const [error, setError] = useState('');
  const controlRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={controlRef} className="rd-theme-control">
      <AppearanceChoice
        value={preference}
        onChange={(value) =>
          setError(
            setPreference(value as 'system' | 'light' | 'dark')
              ? ''
              : 'Theme changed for this visit. Your preference could not be saved.',
          )
        }
      />
      {error && (
        <div className="sp-ui rd-theme-warning" role="alert">
          <p>{error}</p>
          <Button
            aria-label="Dismiss theme warning"
            onClick={() => {
              setError('');
              controlRef.current
                ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
                ?.focus();
            }}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
