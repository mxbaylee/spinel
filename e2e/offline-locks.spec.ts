import { expect, test } from '@playwright/test';

test('an aborted queued Web Lock cannot run or orphan subsequent exclusive admission', async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== 'production',
    'One Chromium platform owner; no native app required.',
  );
  test.setTimeout(15_000);
  // A routed secure-context page exercises the platform without booting Spinel
  // or native editors. The separate two-tab product case owns replay integration.
  await page.route('http://localhost:3101/spn156-lock-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Web Locks probe</title>',
    }),
  );
  await page.goto('http://localhost:3101/spn156-lock-probe');
  const result = await page.evaluate(async () => {
    const name = `spinel-lock-cancellation-${crypto.randomUUID()}`;
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const holder = navigator.locks.request(name, { mode: 'shared' }, async () => {
      started.resolve();
      await release.promise;
    });
    let called = false;
    let acquired = false;
    await started.promise;
    const controller = new AbortController();
    const queued = navigator.locks.request(name, { signal: controller.signal }, () => {
      called = true;
    });
    const rejected = queued.then(
      () => 'unexpected success',
      (error: Error) => error.name,
    );
    const before = await navigator.locks.query();
    controller.abort();
    const error = await rejected;
    const aborted = await navigator.locks.query();
    release.resolve();
    await holder;
    await navigator.locks.request(name, { signal: AbortSignal.timeout(2_000) }, () => {
      acquired = true;
    });
    const final = await navigator.locks.query();
    return { before, error, aborted, called, acquired, final };
  });
  console.log(JSON.stringify({ browser: browser.version(), result }));
  expect(result.before.pending).toHaveLength(1);
  expect(result.error).toBe('AbortError');
  expect(result.aborted.pending).toEqual([]);
  expect(result.called).toBe(false);
  expect(result.acquired).toBe(true);
  expect(result.final).toEqual({ held: [], pending: [] });
});
