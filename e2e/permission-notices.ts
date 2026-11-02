import type { BrowserContext, Page } from '@playwright/test';

export const protectionMessage = 'This content is protected. This action is not allowed.';

/** Observe before navigation so a transient startup warning cannot time out unseen. */
export async function recordPermissionNotices(context: BrowserContext) {
  await context.addInitScript((message) => {
    const notices: string[] = [];
    (window as Window & { startupPermissionNotices?: string[] }).startupPermissionNotices = notices;
    new MutationObserver((records) => {
      for (const record of records) {
        const changed = record.type === 'characterData' ? [record.target] : record.addedNodes;
        if ([...changed].some((node) => node.textContent?.includes(message))) notices.push(message);
      }
    }).observe(document, { childList: true, characterData: true, subtree: true });
  }, protectionMessage);
}

export async function permissionNotices(page: Page) {
  return page.evaluate(() => {
    const notices = (window as Window & { startupPermissionNotices?: string[] })
      .startupPermissionNotices;
    if (!notices)
      throw new Error('Permission notice observer was not installed before navigation.');
    return [...notices];
  });
}
