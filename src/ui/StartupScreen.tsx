import { GemLogo } from './GemLogo.tsx';

/** The same public, identity-free view is rendered into HTML before React loads. */
export function StartupScreen({ contained = false }: { contained?: boolean }) {
  const Region = contained ? 'div' : 'main';
  return (
    <Region className={`sp-startup${contained ? ' sp-startup-contained' : ''}`}>
      <div className="sp-startup-content" role="status">
        <span className="sp-startup-gem" aria-hidden="true">
          <GemLogo size={52} />
        </span>
        <strong className="sp-startup-wordmark">spinel</strong>
        <p>Loading your workspace…</p>
      </div>
    </Region>
  );
}
