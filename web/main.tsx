import { registerAppWorker } from './installApp.ts';
import { parseShellManifest, sameCompatibility } from '../src/shared/offlineShell.ts';
import type { ShellManifest } from '../src/shared/offlineShell.ts';
import { installRuntimeHost, runtimeRequest } from './offline/runtime.ts';
import type { RuntimeHost } from './offline/runtime.ts';

type Application = {
  compatibility: RuntimeHost['compatibility'];
  startApplication(element: HTMLElement, host: RuntimeHost): () => void;
};
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

async function start(manifest: ShellManifest | null, verifyCurrent: () => void) {
  const operation = ++sequence;
  const verify = () => {
    verifyCurrent();
    if (operation !== sequence) throw new DOMException('App startup changed.', 'AbortError');
  };
  verify();
  // The production entry is a public descriptor URL; the bootstrap has no static
  // dependency on React, the application, native editor code, or any private data.
  const application = (
    manifest ? await import(/* @vite-ignore */ manifest.entry) : await import('./application.tsx')
  ) as Application;
  verify();
  if (manifest && !sameCompatibility(manifest.compatibility, application.compatibility))
    throw new Error('This saved editor does not match its app version.');
  const prepared = manifest ? await loadStyles(manifest, verify) : [];
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
      const result = await runtimeRequest('bootstrap', current.version, accountId);
      if (result.manifest) selected = result.manifest;
    } catch {
      /* App admission independently checks retained data before exposure. */
    }
  }
  await start(selected, () => {});
}
void boot().catch(() => {
  root.textContent =
    'Spinel could not start. Connect and reload to try again. Your saved device data has not been changed.';
});
