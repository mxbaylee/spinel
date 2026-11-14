import { readDeviceInventory } from './deviceStorage.ts';
import { offlineAccountRead, openExistingOfflineStore, preparedAccount } from './offlineStore.ts';
import { hasUsableCopy, viewAfterNetworkFailure } from './warmOpen.ts';

/** A deep link can fail before this Dashboard has loaded any of its lists. */
export async function readWarmFailureView(
  accountId: string,
  currentId: string,
  current: () => boolean,
) {
  if (!current() || preparedAccount() !== accountId) return null;
  const accountCurrent = offlineAccountRead(accountId);
  const verify = () => {
    if (!current() || !accountCurrent() || preparedAccount() !== accountId)
      throw new DOMException('This saved view is no longer current.', 'AbortError');
  };
  let store;
  try {
    verify();
    // Observation never creates a database or switches the active app runtime.
    store = await openExistingOfflineStore(accountId);
    verify();
    if (!store) return null;
    const [catalog, inventory] = await Promise.all([
      store.catalog(),
      readDeviceInventory(accountId, verify),
    ]);
    verify();
    if (!catalog) return null;
    return viewAfterNetworkFailure({
      networkFailure: true,
      accountId,
      preparedAccountId: preparedAccount(),
      currentId,
      saved: catalog.views[currentId],
      views: Object.values(catalog.views),
      rows: [...catalog.items, ...catalog.shared],
      downloaded: hasUsableCopy(inventory.items.find((copy) => copy.itemId === currentId)),
    });
  } catch {
    return null;
  } finally {
    store?.close();
  }
}
