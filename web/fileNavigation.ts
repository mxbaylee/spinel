type NavigationStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = (accountId: string) => 'spinel:file-view:' + encodeURIComponent(accountId);
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

/** Only an ordinary view ID is remembered, never a return URL or document content. */
export function rememberFileView(
  accountId: string,
  itemId: string | null,
  storage?: NavigationStorage,
) {
  const value = itemId === 'trash' || (itemId !== null && uuid.test(itemId)) ? itemId : '';
  try {
    (storage ?? window.sessionStorage).setItem(key(accountId), value);
  } catch {
    // Browser storage is optional; My files still opens at its root.
  }
}

export function rememberedFileHref(accountId: string, storage?: NavigationStorage) {
  try {
    const value = (storage ?? window.sessionStorage).getItem(key(accountId));
    return value === 'trash' ? '/?trash=1' : value && uuid.test(value) ? '/?item=' + value : '/';
  } catch {
    return '/';
  }
}
