import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { NativeSnapshot } from '@spinel/sync-client';
import { mapNativeImageSources } from '../../src/shared/nativeImageSources.ts';
import { snapshotIdentity } from '../../src/shared/snapshotIdentity.ts';
import { reconstructOffline } from '../../web/offline/recovery.ts';
import type { StoredItem } from '../../web/offline/offlineStore.ts';
import { comparable, pending } from '../../e2e/offline-fixture.ts';
import { createDesktopBrowser } from './desktop-browser.ts';
import type { DesktopBrowserKind, DesktopBrowserStart } from './desktop-browser.ts';
import { createDesktopOfflineFixture } from './desktop-offline-fixture.ts';

const kind = process.argv[2] as DesktopBrowserKind;
assert.ok(['chrome', 'firefox', 'safari'].includes(kind));
const output = resolve(`artifacts/desktop-offline/${kind}`);
const directory = resolve(`test-results/desktop-offline-${kind}`);
const run = promisify(execFile);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const browser = createDesktopBrowser(kind, resolve(directory, 'profile'), output);
const report: Record<string, unknown> = {
  scope:
    'Actual macOS ordinary-profile application restart, retained images/edits, reconnect and storage loss',
  sourceSha: process.env.SOURCE_SHA,
  testedSha: process.env.GITHUB_SHA,
  run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  browser: kind,
  status: 'failed',
  stages: [],
};
const stages = report.stages as Record<string, unknown>[];
const stage = (name: string, evidence: Record<string, unknown> = {}) => {
  stages.push({ name, time: new Date().toISOString(), ...evidence });
  console.log(`Desktop ${kind}: ${name}`);
};

async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeout = 45_000,
) {
  const deadline = Date.now() + timeout;
  let last: unknown;
  do {
    try {
      const value = await read();
      if (accept(value)) return value;
      last = value;
    } catch (error) {
      last = String(error);
    }
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(last)?.slice(0, 1800)}`);
}

async function named(selector: string, name: string) {
  const index = await until(
    () =>
      browser.evaluate<number>(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).findIndex(element => element.getClientRects().length && (element.getAttribute('aria-label') || element.textContent).trim().replace(/\\s+/g, ' ') === ${JSON.stringify(name)})`,
      ),
    (value) => value >= 0,
    `Missing ${name}`,
  );
  await browser.click(selector, index);
}

const status = () =>
  browser.evaluate<string>(
    'document.querySelector(\'[aria-label="Save status"]\')?.textContent || ""',
  );
const waitStatus = (text: string) =>
  until(status, (value) => value.includes(text), `Save status ${text}`);
async function canvas() {
  await until(
    () =>
      browser.evaluate<number>(
        'Math.max(0, ...Array.from(document.querySelectorAll(".univer-container canvas")).map(canvas => canvas.getBoundingClientRect().height))',
      ),
    (value) => value > 100,
    'Usable native document surface',
  );
}

