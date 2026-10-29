import { useEffect, useRef, useState } from 'react';
import { AdminUsers } from './AdminUsers.tsx';
import { AdminInvites } from './AdminInvites.tsx';
import { AssistantConnections } from './AssistantConnections.tsx';
import { AccessTokens } from './AccessTokens.tsx';
import { BackupStatus } from './BackupStatus.tsx';
import { ServerHealth } from './ServerHealth.tsx';
import { AdminDiagnostics } from './AdminDiagnostics.tsx';
import { MaintenanceControls } from './Maintenance.tsx';
import './administration.css';

const sections = [
  ['people', 'People'],
  ['invites', 'Invites'],
  ['connections', 'Connections'],
  ['health', 'Backups & health'],
] as const;
type Section = (typeof sections)[number][0];
function readSection(): Section {
  const hash = location.hash.slice(1);
  return sections.some(([id]) => id === hash) ? (hash as Section) : 'people';
}
export function AdminPage({ currentId }: { currentId: string }) {
  const [section, setSection] = useState(readSection);
  const [sectionBusy, setBusy] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const busy = sectionBusy || maintenanceBusy;
  const [recipient, setRecipient] = useState('');
  const current = useRef(section),
    pending = useRef(busy);
  current.current = section;
  pending.current = busy;
  useEffect(() => {
    const update = () => {
      // A hash/back navigation must not hide a pending access mutation or its result.
      if (pending.current) {
        history.replaceState(history.state, '', `#${current.current}`);
        return;
      }
      const next = readSection();
      if (next !== 'invites') setRecipient('');
      setSection(next);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  function invite(id: string) {
    setRecipient(id);
    setSection('invites');
    location.hash = 'invites';
  }
  return (
    <div className="admin-page sp-ui">
      <header className="admin-page-heading">
        <p className="eyebrow">SERVER OPERATOR</p>
        <h1>Administration</h1>
      </header>
      <div className="admin-layout">
        <nav aria-label="Administration sections">
          {sections.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={section === id ? 'page' : undefined}
              aria-disabled={busy || undefined}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="admin-content">
          {section === 'people' && (
            <AdminUsers currentId={currentId} onRequestInvite={invite} onBusyChange={setBusy} />
          )}
          {section === 'invites' && (
            <AdminInvites initialRecipient={recipient} onBusyChange={setBusy} />
          )}
          {section === 'connections' && (
            <section className="admin-connections" aria-label="Connections">
              <h2>Connections</h2>
              <p className="sp-muted">
                Account connection metadata only. Document content stays private.
              </p>
              <AssistantConnections admin />
              <details className="admin-token-disclosure">
                <summary>Personal access token activity</summary>
                <AccessTokens admin />
              </details>
            </section>
          )}
          {section === 'health' && (
            <section className="admin-health" aria-label="Backups & health">
              <h2>Backups &amp; health</h2>
              <MaintenanceControls
                currentId={currentId}
                onBusyChange={setMaintenanceBusy}
                reloadDisabled={sectionBusy}
              />
              <BackupStatus currentId={currentId} />
              <ServerHealth />
              <AdminDiagnostics onBusyChange={setBusy} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
