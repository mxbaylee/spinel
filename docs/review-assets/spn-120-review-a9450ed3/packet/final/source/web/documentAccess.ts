/** The guest page uses a distinct request namespace; account cookies are never its identity. */
export function guestItemId() {
  return typeof location === 'undefined'
    ? undefined
    : /^\/share\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/?$/i
        .exec(location.pathname)?.[1]
        .toLowerCase();
}
export function documentPath(id: string, spaceId?: string) {
  const guest = guestItemId();
  if (guest && (spaceId ?? id) !== guest) throw new Error('This document is not available.');
  if (spaceId)
    return `/api/${guest ? 'guest-spaces' : 'spaces'}/${encodeURIComponent(spaceId)}/items/${encodeURIComponent(id)}`;
  return guest ? `/api/guest/${id}` : `/api/items/${id}`;
}

/** The native sync server uses the same exact account/guest and root/child scope. */
export function documentSyncPath(id: string, spaceId?: string) {
  return documentPath(id, spaceId).replace(/^\/api\//, '/sync-api/');
}