type Local = {
  item: StoredItem | null;
  images: { source: string; sha256: string; size: number }[];
};
async function local(accountId: string, itemId: string): Promise<Local> {
  return browser.evaluate<Local>(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(${JSON.stringify(`spinel-offline-${accountId}`)});
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Original private database is missing')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
    });
    try {
      const tx = db.transaction(['items','images'], 'readonly');
      const read = request => new Promise((resolve,reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [item, allImages] = await Promise.all([read(tx.objectStore('items').get(${JSON.stringify(itemId)})), read(tx.objectStore('images').getAll())]);
      const images = await Promise.all(allImages.filter(image => image.itemId === ${JSON.stringify(itemId)}).map(async image => ({ source: image.source, size: image.bytes.byteLength, sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', image.bytes))).map(byte => byte.toString(16).padStart(2,'0')).join('') })));
      return { item: item || null, images: images.sort((a,b) => a.source.localeCompare(b.source)) };
    } finally { db.close(); }
  })()`);
}

async function edit(documentKind: 'sheet' | 'doc', text: string) {
  if (documentKind === 'sheet') {
    await browser.focus('[data-u-comp="defined-name"] input');
    await browser.press('SelectAll');
    await browser.type('D1');
    await browser.press('Enter');
  } else {
    // Selection/focus uses the native contenteditable surface. All text enters
    // through real browser/OS keyboard events, never a writable editor facade.
    await browser.clickAt('.univer-container', 130, 200);
    await browser.focus('[contenteditable="true"][data-u-comp="editor"]');
    await browser.press('DocumentStart');
  }
  await browser.type(text);
  if (documentKind === 'sheet') await browser.press('Enter');
  await waitStatus('Saved on this device');
}

async function nativeText(documentKind: 'sheet' | 'doc') {
  if (documentKind === 'sheet') {
    await browser.focus('[data-u-comp="defined-name"] input');
    await browser.press('SelectAll');
    await browser.type('D1');
    await browser.press('Enter');
  } else {
    await browser.clickAt('.univer-container', 130, 200);
    await browser.focus('[contenteditable="true"][data-u-comp="editor"]');
    await browser.press('SelectAll');
  }
  // Copy goes through the real native selection/clipboard path. The hosted
  // user's clipboard contains only these disposable fixtures.
  const sentinel = `not-copied-${randomUUID()}`;
  await run(
    '/usr/bin/osascript',
    ['-e', 'on run argv\nset the clipboard to item 1 of argv\nend run', sentinel],
    { timeout: 5000 },
  );
  await browser.press('Copy');
  return until(
    async () => (await run('/usr/bin/pbpaste', [], { timeout: 5000 })).stdout,
    (value) => value !== sentinel,
    'Native clipboard content',
  );
}

/** Copy naming and root/image ownership change; every other native field stays compared. */
function content(snapshot: NativeSnapshot) {
  const scoped = snapshotIdentity(structuredClone(snapshot), 'desktop-comparison');
  const images = mapNativeImageSources(
    scoped,
    (source) =>
      source.replace(/^\/api\/items\/[^/]+\/images\//, '/api/items/desktop-comparison/images/'),
    { updateSourceType: true },
  );
  return comparable({ ...images, name: undefined, title: undefined } as NativeSnapshot);
}

function imageSources(snapshot: NativeSnapshot, itemId: string, hashes: string[]) {
  const found = new Set<string>();
  mapNativeImageSources(snapshot, (source) => {
    const prefix = `/api/items/${itemId}/images/`;
    assert.ok(source.startsWith(prefix), 'Every native image must belong to this actual item');
    const imageHash = source.slice(prefix.length);
    assert.match(imageHash, /^[a-f\d]{64}$/);
    found.add(imageHash);
    return source;
  });
  assert.deepEqual([...found].sort(), [...hashes].sort());
}

async function visibleImages(name: string, documentKind: 'sheet' | 'doc') {
  const path = resolve(output, `${name}.png`);
  const colors =
    documentKind === 'sheet'
      ? [
          [255, 153, 0],
          [34, 85, 238],
          [34, 187, 102],
        ]
      : [[119, 0, 204]];
  let captures = 0;
  const counts = await until(
    async () => {
      await browser.screenshot(path);
      captures++;
      const { data, info } = await sharp(path)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const counts = colors.map(() => 0);
      for (let offset = 0; offset < data.length; offset += info.channels)
        colors.forEach((color, index) => {
          if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
            counts[index]++;
        });
      return counts;
    },
    (counts) => counts.every((count) => count > 100),
    'Existing image pixels must actually paint after native canvas creation',
    15_000,
  );
  return { file: `${name}.png`, colorPixelCounts: counts, captures };
}

let fixture: Awaited<ReturnType<typeof createDesktopOfflineFixture>> | undefined;
const launches: DesktopBrowserStart[] = [];
async function launch(url: string) {
  const evidence = await browser.start(url);
  assert.equal(evidence.version, (report.release as { installed: string }).installed);
  if (launches.length) assert.deepEqual(evidence.profile, launches[0].profile);
  const environment = await browser.evaluate<{
    browserTab: boolean;
    secureContext: boolean;
    storagePersisted: boolean;
  }>(
    `(async () => ({ browserTab: matchMedia('(display-mode: browser)').matches, secureContext: isSecureContext, storagePersisted: await navigator.storage.persisted() }))()`,
  );
  assert.equal(environment.browserTab, true, 'Acceptance must use an ordinary browser tab');
  assert.equal(environment.secureContext, true);
  launches.push(evidence);
  stage('browser-start', { ...evidence, ...environment });
}

async function main() {
  assert.equal(process.platform, 'darwin');
  await mkdir(output, { recursive: true });
  await mkdir(directory, { recursive: true });
  try {
    report.os = (await run('/usr/bin/sw_vers', [], { timeout: 5000 })).stdout.trim();
    const release = JSON.parse(await readFile(resolve(output, 'versions.json'), 'utf8'));
    assert.equal(release.status, 'passed');
    assert.equal(release.kind, kind);
    report.release = release;
    fixture = await createDesktopOfflineFixture({
      directory,
      keyPath: resolve('test-results/desktop-tls/key.pem'),
      certPath: resolve('test-results/desktop-tls/cert.pem'),
    });
    const f = fixture;
    const originalImages = new Map(f.items.map((item) => [item.id, f.imageRows(item.id)]));
    report.actor = { id: f.actor.id, role: 'Collaborator with editor grants', ownerId: f.owner.id };
    await launch(f.loginURL);
    await named('button', 'Shared with me');
    const initial = new Map<string, Local>();
    const retained = new Map<string, Local>();
    const expected = new Map<string, NativeSnapshot>();
    const persistence: Record<string, unknown>[] = [];
    for (const item of f.items) {
      await browser.goto(`${f.origin}/?item=${item.id}`);
      await waitStatus('All changes saved.');
      await canvas();
      await until(
        () => browser.evaluate<boolean>('Boolean(navigator.serviceWorker.controller)'),
        Boolean,
        'Controlling service worker',
      );
      const before = await browser.evaluate<boolean>('navigator.storage.persisted()');
      await named('button', 'Document actions');
      await named('[role="menuitem"]', 'Available offline on this device');
      const permission =
        kind === 'firefox' && !before ? await browser.resolveStoragePrompt() : null;
      const message = await until(
        () =>
          browser.evaluate<string>(
            'document.querySelector(\'[role="dialog"][aria-labelledby]\')?.textContent || Array.from(document.querySelectorAll(\'[role="dialog"]\')).map(node => node.textContent).join(" ")',
          ),
        (value) => value.includes(`${item.name} is available offline on this device.`),
        'Complete image-backed download',
        120_000,
      );
      const after = await browser.evaluate<boolean>('navigator.storage.persisted()');
      assert.ok(
        message.includes(
          after
            ? 'Your browser granted storage protection.'
            : 'Your browser did not grant storage protection.',
        ),
        'Download result must report the actual persistence grant',
      );
      if (!after) {
        const location = await browser.evaluate<string>('location.href');
        await named('[role="dialog"] button', 'How to keep them');
        await until(
          () => browser.evaluate<string>('document.body.innerText'),
          (value) =>
            value.includes('Downloads stay in this browser profile.') &&
            value.includes('Protection is not a backup'),
          'Production retention guidance',
        );
        assert.equal(await browser.evaluate<string>('location.href'), location);
        await canvas();
        await browser.press('Escape');
        await until(
          () => browser.evaluate<string>('document.activeElement?.textContent || ""'),
          (value) => value === 'How to keep them',
          'Storage help returns focus to the active download result',
        );
      }
      persistence.push({
        itemId: item.id,
        before,
        after,
        permission,
        message,
      });
      await named('[role="dialog"] button', 'Done');
      await waitStatus('Synced.');
      const prepared = await local(f.actor.id, item.id);
      assert.ok(prepared.item?.outbox);
      assert.equal(pending(prepared.item.outbox.checkpoint), false);
      assert.ok(prepared.images.length > 0);
      assert.deepEqual(
        prepared.images
          .map((image) => ({ sha256: image.sha256, size: image.size }))
          .sort((a, b) => a.sha256.localeCompare(b.sha256)),
        f
          .imageRows(item.id)
          .map((image) => ({
            sha256: String(image.id),
            size: Buffer.from(String(image.bytes), 'hex').length,
          }))
          .sort((a, b) => a.sha256.localeCompare(b.sha256)),
      );
      initial.set(item.id, prepared);
    }
    report.persistence = persistence;
    stage('all-four-downloads-complete');
    await f.setOffline(true);
    stage('transport-disabled-before-quit', await f.verifyDisconnected());
    // Online openings may refresh another clean copy and remove its empty
    // outbox. Observe the actual pre-quit records after the online scope ends;
    // preserve full equality across the process boundary, including metadata.
    await browser.goto(f.origin + '/');
    await named('button', 'Shared with me');
    for (const item of f.items) {
      const beforeQuit = await local(f.actor.id, item.id);
      assert.ok(beforeQuit.item);
      assert.deepEqual(beforeQuit.item.bundle, initial.get(item.id)!.item!.bundle);
      assert.deepEqual(beforeQuit.images, initial.get(item.id)!.images);
      assert.equal(pending(beforeQuit.item.outbox?.checkpoint), false);
      initial.set(item.id, beforeQuit);
    }
    stage('exact-records-captured-before-quit');
    stage('browser-stop', await browser.stop());
    stage('transport-disabled-before-relaunch', await f.verifyDisconnected());
    await launch(f.origin + '/');
    await named('button', 'Shared with me');
    for (const item of f.items) {
      await until(
        () => browser.evaluate<string>('document.body.innerText'),
        (value) => value.includes(item.name),
        `Retained catalog ${item.name}`,
      );
      const observed = await local(f.actor.id, item.id);
      assert.deepEqual(observed, initial.get(item.id));
    }
    stage('offline-catalog-and-original-records-retained');
    for (const item of f.items) {
      await browser.goto(`${f.origin}/?item=${item.id}`);
      await canvas();
      await waitStatus('Saved on this device');
      await edit(item.kind, item.kind === 'sheet' ? '731' : 'Desktop offline 731 ');
      const queued = await until(
        () => local(f.actor.id, item.id),
        (value) => Boolean(value.item?.outbox && pending(value.item.outbox.checkpoint)),
        'Durable native edit',
      );
      retained.set(item.id, queued);
      const native = reconstructOffline(queued.item!.outbox!.checkpoint, item.kind);
      if ('sheets' in native)
        assert.equal(native.sheets[native.sheetOrder[0]].cellData?.[0]?.[3]?.v, 731);
      else
        assert.equal(
          native.body!.dataStream,
          'Desktop offline 731 ' +
            (item.baseline.snapshot as { body: { dataStream: string } }).body.dataStream,
        );
      expected.set(item.id, native);
      assert.deepEqual(await f.read(item.id, item.unitId), item.baseline);
    }
    stage('native-offline-edits-committed');
    stage('browser-stop', await browser.stop());
    stage('transport-still-disabled-before-pending-relaunch', await f.verifyDisconnected());
    await launch(f.origin + '/');
    for (const item of f.items) {
      const restored = await local(f.actor.id, item.id);
      assert.deepEqual(restored, retained.get(item.id));
      await browser.goto(`${f.origin}/?item=${item.id}`);
      await canvas();
      await waitStatus('Saved on this device');
      assert.deepEqual(
        (await local(f.actor.id, item.id)).item?.outbox?.checkpoint,
        restored.item?.outbox?.checkpoint,
      );
      const visual = await visibleImages(`${item.kind}-${item.outcome}-offline`, item.kind);
      assert.ok(
        (await nativeText(item.kind)).includes(
          item.kind === 'sheet' ? '731' : 'Desktop offline 731 ',
        ),
        'Restored native visible text must contain the actual offline edit',
      );
      stage('pending-restart-retained', {
        itemId: item.id,
        kind: item.kind,
        outcome: item.outcome,
        checkpointSha256: hash(restored.item!.outbox!.checkpoint),
        imageHashes: restored.images,
        visual,
      });
    }
    await browser.goto(f.origin + '/');
    const originals = new Map<string, unknown>();
    for (const item of f.items.filter((item) => item.outcome === 'conflict')) {
      await f.remoteEdit(item);
      originals.set(item.id, f.originalState(item));
    }
    const receipts = () =>
      f.db
        .prepare('SELECT * FROM workspace_offline_recoveries WHERE user_id=? ORDER BY recovery_id')
        .all(f.actor.id);
    const recoveryIds = new Set<string>();
    assert.deepEqual(receipts(), []);
    await f.setOffline(false);
    stage('transport-restored');
    for (const item of f.items) {
      await browser.goto(`${f.origin}/?item=${item.id}`);
      await canvas();
      if (item.outcome === 'normal') {
        await waitStatus('Synced.');
        const committed = await f.read(item.id, item.unitId);
        assert.ok(committed.revision > item.baseline.revision);
        assert.equal(committed.unitId, item.unitId);
        imageSources(
          committed.snapshot,
          item.id,
          originalImages.get(item.id)!.map((image) => image.id),
        );
        assert.deepEqual(comparable(committed.snapshot), comparable(expected.get(item.id)!));
        assert.deepEqual(f.imageRows(item.id), originalImages.get(item.id));
        const clean = await local(f.actor.id, item.id);
        assert.ok(clean.item?.outbox);
        assert.equal(pending(clean.item.outbox.checkpoint), false);
        assert.equal(clean.item.outbox.checkpoint.revision, committed.revision);
        await browser.goto(`${f.origin}/?item=${item.id}`);
        await waitStatus('Synced.');
        assert.deepEqual(await f.read(item.id, item.unitId), committed);
        stage('normal-reconnect-exact-content-once', {
          itemId: item.id,
          revision: committed.revision,
          snapshotSha256: hash(committed.snapshot),
          images: f.imageRows(item.id),
        });
      } else {
        await until(status, (value) => value.includes('Needs attention'), 'Conflict recovery');
        await named('button', 'Save details: Needs attention');
        const href = await until(
          () =>
            browser.evaluate<string>(
              'Array.from(document.querySelectorAll(\'[role="dialog"] a\')).find(link=>link.textContent.trim()==="Open copy")?.getAttribute("href") || ""',
            ),
          Boolean,
          'One published recovery copy',
        );
        const copyId = new URL(href, f.origin).searchParams.get('item');
        assert.ok(copyId && copyId !== item.id);
        assert.deepEqual(f.originalState(item), originals.get(item.id));
        recoveryIds.add(copyId);
        assert.deepEqual(
          receipts()
            .map((row) => String(row.item_id))
            .sort(),
          [...recoveryIds].sort(),
        );
        const metadata = f.recoveryMetadata(copyId);
        assert.equal(metadata.owner_id, f.actor.id);
        assert.equal(metadata.parent_id, null);
        assert.equal(metadata.space_id, null);
        assert.equal(metadata.kind, item.kind);
        assert.ok(String(metadata.name).startsWith(`${item.name} (offline copy, `));
        await until(
          () => local(f.actor.id, item.id),
          (value) => value.item === null && value.images.length === 0,
          'Recovered original no longer advertises a retained device copy',
        );
        const copied = await f.readRecovered(copyId);
        assert.equal(copied.snapshot.id, copied.unitId);
        assert.equal(
          'sheets' in copied.snapshot ? copied.snapshot.name : copied.snapshot.title,
          metadata.name,
        );
        imageSources(
          copied.snapshot,
          copyId,
          originalImages.get(item.id)!.map((image) => image.id),
        );
        assert.deepEqual(content(copied.snapshot), content(expected.get(item.id)!));
        assert.deepEqual(f.imageRows(copyId), f.imageRows(item.id));
        const publishedReceipts = receipts();
        await browser.goto(`${f.origin}/?item=${item.id}`);
        await waitStatus('All changes saved.');
        await f.setOffline(true);
        stage('recovered-original-reconnect-outage', {
          itemId: item.id,
          ...(await f.verifyDisconnected()),
        });
        await f.setOffline(false);
        await browser.goto(`${f.origin}/?item=${item.id}`);
        await waitStatus('All changes saved.');
        await browser.goto(`${f.origin}${href}`);
        await waitStatus('All changes saved.');
        await canvas();
        assert.ok(
          (await nativeText(item.kind)).includes(
            item.kind === 'sheet' ? '731' : 'Desktop offline 731 ',
          ),
        );
        assert.deepEqual(f.originalState(item), originals.get(item.id));
        assert.deepEqual(receipts(), publishedReceipts);
        stage('conflict-copy-preserves-original', {
          itemId: item.id,
          copyId,
          receipts: publishedReceipts,
          snapshotSha256: hash(copied.snapshot),
          images: f.imageRows(copyId),
        });
      }
    }
    assert.equal(receipts().length, 2);
    // Deliberate loss of private downloads uses real browser deletion APIs, with no
    // claim that filling a CI disk reproduces the browser's eviction heuristic.
    // Return online first so the server can supply catalog names after loss.
    await browser.goto(f.origin + '/');
    await named('button', 'Shared with me');
    await until(
      () =>
        browser.evaluate<number>(
          'document.querySelectorAll(\'.offline-badge[data-state="available"]\').length',
        ),
      (value) => value === 2,
      'Two normal copies positively advertise availability before storage deletion',
    );
    await browser.evaluate(`(async () => {
      for(const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      for(const key of await caches.keys()) await caches.delete(key);
      localStorage.clear();
      await new Promise((resolve,reject) => { const request=indexedDB.deleteDatabase(${JSON.stringify(`spinel-offline-${f.actor.id}`)}); request.onsuccess=resolve; request.onerror=()=>reject(request.error); request.onblocked=()=>reject(new Error('Private database is still open')); });
    })()`);
    await browser.goto(f.origin + '/');
    await named('button', 'Shared with me');
    for (const item of f.items)
      await until(
        () => browser.evaluate<string>('document.body.innerText'),
        (value) => value.includes(item.name),
        'Catalog returns from server after storage loss',
      );
    const lost = await browser.evaluate<{ account: string | null; available: number }>(
      '({account:localStorage.getItem("spinel.offline.account"),available:document.querySelectorAll(\'.offline-badge[data-state="available"]\').length})',
    );
    assert.equal(lost.account, null);
    assert.equal(lost.available, 0);
    stage('cleared-storage-is-not-advertised', { lost });
    await until(
      () => browser.evaluate<boolean>('Boolean(navigator.serviceWorker.controller)'),
      Boolean,
      'Fresh service worker controls the online page after explicit storage loss',
    );
    await f.setOffline(true);
    stage('post-deletion-outage', await f.verifyDisconnected());
    await browser.goto(`${f.origin}/?item=${f.items[0].id}`);
    const unavailable = await until(
      () => browser.evaluate<string>('document.body.innerText'),
      (value) => value.includes("You're offline") && value.includes('Connect to the internet'),
      'Missing copies require a connection after explicit storage loss',
    );
    assert.ok(!unavailable.includes('Saved on this device'));
    assert.equal(
      await browser.evaluate<number>(
        'document.querySelectorAll(".univer-container canvas").length',
      ),
      0,
    );
    stage('missing-data-cannot-open-offline', { message: unavailable });
    report.transport = f.transport;
    report.status = 'passed';
    stage('complete');
  } catch (error) {
    report.error = String(error);
    report.stack = error instanceof Error ? error.stack : undefined;
    report.page = await browser
      .evaluate(
        '({url:location.href,text:document.body.innerText.slice(0,6000),status:document.querySelector(\'[aria-label="Save status"]\')?.textContent})',
      )
      .catch(String);
    await browser.screenshot(resolve(output, 'failure.png')).catch(() => {});
    await browser.screenshot(resolve(output, 'failure-screen.png'), 'screen').catch(() => {});
    process.exitCode = 1;
  } finally {
    try {
      stage('browser-stop', await browser.stop());
    } catch (error) {
      report.teardownError = String(error);
      report.status = 'failed';
      process.exitCode = 1;
    }
    try {
      await fixture?.close();
    } catch (error) {
      report.fixtureTeardownError = String(error);
      report.status = 'failed';
      process.exitCode = 1;
    }
    report.launches = launches;
    await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}

await main();
