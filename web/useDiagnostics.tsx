import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DiagnosticOperation } from './diagnosticsAccount.ts';
import { AccountDiagnostics } from './diagnosticsAccount.ts';

const DiagnosticsContext = createContext<AccountDiagnostics | null>(null);
export function DiagnosticsProvider({ children }: { children: ReactNode }) {
  const account = useRef<AccountDiagnostics | null>(null);
  account.current ??= new AccountDiagnostics();
  return (
    <DiagnosticsContext.Provider value={account.current}>{children}</DiagnosticsContext.Provider>
  );
}

/** Account shell only. Guest roots have no provider and receive no sink/run IDs. */
export function useAccountDiagnostics(
  userId: string | null,
  { available, onlineHint }: { available: boolean; onlineHint: boolean },
) {
  const account = useContext(DiagnosticsContext);
  useLayoutEffect(() => {
    account?.account(userId);
    return () => account?.account(null);
  }, [account, userId]);
  useLayoutEffect(() => {
    const sync = () =>
      account?.connection(available && navigator.onLine && document.visibilityState !== 'hidden');
    const changedAccount = (event: StorageEvent) => {
      if (
        event.key === null ||
        [
          'spinel.offline.account',
          'spinel.offline.cancellation',
          'spinel.offline.sign-out',
        ].includes(event.key)
      )
        account?.stop();
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('storage', changedAccount);
    // Account changes are also dependencies: a new account starts a fresh adapter
    // even when its connection state happens to match the previous one.
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('storage', changedAccount);
      account?.connection(false);
    };
  }, [account, userId, available]);
  // A fresh room/server online proof retries a failed collection handshake or
  // HTTP self-suspension. Room transitions never tear down a verified collection.
  useLayoutEffect(() => {
    if (onlineHint)
      account?.connection(available && navigator.onLine && document.visibilityState !== 'hidden');
  }, [account, userId, available, onlineHint]);
  return () => account?.stop();
}

export function useDiagnostics(): { begin: () => DiagnosticOperation | undefined } {
  const account = useContext(DiagnosticsContext);
  return { begin: () => account?.begin() };
}
