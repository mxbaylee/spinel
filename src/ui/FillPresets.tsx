import { useState } from 'react';
import { fillPresets } from './palette.ts';
export function FillPresets({
  apply,
  disabled,
}: {
  apply: (id: string) => Promise<void>;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <details className="fill-presets">
      <summary>Cell fill presets</summary>
      <div className="fill-palette" aria-label="Cell fill presets">
        {fillPresets.map((preset) => (
          <button
            key={preset.id}
            disabled={busy || disabled}
            aria-label={`Apply ${preset.label} fill`}
            style={{
              background: `var(--fill-${preset.id}-bg)`,
              color: `var(--fill-${preset.id}-fg)`,
            }}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await apply(preset.id);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Could not apply this fill.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
