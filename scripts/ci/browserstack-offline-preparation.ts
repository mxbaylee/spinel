// Prepares a phone's offline copies through the production controls, and
// records how a failed preparation ended. Shared by the capability lanes
// (Dashboard Sheets and Docs) and authored acceptance (a Space page).
type Row = Record<string, unknown>;

/** The dialog's success status for this item, or its first alert. */
export const offlineResultScript = `const [message] = arguments;
const dialogs = [...document.querySelectorAll('[role="dialog"]')];
const texts = (role) => dialogs.flatMap(dialog => [...dialog.querySelectorAll('[role="' + role + '"]')].map(element => element.textContent.trim()));
return {dialogs: dialogs.length, done: texts('status').some(text => text.includes(message)), alert: texts('alert')[0]?.slice(0, 200) ?? null};`;
/** Bounded visible labels: a menu's offline entry or a dialog's buttons show progress. */
export const offlineStateScript = `const label = (element) => ({
  text: element.textContent.trim().slice(0, 80),
  disabled: element.getAttribute('aria-disabled') === 'true' || element.disabled === true,
});
return {
  menu: [...document.querySelectorAll('[role="menuitem"]')].map(label),
  dialog: [...document.querySelectorAll('[role="dialog"] button')].map(label),
};`;
// A first download fetches the runtime and every image, so it may outlast the
// few seconds Chrome measured; e2e allows 120 s for the same dialog.
export const offlinePreparationMilliseconds = 60_000;

export type OfflinePreparationDriver = {
  /** Waits for one enabled control with this label, then clicks it once. */
  click(selector: string, label: string): Promise<void>;
  execute(script: string, args?: unknown[]): Promise<unknown>;
  poll<T>(
    read: () => Promise<T>,
    accepts: (value: T) => boolean,
    label: string,
    maximum: number,
  ): Promise<T>;
  record(stage: string, value: unknown): Promise<void>;
  /** The caller's coded failure, in its own error namespace. */
  failure(code: string): Error;
  /**
   * Runs failure-only evidence reads. The runner keeps the stalled page's
   * screenshot and the command that failed, which the reads must not replace.
   */
  diagnose?<T>(work: () => Promise<T>): Promise<T>;
};

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-response-shape');
  return value as Row;
}

async function settle(
  driver: OfflinePreparationDriver,
  item: { kind: string; name: string },
  close: string,
) {
  const message = `${item.name} is available offline on this device.`;
  let last: Row | null = null;
  let state: Row;
  try {
    state = await driver.poll(
      async () => (last = row(await driver.execute(offlineResultScript, [message]))),
      (value) => value.done === true || typeof value.alert === 'string',
      'download-incomplete',
      offlinePreparationMilliseconds,
    );
  } catch (failure) {
    // Evidence only, on failure: the visible labels say whether the download
    // is still running, finished without its result, or never started. Only
    // when neither a dialog nor a menu is visible is the menu reopened, once;
    // its offline entry is never clicked again.
    let labels: unknown = 'unavailable';
    const read = async () => {
      labels = row(await driver.execute(offlineStateScript));
      const visible = labels as Row;
      if (
        Array.isArray(visible.menu) &&
        Array.isArray(visible.dialog) &&
        visible.menu.length === 0 &&
        visible.dialog.length === 0
      ) {
        await driver.click('button', 'Document actions');
        labels = { reopened: true, ...row(await driver.execute(offlineStateScript)) };
      }
    };
    try {
      await (driver.diagnose ? driver.diagnose(read) : read());
    } catch {
      // The original failure stays the result; labels keep what was read.
    }
    await driver.record(`${item.kind}:download-state`, { last, labels });
    throw failure;
  }
  if (state.done !== true) {
    await driver.record(`${item.kind}:download-state`, { last: state });
    throw driver.failure('download-failed');
  }
  await driver.click('[role="dialog"] button', close);
}

/** No application data is injected: prepare through the production download action. */
export async function prepareDashboardItemOffline(
  driver: OfflinePreparationDriver,
  item: { kind: string; name: string },
) {
  await driver.click('button', 'Document actions');
  await driver.click('[role="menuitem"]', 'Available offline on this device');
  await settle(driver, item, 'Done');
}

/** A Space page prepares from the Space's own Offline copies dialog (web/Space.tsx). */
export async function prepareSpacePageOffline(
  driver: OfflinePreparationDriver,
  page: { kind: string; name: string },
) {
  await driver.click('button', 'Document actions');
  await driver.click('[role="menuitem"]', 'Offline copies');
  await driver.click(
    '[role="dialog"] button',
    `Make ${page.name} available offline on this device`,
  );
  await settle(driver, page, 'Close dialog');
}
