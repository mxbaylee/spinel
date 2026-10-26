import { documentPath, guestItemId } from './documentAccess.ts';
import { revokeGuestView } from './guestRevocation.ts';
import { clearDashboardNavigation } from './dashboardNavigation.ts';

export type PdfOptions = {
  kind: 'sheet' | 'doc';
  worksheets?: { id: string; name: string }[];
};

async function checked(
  response: Response,
  signal: AbortSignal,
  spaceId: string | undefined,
  verifyCurrent: () => void,
) {
  signal.throwIfAborted();
  verifyCurrent();
  if (response.ok) return response;
  const guest = guestItemId();
  if ([401, 403, 404].includes(response.status) && guest) {
    if (spaceId) {
      // A moved/deleted child must not revoke a still-valid Space link. Recheck
      // through the guest namespace, even when an account cookie is present.
      const root = await fetch(`/api/guest-spaces/${encodeURIComponent(guest)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
      signal.throwIfAborted();
      verifyCurrent();
      if ([401, 403, 404].includes(root.status)) revokeGuestView();
    } else revokeGuestView();
  } else if (response.status === 401) {
    clearDashboardNavigation();
    location.assign('/sign-in');
  }
  const body: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  verifyCurrent();
  throw new Error(
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : 'Could not export this PDF. Try again.',
  );
}

export async function readPdfOptions(
  id: string,
  signal: AbortSignal,
  spaceId?: string,
  verifyCurrent: () => void = () => {},
) {
  const response = await checked(
    await fetch(`${documentPath(id, spaceId)}/pdf`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    }),
    signal,
    spaceId,
    verifyCurrent,
  );
  const options: unknown = await response.json();
  signal.throwIfAborted();
  verifyCurrent();
  if (
    !options ||
    typeof options !== 'object' ||
    !('kind' in options) ||
    (options.kind !== 'sheet' && options.kind !== 'doc') ||
    (options.kind === 'sheet' &&
      (!('worksheets' in options) ||
        !Array.isArray(options.worksheets) ||
        options.worksheets.some(
          (sheet: unknown) =>
            !sheet ||
            typeof sheet !== 'object' ||
            !('id' in sheet) ||
            typeof sheet.id !== 'string' ||
            !('name' in sheet) ||
            typeof sheet.name !== 'string',
        )))
  )
    throw new Error('Could not load PDF options. Try again.');
  return options as PdfOptions;
}

/** Browser download names never carry path segments, control bytes or a non-PDF extension. */
export function pdfFilename(disposition: string | null, fallback: string) {
  let name = fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1];
  const quoted = /filename="([^"\r\n]+)"/i.exec(disposition ?? '')?.[1];
  if (encoded) {
    try {
      name = decodeURIComponent(encoded);
    } catch {
      /* A malformed header uses the already visible document title. */
    }
  } else if (quoted) name = quoted;
  name = name
    .replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, '_')
    .replace(/\.pdf$/i, '')
    .trim();
  name = name.replace(/^[. ]+|[. ]+$/g, '').slice(0, 180);
  return `${name || 'document'}.pdf`;
}

export async function preparePdfDownload(
  id: string,
  name: string,
  worksheetIds: string[] | undefined,
  signal: AbortSignal,
  spaceId?: string,
  verifyCurrent: () => void = () => {},
) {
  const response = await checked(
    await fetch(`${documentPath(id, spaceId)}/pdf`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(worksheetIds ? { worksheetIds } : {}),
      signal,
    }),
    signal,
    spaceId,
    verifyCurrent,
  );
  if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/pdf')
    throw new Error('Could not export this PDF. Try again.');
  const blob = await response.blob();
  signal.throwIfAborted();
  verifyCurrent();
  return { blob, filename: pdfFilename(response.headers.get('content-disposition'), name) };
}

export function downloadPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
