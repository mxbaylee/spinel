import { useEffect, useRef, useState } from 'react';
import type { ItemAccessDetails } from '../src/shared/workspace.ts';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import { itemsRequest } from './itemsApi.ts';
import './fileDialog.css';

export interface AccessDetailsTarget {
  id: string;
  name: string;
  spaceId?: string;
}

const roleNames = { owner: 'Owner', admin: 'File admin', editor: 'Editor', viewer: 'Viewer' };

/** Current account access only; never save ancestor names to an offline catalog. */
export function AccessDetails({
  item,
  onClose,
  finalFocus,
}: {
  item: AccessDetailsTarget;
  onClose(): void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const identity = `${item.id}:${item.spaceId ?? ''}`;
  const [result, setResult] = useState<{ identity: string; details: ItemAccessDetails } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const details = result?.identity === identity ? result.details : null;
  useEffect(() => {
    let active = true;
    const clear = () => {
      generation.current++;
      setResult(null);
    };
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const request = ++generation.current;
      try {
        const response = await itemsRequest<{ details: ItemAccessDetails }>(
          `/${encodeURIComponent(item.id)}/access${item.spaceId ? `?spaceId=${encodeURIComponent(item.spaceId)}` : ''}`,
          'GET',
          undefined,
          () => {
            if (!active || request !== generation.current)
              throw new Error('This access view is no longer current.');
          },
        );
        if (active && request === generation.current) {
          setResult({ identity, details: response.details });
          setError('');
        }
      } catch (cause) {
        if (active && request === generation.current) {
          setResult(null);
          setError(cause instanceof Error ? cause.message : 'Could not check your access.');
        }
      }
    };
    const visible = () => {
      // Conceal names while away; returning obtains new authorization, not a
      // previously successful response from before a grant was removed.
      clear();
      setError('');
      void load();
    };
    const offline = () => {
      clear();
      setError('Connect to see your current access.');
    };
    setResult(null);
    setError('');
    void load();
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [identity, item.id, item.spaceId, retry]);
  const source = details?.source;
  return (
    <Modal
      title={`Access to ${item.name}`}
      icon="info"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      finalFocus={finalFocus}
    >
      <div className="file-dialog">
        {details && source && (
          <>
            <p>
              <strong>
                {roleNames[details.access]}
                {(source.kind === 'folder' || source.kind === 'space') && ` through ${source.name}`}
              </strong>
            </p>
            {source.kind === 'direct' && <p>Shared directly with you.</p>}
            {details.space && (
              <p>
                Access applies to every current and future page and folder in{' '}
                <strong>{details.space.name}</strong>.
              </p>
            )}
          </>
        )}
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setRetry((value) => value + 1)}>Retry access check</button>
          </>
        ) : !details ? (
          <p role="status">Checking your access…</p>
        ) : null}
      </div>
    </Modal>
  );
}
