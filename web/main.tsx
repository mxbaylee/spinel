import { registerAppWorker } from './installApp.ts';
import { parseShellManifest, sameCompatibility } from '../src/shared/offlineShell.ts';
import type { ShellManifest } from '../src/shared/offlineShell.ts';
import { installRuntimeHost, runtimeRequest } from './offline/runtime.ts';
import type { RuntimeHost } from './offline/runtime.ts';
import { createBootstrapJournal } from '../src/shared/bootstrapEvidence.ts';

type Application = {
  compatibility: RuntimeHost['compatibility'];
  startApplication(element: HTMLElement, host: RuntimeHost): () => void;
};
const bootstrap =
  import.meta.env.VITE_SYNC_EVIDENCE === '1'
    ? createBootstrapJournal(() => performance.now())
    : null;
if (bootstrap)
  Object.defineProperty(window, '__spinelBootstrapEvidence', { value: () => bootstrap.read() });
bootstrap?.mark('bootstrap-ready');
const root = document.getElementById('root')!;
const descriptor = document.getElementById('spinel-runtime')?.textContent;
const current = descriptor ? parseShellManifest(descriptor) : null;
let retire: (() => void) | undefined;
let sequence = 0;
const styles = new Map<string, HTMLLinkElement>();

async function loadStyles(manifest: ShellManifest, verify: () => void) {
  const prepared: HTMLLinkElement[] = [];
  try {
    for (const href of manifest.css) {
      verify();
      if (styles.has(href)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      // A cancelled pre-exposure admission must not style the newer visible app.
      link.media = 'not all';
      const loaded = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Spinel styles did not finish loading.')),
          10_000,
        );
        link.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        link.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Spinel styles could not load.'));
        };
      });
      document.head.append(link);
      prepared.push(link);
      await loaded;
      verify();
    }
    return prepared;
  } catch (error) {
    for (const link of prepared) link.remove();
    throw error;
  }
}

const host: RuntimeHost = {
  manifest: current,
  compatibility: current?.compatibility ?? { format: 1, sdkVersion: '1.1.0' },
  async switchTo(manifest, verifyCurrent) {
    await start(manifest, verifyCurrent);
  },
};
installRuntimeHost(host);
registerAppWorker();

async function start(
  manifest: ShellManifest | null,
  verifyCurrent: () => void,
  initialBoot = false,
) {
  const operation = ++sequence;
  const verify = () => {
    verifyCurrent();
    if (operation !== sequence) throw new DOMException('App startup changed.', 'AbortError');
  };
  verify();
  if (initialBoot) bootstrap?.mark('application-import-start');
  // The production entry is a public descriptor URL; the bootstrap has no static
  // dependency on React, the application, native editor code, or any private data.
  const application = (
    manifest ? await import(/* @vite-ignore */ manifest.entry) : await import('./application.tsx')
  ) as Application;
  if (initialBoot) bootstrap?.mark('application-import-end');
  verify();
  if (manifest && !sameCompatibility(manifest.compatibility, application.compatibility))
    throw new Error('This saved editor does not match its app version.');
  if (initialBoot) bootstrap?.mark('styles-start');
  const prepared = manifest ? await loadStyles(manifest, verify) : [];
  if (initialBoot) bootstrap?.mark('styles-end');
  try {
    verify();
  } catch (error) {
    for (const link of prepared) link.remove();
    throw error;
  }
  // No await may separate the final admission check from retiring the old view.
  retire?.();
  host.manifest = manifest;
  host.compatibility = application.compatibility;
  for (const [href, link] of styles) {
    if (!manifest?.css.includes(href)) {
      link.remove();
      styles.delete(href);
    }
  }
  for (const link of prepared) {
    link.media = 'all';
    styles.set(new URL(link.href).pathname, link);
  }
  retire = application.startApplication(root, host);
  if (initialBoot) bootstrap?.mark('application-start-returned');
  if (manifest) void runtimeRequest('claim', manifest.version).catch(() => {});
}

async function boot() {
  let selected = current;
  if (current) {
    let accountId: string | undefined;
    try {
      if (localStorage.getItem('spinel.offline.sign-out') === null)
        accountId = localStorage.getItem('spinel.offline.account') ?? undefined;
    } catch {
      /* Safe online bootstrap can still render account entry. */
    }
    try {
      bootstrap?.mark('worker-selection-start');
      const result = await runtimeRequest('bootstrap', current.version, accountId);
      if (result.manifest) selected = result.manifest;
      bootstrap?.mark('worker-selection-settled');
    } catch {
      bootstrap?.mark('worker-selection-fallback');
      /* App admission independently checks retained data before exposure. */
    }
  } else bootstrap?.mark('worker-selection-skipped');
  await start(selected, () => {}, true);
  bootstrap?.seal();
}
void boot().catch(() => {
  bootstrap?.mark('boot-rejected');
  bootstrap?.seal();
  root.textContent =
    'Spinel could not start. Connect and reload to try again. Your saved device data has not been changed.';
});
