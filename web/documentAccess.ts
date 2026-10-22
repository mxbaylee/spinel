/** The guest page uses a distinct request namespace; account cookies are never its identity. */
export function guestItemId() {
  return typeof location === 'undefined'
    ? undefined
    : /^\/share\/([a-f\d-]{36})$/.exec(location.pathname)?.[1];
}
export function documentPath(id: string, spaceId?: string) {
  if (spaceId)
    return `/api/${guestItemId() === spaceId ? 'guest-spaces' : 'spaces'}/${encodeURIComponent(spaceId)}/items/${encodeURIComponent(id)}`;
  return guestItemId() === id ? `/api/guest/${id}` : `/api/items/${id}`;
}

/** A stable child ID remains separate from the native SDK's active generation ID. */
export function documentProtocolPath(space?: { spaceId: string; itemId: string }) {
  if (space)
    return `/${guestItemId() === space.spaceId ? 'guest-space-api' : 'space-api'}/${encodeURIComponent(space.spaceId)}/items/${encodeURIComponent(space.itemId)}/universer-api`;
  const guest = guestItemId();
  return `${guest ? `/guest-api/${guest}` : ''}/universer-api`;
}
