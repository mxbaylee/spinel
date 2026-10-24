import { useId } from 'react';
import type { ReactNode } from 'react';
import { GemLogo, replayGemWiggle } from '../src/ui/GemLogo.tsx';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { ThemeMenu } from '../src/ui/redesign/ThemeMenu.tsx';
import '../src/ui/redesign/entryJourney.css';
import './entry.css';

/** Presentation only: each caller retains its authenticated request and navigation rules. */
export function EntryFrame({
  title,
  intro,
  eyebrow = 'PRIVATE BY INVITATION',
  home = false,
  busy = false,
  onHome,
  children,
  footer = 'Your passkey stays with your browser, password manager or device.',
}: {
  title: string;
  intro?: string;
  eyebrow?: string;
  home?: boolean;
  busy?: boolean;
  onHome: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  return (
    <div className={`sp-ui ej-page entry-page${home ? ' ej-home' : ''}`}>
      <header className="ej-header">
        <Button
          className="ej-brand"
          aria-label="Spinel home"
          disabled={busy}
          onClick={(event) => {
            replayGemWiggle(event.currentTarget);
            onHome();
          }}
        >
          <span className="wiggle">
            <GemLogo />
          </span>
          <span>spinel</span>
        </Button>
        <div className="ej-header-actions">
          <ThemeMenu />
        </div>
      </header>
      <main className="ej-main">
        <section className="ej-card" aria-labelledby={titleId}>
          <p className="ej-eyebrow">{eyebrow}</p>
          <h1 id={titleId}>{title}</h1>
          {intro && <p className="ej-intro">{intro}</p>}
          {children}
        </section>
      </main>
      <footer className="ej-footer">{footer}</footer>
    </div>
  );
}
