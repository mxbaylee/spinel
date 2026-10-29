import { useEffect, useState } from 'react';
import type { MaintenancePublicStatus } from '../src/shared/maintenance.ts';
import { maintenanceBannerKey, maintenanceDismissals } from './maintenanceDismissal.ts';

export function useMaintenanceDismissal(status: MaintenancePublicStatus | null) {
  const key = maintenanceBannerKey(status);
  const [dismissal, setDismissal] = useState(() => maintenanceDismissals.current(key));
  useEffect(() => {
    const refresh = () => setDismissal(maintenanceDismissals.current(key));
    refresh();
    const current = maintenanceDismissals.current(key);
    const timer = current
      ? setTimeout(refresh, Math.max(0, current.expiresAt - Date.now()))
      : undefined;
    // Background tabs can throttle timers; check again on return, without polling.
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [key, dismissal?.expiresAt]);

  return {
    dismissed: Boolean(
      dismissal && dismissal.noticeKey === key && dismissal.expiresAt > Date.now(),
    ),
    dismiss() {
      if (typeof key === 'string') setDismissal(maintenanceDismissals.dismiss(key));
    },
    reopen() {
      maintenanceDismissals.clear();
      setDismissal(null);
    },
  };
}
