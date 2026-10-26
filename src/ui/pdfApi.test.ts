import { afterEach, expect, test, vi } from 'vitest';
import { pdfFilename, preparePdfDownload, readPdfOptions } from '../../web/pdfApi.ts';
import { guestRevokedEvent } from '../../web/guestRevocation.ts';

afterEach(() => vi.unstubAllGlobals());

const root = '00000000-0000-4000-8000-000000000075';

test('PDF requests preserve exact guest Space child scope and only selected worksheet IDs', async () => {
  vi.stubGlobal('location', { pathname: `/share/${root}` });
  const signal = new AbortController().signal;
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? new Response('%PDF-1.7', {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': "attachment; filename*=UTF-8''Saved%20title.pdf",
          },
        })
      : Response.json({ kind: 'sheet', worksheets: [{ id: 'one', name: 'Summary' }] }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await readPdfOptions('child', signal, root)).toEqual({
    kind: 'sheet',
    worksheets: [{ id: 'one', name: 'Summary' }],
  });
  const result = await preparePdfDownload('child', 'Old title', ['one'], signal, root);
  expect(await result.blob.text()).toBe('%PDF-1.7');
  expect(result.filename).toBe('Saved title.pdf');
  expect(
    fetcher.mock.calls.every(([path]) => path === `/api/guest-spaces/${root}/items/child/pdf`),
  ).toBe(true);
  expect(fetcher.mock.calls[1][1]).toMatchObject({
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    body: JSON.stringify({ worksheetIds: ['one'] }),
  });
  await expect(readPdfOptions('child', signal, 'different-space')).rejects.toThrow(
    'This document is not available.',
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('an authoritative guest PDF refusal revokes the visible guest view', async () => {
  vi.stubGlobal('location', { pathname: `/share/${root}` });
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'This link no longer works.' }, { status: 404 })),
  );
  await expect(
    preparePdfDownload(root, 'Private title', undefined, new AbortController().signal),
  ).rejects.toThrow('This link no longer works.');
  expect(dispatchEvent).toHaveBeenCalledOnce();
  expect(dispatchEvent.mock.calls[0][0].type).toBe(guestRevokedEvent);
});

test.each([true, false])(
  'a denied child PDF rechecks the exact guest root (valid=%s)',
  async (valid) => {
    vi.stubGlobal('location', { pathname: `/share/${root}` });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const fetcher = vi.fn(async (path: string) =>
      path === `/api/guest-spaces/${root}` && valid
        ? Response.json({ access: 'viewer' })
        : Response.json({ error: 'This document is not available.' }, { status: 404 }),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      preparePdfDownload('child', 'Doc', undefined, new AbortController().signal, root),
    ).rejects.toThrow('This document is not available.');
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      `/api/guest-spaces/${root}/items/child/pdf`,
      `/api/guest-spaces/${root}`,
    ]);
    expect(dispatchEvent).toHaveBeenCalledTimes(valid ? 0 : 1);
  },
);

test('a failed guest root recheck never turns a denied child into a PDF or an invented revocation', async () => {
  vi.stubGlobal('location', { pathname: `/share/${root}` });
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === `/api/guest-spaces/${root}`) throw new TypeError('Network interrupted');
      return Response.json({ error: 'Unavailable' }, { status: 404 });
    }),
  );
  await expect(
    preparePdfDownload('child', 'Doc', undefined, new AbortController().signal, root),
  ).rejects.toThrow('Network interrupted');
  expect(dispatchEvent).not.toHaveBeenCalled();
});

test('a departed child cannot recheck or revoke the current guest view', async () => {
  vi.stubGlobal('location', { pathname: `/share/${root}` });
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', { dispatchEvent });
  let release!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  let current = true;
  const request = preparePdfDownload(
    'child',
    'Doc',
    undefined,
    new AbortController().signal,
    root,
    () => {
      if (!current) throw new Error('View changed');
    },
  );
  const rejected = expect(request).rejects.toThrow('View changed');
  current = false;
  release(Response.json({ error: 'Unavailable' }, { status: 404 }));
  await rejected;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(dispatchEvent).not.toHaveBeenCalled();
});

test('cancelling before a delayed refusal does not revoke or redirect a newer view', async () => {
  const assign = vi.fn(),
    dispatchEvent = vi.fn();
  vi.stubGlobal('location', { pathname: `/share/${root}`, assign });
  vi.stubGlobal('window', { dispatchEvent });
  const controller = new AbortController();
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const request = preparePdfDownload(root, 'Doc', undefined, controller.signal);
  const rejection = expect(request).rejects.toThrow();
  controller.abort();
  release(Response.json({ error: 'Unavailable' }, { status: 401 }));
  await rejection;
  expect(dispatchEvent).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
});

test('a cancelled body read yields no downloadable Blob', async () => {
  vi.stubGlobal('location', { pathname: '/' });
  const controller = new AbortController();
  const response = new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } });
  response.blob = async () => {
    controller.abort();
    return new Blob(['%PDF-1.7']);
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  );
  await expect(preparePdfDownload('id', 'Doc', undefined, controller.signal)).rejects.toThrow();
});

test('an HTML or JSON success response cannot become a mislabeled PDF download', async () => {
  vi.stubGlobal('location', { pathname: '/' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Proxy page' })),
  );
  await expect(
    preparePdfDownload('id', 'Doc', undefined, new AbortController().signal),
  ).rejects.toThrow('Could not export this PDF. Try again.');
});

test('download filename keeps visible Unicode but strips path/control characters and fixes extension', () => {
  expect(pdfFilename("attachment; filename*=UTF-8''Caf%C3%A9.pdf", 'fallback')).toBe('Café.pdf');
  expect(pdfFilename('attachment; filename="../../private.pdf"', 'fallback')).toBe(
    '_.._private.pdf',
  );
  expect(pdfFilename("attachment; filename*=UTF-8''%zz", 'Budget')).toBe('Budget.pdf');
  expect(pdfFilename(null, 'A\nB / plan')).toBe('A_B _ plan.pdf');
  expect(pdfFilename(null, '...')).toBe('document.pdf');
});
