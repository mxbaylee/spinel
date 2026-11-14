import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../../web/installApp.ts', () => ({ registerAppWorker: vi.fn() }));
vi.mock('../../web/offline/runtime.ts', () => ({
  installRuntimeHost: vi.fn(),
  runtimeRequest: vi.fn(),
}));
vi.mock('../../web/application.tsx', () => {
  throw new TypeError('private document content must never enter startup diagnostics');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('a real rejected application import reports its stage without private error text', async () => {
  const root = { textContent: '' };
  vi.stubGlobal('document', { getElementById: (id: string) => (id === 'root' ? root : null) });
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../../web/main.tsx');
  await vi.waitFor(() => expect(root.textContent).toContain('Spinel could not start.'));
  expect(report).toHaveBeenCalledExactlyOnceWith(
    '[spinel:startup]',
    JSON.stringify({
      stage: 'application-import',
      // Vitest wraps a failed mocked module factory; this is the actual rejection
      // received by bootstrap, rather than an invented browser error signature.
      errorName: 'Error',
    }),
  );
  expect(JSON.stringify(report.mock.calls)).not.toContain('private document');
  expect(root.textContent).toContain('Your saved device data has not been changed.');
});
