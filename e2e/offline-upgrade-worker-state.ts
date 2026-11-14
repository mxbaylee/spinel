/** Real worker references stay in the browser realm; only snapshots leave it. */
export interface UpgradeWorkerControl {
  registration: {
    readonly active: { readonly state: ServiceWorkerState } | null;
    readonly waiting: { readonly state: ServiceWorkerState } | null;
  };
  original: { readonly state: ServiceWorkerState };
  replacement: { readonly state: ServiceWorkerState } | null;
  result: null | { ok: boolean; error?: string };
}

// These closure-free predicates run synchronously in page.waitForFunction.
// Its poller tests the returned value before awaiting it: an async predicate's
// Promise would end the poll even when it subsequently resolves to false.
export function captureWaitingReplacement(control: UpgradeWorkerControl): boolean {
  const { registration, original } = control;
  const replacement = registration.waiting;
  if (
    !replacement ||
    replacement === original ||
    replacement.state !== 'installed' ||
    registration.active !== original ||
    original.state !== 'activated' ||
    control.result !== null
  )
    return false;
  control.replacement = replacement;
  return true;
}

export function hasActivatedReplacement(control: UpgradeWorkerControl): boolean {
  const { registration, original, replacement, result } = control;
  return (
    replacement !== null &&
    registration.active === replacement &&
    replacement.state === 'activated' &&
    registration.waiting === null &&
    original.state === 'redundant' &&
    result?.ok === false
  );
}

export function upgradeWorkerState(control: UpgradeWorkerControl) {
  const { registration, original, replacement, result } = control;
  return {
    active: registration.active?.state ?? null,
    activeIsOriginal: registration.active === original,
    activeIsReplacement: replacement !== null && registration.active === replacement,
    original: original.state,
    waiting: registration.waiting?.state ?? null,
    waitingIsReplacement: replacement !== null && registration.waiting === replacement,
    replacement: replacement?.state ?? null,
    preparation: result,
  };
}
