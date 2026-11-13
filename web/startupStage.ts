/**
 * A slow start names the step it is waiting on, so a phone with no inspector can still
 * report where startup stalled. Silent for the first seconds; gone once the app is up.
 */
const SHOW_AFTER_MS = 8000;
let stage = 'starting';
let line: HTMLElement | null = null;
let finished = false;
const began = Date.now();
const text = () => `Still starting: ${stage} (${Math.round((Date.now() - began) / 1000)} s)`;

const timer =
  typeof document === 'undefined'
    ? null
    : window.setInterval(() => {
        if (finished || Date.now() - began < SHOW_AFTER_MS) return;
        if (!line) {
          line = document.createElement('p');
          line.setAttribute('role', 'status');
          line.style.cssText =
            'position:fixed;left:0;right:0;bottom:16px;margin:0;text-align:center;font:12px system-ui,sans-serif;opacity:.7';
          document.body.append(line);
        }
        line.textContent = text();
      }, 1000);

/** Name the step startup is now waiting on. */
export function startupStage(name: string) {
  if (!finished) stage = name;
}

/** The app is up (or gave a final answer): stop reporting. */
export function startupDone() {
  finished = true;
  if (timer !== null) window.clearInterval(timer);
  line?.remove();
  line = null;
}
