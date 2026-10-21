import { useState } from 'react';
import { Button } from './Controls.tsx';

export type ConnectionsReviewState =
  | 'loaded'
  | 'empty'
  | 'loading'
  | 'load-failed'
  | 'disconnecting'
  | 'disconnected'
  | 'disconnect-failed'
  | 'matching-names'
  | 'previously-used';
type ReviewConnection = {
  id: string;
  name: string;
  origin: string;
  account: string;
  lastUsed: string;
  disconnected: boolean;
};

/** Local fixtures mirror connection metadata and recovery without calling account APIs. */
export function ConnectionsReview({
  state = 'loaded',
  admin = false,
}: {
  state?: ConnectionsReviewState;
  admin?: boolean;
}) {
  const [loadState, setLoadState] = useState(state);
  const [connections, setConnections] = useState<ReviewConnection[]>(() => {
    if (state === 'empty') return [];
    const first = {
      id: 'desktop',
      name: 'Desktop assistant',
      origin: 'https://assistant.example',
      account: 'Alex Baylee',
      lastUsed: state === 'previously-used' || admin ? 'October 20, 2026 at 09:15' : 'Never',
      disconnected: state === 'disconnected',
    };
    return state === 'matching-names' || admin
      ? [
          first,
          {
            ...first,
            id: 'other',
            name: admin ? 'Previous assistant' : first.name,
            origin: 'https://another-assistant.example',
            account: 'Sam Rivera',
            disconnected: admin,
          },
        ]
      : [first];
  });
  const [failedId, setFailedId] = useState(
    state === 'disconnect-failed' && !admin ? 'desktop' : '',
  );
  const pendingId = state === 'disconnecting' && !admin ? 'desktop' : '';
  const [notice, setNotice] = useState('');
  const loading = loadState === 'loading';
  const failed = loadState === 'load-failed';
  const Heading = admin ? 'h3' : 'h2';
  function disconnect(connection: ReviewConnection) {
    setConnections((current) =>
      current.map((item) => (item.id === connection.id ? { ...item, disconnected: true } : item)),
    );
    setFailedId('');
    setNotice(`${connection.name} disconnected in this preview. No real account access changed.`);
  }
  return (
    <section aria-label="Connected assistants">
      <Heading>Connected assistants</Heading>
      <p className="sp-muted">
        {admin
          ? 'Account names and connection activity only. No secrets or document contents.'
          : 'Add this address in your application, then sign in to approve access. Applications can use only the files your account allows.'}
      </p>
      {!admin && (
        <label>
          MCP server address
          <input
            readOnly
            value="https://spinel.example/mcp"
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      {loading ? (
        <p role="status">Loading connected assistants…</p>
      ) : failed ? (
        <p role="alert">Could not load connected assistants. Try again.</p>
      ) : connections.length ? (
        <div role="list" aria-label="Assistant connections">
          {connections.map((connection) => (
            <div role="listitem" key={connection.id}>
              <div className="rd-setting-row">
                <span>
                  <strong>{connection.name}</strong>
                  <small>
                    {admin && `${connection.account} · `}
                    {connection.disconnected ? 'Disconnected' : 'Connected'}
                  </small>
                  <small>
                    Return address: <bdi>{connection.origin}</bdi>
                  </small>
                  <small>Created October 18, 2026 · Last used: {connection.lastUsed}</small>
                </span>
                {!admin && !connection.disconnected && (
                  <Button
                    disabled={Boolean(pendingId)}
                    aria-label={`${failedId === connection.id ? 'Retry disconnecting' : 'Disconnect'} ${connection.name} from ${connection.origin}`}
                    onClick={() => disconnect(connection)}
                  >
                    {pendingId === connection.id
                      ? 'Disconnecting…'
                      : failedId === connection.id
                        ? 'Try again'
                        : 'Disconnect'}
                  </Button>
                )}
              </div>
              {pendingId === connection.id && <p role="status">Disconnecting {connection.name}…</p>}
              {failedId === connection.id && (
                <p role="alert">
                  Could not disconnect {connection.name}. It still has access. Try again.
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>No connected assistants yet.</p>
      )}
      <Button
        disabled={loading || Boolean(pendingId)}
        onClick={() => {
          setLoadState('loaded');
          setNotice('Connection list refreshed in this preview.');
        }}
      >
        {failed ? 'Try again' : 'Refresh connected assistants'}
      </Button>
      {notice && <p role="status">{notice}</p>}
      <p className="sp-muted">
        Design preview. Connection changes apply only to these sample rows.
      </p>
    </section>
  );
}
