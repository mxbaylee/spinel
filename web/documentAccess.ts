/** The guest page uses a distinct request namespace; account cookies are never its identity. */
export function guestItemId() {
  return /^\/share\/([a-f\d-]{36})$/.exec(location.pathname)?.[1];
}
export function documentPath(id: string) {
  return guestItemId() === id ? `/api/guest/${id}` : `/api/items/${id}`;
}
