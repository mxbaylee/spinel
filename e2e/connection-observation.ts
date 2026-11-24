import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Content-free, bounded observation of the real list/editor status handoff. */
export async function observeConnectionOpening(page: Page) {
  const handle = await page.evaluateHandle(() => {
    let began = performance.now();
    let phase = 'observer-negative-control';
    let overflow = false;
    let nextId = 0;
    const identities = new WeakMap<Element, { id: number; owner: string }>();
    const events: {
      elapsedMs: number;
      wallTimeMs: number;
      phase: string;
      kind: string;
      id: number;
      owner: string;
      state: string;
      browserOnline: boolean;
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
      const signature = `${phase}:${kind}:${identity.id}:${state}:${navigator.onLine}:${saveCategory}`;
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
        browserOnline: navigator.onLine,
        connected: node.isConnected,
        visible: node.isConnected && rect.width > 0 && rect.height > 0,
        saveCategory,
      });
    };
    const visit = (node: Node, kind: string) => {
      if (!(node instanceof Element)) return;
      if (node.matches('.connection-status')) record(node, kind);
      node.querySelectorAll('.connection-status').forEach((child) => record(child, kind));
    };
    const sample = (kind: string) =>
      document.querySelectorAll('.connection-status').forEach((node) => record(node, kind));
    const observer = new MutationObserver((changes) => {
      for (const change of changes) {
        if (
          change.type === 'attributes' &&
          change.target instanceof Element &&
          change.target.matches('.connection-status')
        ) {
          record(change.target, 'attribute-old', change.oldValue);
          record(change.target, 'attribute');
        }
        for (const node of change.addedNodes) visit(node, 'added');
        for (const node of change.removedNodes) visit(node, 'removed');
      }
      sample('current');
    });
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
        phase = value;
        sample('phase');
      },
      reset() {
        events.length = 0;
        previous = '';
        overflow = false;
        began = performance.now();
        phase = 'pending-offline-doc';
        sample('initial');
      },
      stop: () => observer.disconnect(),
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
