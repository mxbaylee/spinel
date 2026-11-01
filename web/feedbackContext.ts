import { isUuid } from '@spinel/diagnostics';
import type { FeedbackPageContext } from '../src/shared/feedback.ts';

/** Convert the current view into a fixed route label; never send a URL or title. */
export function feedbackPageContext(
  address: Pick<Location, 'pathname' | 'search'>,
  documentOpen = false,
  page?: { fileId: string; spaceId: string },
): FeedbackPageContext {
  if (page && isUuid(page.fileId) && isUuid(page.spaceId))
    return { route: '/spaces/:id', fileId: page.fileId, spaceId: page.spaceId };
  if (/^\/(?:review\/)?spaces(?:\/|$)/.test(address.pathname)) {
    const spaceId = /^\/(?:review\/)?spaces\/([^/]+)\/?$/.exec(address.pathname)?.[1];
    const query = new URLSearchParams(address.search);
    const fileId = query.getAll('item').length === 1 ? query.get('item') : null;
    return {
      route: '/spaces/:id',
      ...(documentOpen && isUuid(fileId) && isUuid(spaceId) ? { fileId, spaceId } : {}),
    };
  }
  if (address.pathname === '/profile' || address.pathname === '/settings')
    return { route: '/profile' };
  const query = new URLSearchParams(address.search);
  const fileId = query.getAll('item').length === 1 ? query.get('item') : null;
  return documentOpen && isUuid(fileId) ? { route: '/files/:id', fileId } : { route: '/files' };
}
