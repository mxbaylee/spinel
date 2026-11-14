/**
 * How long an offline-capable request may hang before it counts as an outage.
 * In airplane mode or on a stalled radio the browser can leave a fetch pending for
 * minutes, so each deadline lets the saved copy answer instead.
 */

/** Server requests across the app use 15 s; an item view that misses it opens the device copy. */
export const ITEM_REQUEST_DEADLINE_MS = 15_000;

/**
 * A page load slower than this to first byte falls back to the saved app shell. A slow
 * but live connection therefore starts from saved files; the app refetches when it can.
 */
export const NAVIGATION_DEADLINE_MS = 8000;

/**
 * `onLine === false` proves the browser has no network, so skip the wait and fail as a
 * network failure would. `true` proves nothing (captive Wi-Fi), so it never short-circuits.
 */
export function requireBrowserOnline(navigatorLike: { onLine?: boolean } | undefined) {
  if (navigatorLike?.onLine === false) throw new TypeError('The browser is offline.');
}
