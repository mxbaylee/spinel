type BrowserLocation = { pathname: string; search: string };

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

function selection(query: URLSearchParams, space: string) {
  if (query.getAll('item').length > 1 || query.getAll('trash').length > 1) return null;
  const item = query.get('item');
  if (query.has('item') && (!item || !uuid.test(item))) return null;
  if (query.has('trash') && (query.get('trash') !== '1' || item)) return null;
  if (space === 'index' && (item || query.has('trash'))) return null;
  return item ? '?item=' + item.toLowerCase() : query.has('trash') ? '?trash=1' : '';
}

/** Carry only a known Space route and opaque IDs through sign-in, never a URL. */
export function spaceReviewSignInPath(location: BrowserLocation): string | null {
  const match = /^\/(?:review\/)?spaces(?:\/([^/]+))?\/?$/.exec(location.pathname);
  if (!match || (match[1] && !uuid.test(match[1]))) return null;
  const space = match[1]?.toLowerCase() ?? 'index';
  const suffix = selection(new URLSearchParams(location.search), space);
  return suffix === null ? null : '/sign-in?space=' + space + suffix.replace('?', '&');
}

/** The server still checks current account access on arrival. */
export function spaceReviewReturnPath(location: BrowserLocation): string | null {
  if (location.pathname !== '/sign-in') return null;
  const query = new URLSearchParams(location.search);
  const space = query.get('space');
  if (
    query.has('connect') ||
    query.getAll('space').length !== 1 ||
    !space ||
    (space !== 'index' && !uuid.test(space))
  )
    return null;
  const suffix = selection(query, space);
  if (suffix === null) return null;
  return '/spaces' + (space === 'index' ? '' : '/' + space.toLowerCase()) + suffix;
}
