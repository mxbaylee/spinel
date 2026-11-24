import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

type Observed = { historical: boolean; state: string; browserOnline: boolean | null };

/** A current (never historical) Offline status stamped while the browser reported online. */
export function falseOffline(events: Observed[]) {
  return events.some(
    (event) => !event.historical && event.state === 'offline' && event.browserOnline,
  );
}

/** A current Offline status in one phase, stamped with the given browser connectivity. */
export function offlineInPhase(
  events: (Observed & { phase: string })[],
  phase: string,
  browserOnline: boolean,
) {
  return events.some(
    (event) =>
      !event.historical &&
      event.phase === phase &&
      event.state === 'offline' &&
      event.browserOnline === browserOnline,
  );
}

/** A current Offline status regardless of the cached connectivity stamp. Use only in phases where
 * the test has itself verified `navigator.onLine`, so a missed online event cannot hide it. */
export function anyCurrentOffline(events: Observed[]) {
  return events.some((event) => !event.historical && event.state === 'offline');
}

/** Content-free, bounded observation of the real list/editor status handoff. */
export async function observeConnectionOpening(page: Page) {
  const handle = await page.evaluateHandle(() => {
    let began = performance.now();
    let phase = 'observer-negative-control';
    let overflow = false;
    let nextId = 0;
    let browserOnline = navigator.onLine;
    const identities = new WeakMap<Element, { id: number; owner: string }>();
    const events: {
      elapsedMs: number;
      wallTimeMs: number;
      phase: string;
      kind: string;
      id: number;
      owner: string;
      state: string;
      browserOnline: boolean | null;
      historical: boolean;
      connected: boolean;
      visible: boolean;
      saveCategory: string;
    }[] = [];
    let previous = '';
    const record = (node: Element, kind: string, value = node.getAttribute('data-state')) => {
      if (!value) return;
      let identity = identities.get(node);
      if (!identity) {
        identity = { id: nextId++, owner: 'other' };
        identities.set(node, identity);
      }
      if (node.closest('.editor-frame')) identity.owner = 'editor';
      else if (node.closest('.file-rail')) identity.owner = 'list';
      const state = ['online', 'offline', 'reconnecting'].includes(value) ? value : 'other';
      const save = document.querySelector('.save-trigger')?.getAttribute('aria-label') ?? '';
      const saveCategory =
        /^Save details: (Saved locally|Saving locally|Synced|Needs attention|Not saved|View only|Check status|Saving…|Loading…|Saved|Editing…)$/.test(
          save,
        )
          ? save.slice('Save details: '.length)
          : 'absent-or-other';
      const signature = `${phase}:${kind}:${identity.id}:${state}:${browserOnline}:${saveCategory}`;
      if (signature === previous) return;
      previous = signature;
      if (events.length >= 200) {
        overflow = true;
        return;
      }
      const rect = node.getBoundingClientRect();
      events.push({
        elapsedMs: performance.now() - began,
        wallTimeMs: Date.now(),
        phase,
        kind,
        ...identity,
        state,
        // oldValue is historical context, never a current connectivity claim.
        historical: kind === 'attribute-old',
        browserOnline: kind === 'attribute-old' ? null : browserOnline,
        connected: node.isConnected,
        visible: node.isConnected && rect.width > 0 && rect.height > 0,
        saveCategory,
      });
    };
    const visit = (node: Node, kind: string, following: MutationRecord[]) => {
      if (!(node instanceof Element)) return;
      const atMutation = (status: Element) => {
        const next = following.find(
          (change) => change.type === 'attributes' && change.target === status,
        );
        record(status, kind, next ? next.oldValue : status.getAttribute('data-state'));
      };
      if (node.matches('.connection-status')) atMutation(node);
      node.querySelectorAll('.connection-status').forEach(atMutation);
    };
    const sample = (kind: string) =>
      document.querySelectorAll('.connection-status').forEach((node) => record(node, kind));
    const process = (changes: MutationRecord[]) => {
      for (const [index, change] of changes.entries()) {
        if (
          change.type === 'attributes' &&
          change.target instanceof Element &&
          change.target.matches('.connection-status')
        ) {
          record(change.target, 'attribute-old', change.oldValue);
          // The next mutation's oldValue is this mutation's resulting value.
          // Reading only the final attribute would hide Offline→Online in one delivery.
          const next = changes
            .slice(index + 1)
            .find(
              (candidate) => candidate.type === 'attributes' && candidate.target === change.target,
            );
          record(
            change.target,
            'attribute',
            next ? next.oldValue : change.target.getAttribute('data-state'),
          );
        }
        for (const node of change.addedNodes) visit(node, 'added', changes.slice(index + 1));
        for (const node of change.removedNodes) visit(node, 'removed', changes.slice(index + 1));
      }
      sample('current');
    };
    const observer = new MutationObserver(process);
    const flush = () => {
      const changes = observer.takeRecords();
      if (changes.length) process(changes);
    };
    const connectivity = () => {
      // Capture runs before product event handlers; queued old work retains its
      // previous connectivity. Do not sample an intermediate pre-handler DOM.
      flush();
      browserOnline = navigator.onLine;
    };
    window.addEventListener('online', connectivity, true);
    window.addEventListener('offline', connectivity, true);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
      attributeOldValue: true,
    });
    sample('initial');
    return {
      events,
      overflow: () => overflow,
      mark(value: string) {
        flush();
        phase = value;
        sample('phase');
      },
      reset() {
        flush();
        events.length = 0;
        previous = '';
        overflow = false;
        began = performance.now();
        phase = 'pending-offline-doc';
        sample('initial');
      },
      stop() {
        observer.disconnect();
        window.removeEventListener('online', connectivity, true);
        window.removeEventListener('offline', connectivity, true);
      },
    };
  });
  // A same-delivery insertion/removal must not escape this observer. The probe
  // is inert and never changes product state or calls an application controller.
  const negativeControl = await handle.evaluate(async ({ events, reset }) => {
    const probe = document.createElement('span');
    probe.className = 'connection-status';
    probe.dataset.state = 'offline';
    document.body.append(probe);
    probe.remove();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const detected = events.some((event) => event.kind === 'removed' && event.state === 'offline');
    const evidence = events.filter((event) => event.owner === 'other');
    reset();
    return { detected, evidence };
  });
  expect(negativeControl.detected, 'a transient Offline node must be observable').toBe(true);
  const readiness: { wallTimeMs: number; route: string; status: number }[] = [];
  let readinessOverflow = false;
  const response = (value: import('@playwright/test').Response) => {
    const path = new URL(value.url()).pathname;
    const route =
      path === '/api/health'
        ? 'health'
        : path.endsWith('/collaboration')
          ? 'access'
          : path.endsWith('/ticket')
            ? 'ticket'
            : null;
    if (!route) return;
    if (readiness.length >= 100) {
      readinessOverflow = true;
      return;
    }
    readiness.push({ wallTimeMs: Date.now(), route, status: value.status() });
  };
  page.on('response', response);
  return {
    mark: (phase: string) => handle.evaluate((state, value) => state.mark(value), phase),
    async read() {
      const observed = await handle.evaluate(({ events, overflow }) => ({
        events,
        overflow: overflow(),
      }));
      return { ...observed, readiness, readinessOverflow, negativeControl };
    },
    async close() {
      page.off('response', response);
      await handle.evaluate(({ stop }) => stop());
      await handle.dispose();
    },
  };
}
