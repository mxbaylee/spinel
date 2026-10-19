import { parseSearch, searchCatalog, searchItems } from '../../shared/search.ts';
import { AuthError } from '../auth/store.ts';
import type { WorkspaceStore } from './store.ts';

export class WorkspaceSearch {
  private readonly store: WorkspaceStore;
  constructor(store: WorkspaceStore) {
    this.store = store;
  }
  find(userId: string, input: Record<string, unknown>) {
    this.store.owner(userId);
    let query;
    try {
      query = parseSearch(input);
    } catch {
      throw new AuthError(400, 'Invalid search filters.');
    }
    return this.store.auth.transaction(() => {
      const owned = this.store.list(userId).flatMap((item) => {
        try {
          return [this.store.get(userId, item.id)];
        } catch (error) {
          if (error instanceof AuthError && error.status === 404) return [];
          throw error;
        }
      });
      const catalog = searchCatalog([...owned, ...this.store.shared(userId)]);
      return searchItems(catalog, query, this.store.auth.now());
    });
  }
}
