import { useEffect, useState } from 'react';
import { watchServerConnection } from './connectionState.ts';
import type { ConnectionState } from './connectionState.ts';
import { setPreparedAccount } from './offline/offlineStore.ts';
import { signInPath } from './api.ts';

/** Only account shells without a live editor use the authenticated health probe. */
export function useServerConnection(enabled: boolean) {
  const [state, setState] = useState<ConnectionState>('reconnecting');
  useEffect(() => {
    if (!enabled) {
      setState(navigator.onLine ? 'reconnecting' : 'offline');
      return;
    }
    return watchServerConnection(setState, () => {
      // A confirmed ended session locks local data; it never opens local mode.
      setPreparedAccount(null);
      location.assign(signInPath());
    });
  }, [enabled]);
  return state;
}

export function useBrowserOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
    };
  }, []);
  return online;
}
