/** Guest guard specimens: no account, document metadata, editor, or session requests. */
import { LoadingReview } from './LoadingReview.tsx';
import { GemLogo } from '../GemLogo.tsx';
import { ThemeMenu } from './Mockups.tsx';
import './entryJourney.css';

export function GuestEntryReview({
  state = 'loading',
}: {
  state?: 'loading' | 'unsupported-browser';
}) {
  return (
    <div className="sp-ui ej-page">
      <header className="ej-header">
        <div className="rd-entry-brand">
          <GemLogo />
          <strong>spinel</strong>
        </div>
        <div className="ej-header-actions">
          <ThemeMenu />
        </div>
      </header>
      <main className="ej-main">
        <section className="ej-card" aria-labelledby="guest-entry-title">
          <p className="ej-eyebrow">SHARED LINK</p>
          <h1 id="guest-entry-title">Shared document</h1>
          {state === 'loading' ? (
            <LoadingReview label="Opening shared document…" />
          ) : (
            <p role="alert">
              This browser is missing a feature Spinel needs. Update your browser or open this link
              in another current browser.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
