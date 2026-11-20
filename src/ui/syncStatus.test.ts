import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { OfflineBadge } from '../../web/OfflineStatus.tsx';
import { SyncStatus, type SyncStatusProps } from '../../web/SyncStatus.tsx';

const render = (props: SyncStatusProps) => renderToStaticMarkup(createElement(SyncStatus, props));
const recover = [{ itemId: 'a1', name: 'Team roadmap' }];

test('nothing saved on the device renders nothing', () => {
  expect(render({})).toBe('');
  expect(render({ queued: { phase: 'waiting', count: 0 } })).toBe('');
});

test('waiting offers Try now as the only action, and syncing offers none', () => {
  const waiting = render({ queued: { phase: 'waiting', count: 2 }, onTryNow: () => {} });
  expect(waiting).toContain('role="status"');
  expect(waiting).toContain('Waiting to sync');
  expect(waiting.match(/<button/g)).toHaveLength(1);
  expect(waiting).toContain('Try now');
  const syncing = render({ queued: { phase: 'syncing', count: 2 }, onTryNow: () => {} });
  expect(syncing).toContain('Syncing now');
  expect(syncing).not.toContain('<button');
  expect(syncing).not.toContain('sync-status-actions');
});

test('checking disables the button and marks it busy', () => {
  const html = render({
    queued: { phase: 'waiting', count: 1 },
    onTryNow: () => {},
    checking: true,
  });
  expect(html).toContain('disabled');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('Checking…');
});

test('needing a choice makes the banner an alert and overlaps either phase in one action row', () => {
  const both = render({
    recover,
    queued: { phase: 'waiting', count: 1 },
    onTryNow: () => {},
  });
  expect(both).toContain('role="alert"');
  expect(both.indexOf('Needs attention')).toBeLessThan(both.indexOf('Waiting to sync'));
  expect(both.match(/sync-status-actions/g)).toHaveLength(1);
  expect(both).toContain('href="/?offlineRecovery=a1"');
  const sending = render({ recover, queued: { phase: 'syncing', count: 1 }, onTryNow: () => {} });
  expect(sending).toContain('Needs attention');
  expect(sending).toContain('Syncing now');
  expect(sending).not.toContain('<button');
});

// SyncStatus has no hooks, so calling it returns its element tree and the handlers can be driven directly.
type Node = { type?: unknown; props?: { children?: unknown; onClick?: unknown; href?: string } };
function find(node: unknown, match: (element: Node) => boolean): Node | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, match)).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  const element = node as Node;
  return match(element) ? element : find(element.props?.children, match);
}

test('Try now calls its handler and Recover obeys the navigation guard', () => {
  const onTryNow = vi.fn();
  const allowNavigation = vi.fn(() => false);
  const tree = SyncStatus({
    recover,
    queued: { phase: 'waiting', count: 1 },
    onTryNow,
    allowNavigation,
  });
  const button = find(tree, (el) => el.type === 'button')!;
  (button.props!.onClick as () => void)();
  expect(onTryNow).toHaveBeenCalledTimes(1);
  const link = find(tree, (el) => el.type === 'a')!;
  const preventDefault = vi.fn();
  (link.props!.onClick as (event: unknown) => void)({ preventDefault });
  expect(allowNavigation).toHaveBeenCalledTimes(1);
  expect(preventDefault).toHaveBeenCalledTimes(1);
  allowNavigation.mockReturnValue(true);
  (link.props!.onClick as (event: unknown) => void)({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
});

test('row badges say waiting and syncing', () => {
  expect(renderToStaticMarkup(createElement(OfflineBadge, { state: 'waiting' }))).toContain(
    'Waiting to sync',
  );
  const syncing = renderToStaticMarkup(createElement(OfflineBadge, { state: 'syncing' }));
  expect(syncing).toContain('Syncing now');
  expect(syncing).toContain('data-state="syncing"');
});

test('needing a choice alone is an alert with one action row and no button', () => {
  const html = render({ recover });
  expect(html).toContain('role="alert"');
  expect(html.match(/sync-status-actions/g)).toHaveLength(1);
  expect(html).not.toContain('<button');
});
