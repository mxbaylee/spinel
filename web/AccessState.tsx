import { useId } from 'react';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { ThemeMenu } from '../src/ui/redesign/ThemeMenu.tsx';
import './accessState.css';

export type AccessStateKind = 'loading' | 'offline' | 'revoked' | 'unsupported' | 'missing';

/** Generic blocked-view presentation. No file, account or capability data belongs here. */
export function AccessState({
  kind,
  onRetry,
  onFiles,
  embedded = false,
  unsaved = false,
}: {
  kind: AccessStateKind;
  onRetry?: () => void;
  onFiles?: () => void;
  embedded?: boolean;
  unsaved?: boolean;
}) {
  const titleId = useId();
  const copy = {
    loading: ['Shared document', 'Opening shared document…'],
    offline: ["You're offline", 'Connect to the internet to open this page.'],
    revoked: ['This link no longer works.', 'Ask the person who shared it for a new link.'],
    unsupported: [
      'Update your browser',
      'Open this link in a current browser that supports Web Locks.',
    ],
    missing: ["This item isn't available", 'It may have moved, or you may no longer have access.'],
  }[kind];
  const content = (
    <section className="access-state-content" aria-labelledby={titleId}>
      <h1 id={titleId}>
        <span role={kind === 'revoked' || kind === 'missing' ? 'alert' : undefined}>
          {copy[0]}
        </span>
      </h1>
      <p role={kind === 'loading' ? 'status' : kind === 'unsupported' ? 'alert' : undefined}>
        {copy[1]}
      </p>
      {kind === 'offline' && onRetry && <Button onClick={onRetry}>Try again</Button>}
      {kind === 'revoked' && unsaved && <p>Some changes were not saved. This document is no longer accessible.</p>}
      {kind === 'missing' && onFiles && <Button onClick={onFiles}>Go to My files</Button>}
    </section>
  );
  if (embedded) return <div className="sp-ui access-state-embedded">{content}</div>;
  return (
    <div className="sp-ui access-state">
      <header className="access-state-header">
        <span className="access-state-brand"><GemLogo size={32} /><strong>spinel</strong></span>
        <ThemeMenu />
      </header>
      <main>{content}</main>
      <footer>Private by invitation. Yours to make.</footer>
    </div>
  );
}
