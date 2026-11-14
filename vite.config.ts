import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import sharp from 'sharp';
import { CURRENT_SDK_VERSION, shellFiles, SHELL_PLACEHOLDER } from './src/shared/offlineShell.ts';
import type { RuntimeCompatibility, ShellManifest } from './src/shared/offlineShell.ts';
import { installationAssetName, installationPaths, pwaManifest } from './src/shared/pwa.ts';
import { iconSvg } from './src/ui/appIcon.ts';
import { rendererOutput } from './src/build/rendererChunks.ts';

// Write the offline app shell (docs/offline.md) into the built service worker.
// Its contents change with every build, so browsers install the new worker.
function offlineShell(compatibility: RuntimeCompatibility, fixtureFormat?: number): Plugin {
  return {
    name: 'spinel-offline-shell',
    apply: 'build',
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const worker = bundle['service-worker.js'];
        // Storybook builds with this config but without the service-worker entry.
        if (!worker) return;
        if (worker.type !== 'chunk') return this.error('The service worker was not built.');
        const application = Object.values(bundle).find(
          (file) => file.type === 'chunk' && file.name === 'application' && file.isEntry,
        );
        const html = bundle['index.html'];
        if (!application || application.type !== 'chunk' || !html || html.type !== 'asset')
          return this.error('The offline application entry and public HTML were not built.');
        const installation = {} as NonNullable<ShellManifest['installation']>;
        for (const path of installationPaths) {
          const bytes =
            path === '/manifest.webmanifest'
              ? Buffer.from(JSON.stringify(pwaManifest))
              : await sharp(Buffer.from(iconSvg()))
                  .resize(Number(path.match(/\d+/)![0]))
                  .png()
                  .toBuffer();
          const file = installationAssetName(
            path,
            createHash('sha256').update(bytes).digest('hex'),
            fixtureFormat,
          );
          installation[path] = file;
          this.emitFile({ type: 'asset', fileName: file.slice(1), source: bytes });
        }
        // Stable public URLs resolve to these immutable bytes inside each retained build.
        const files = shellFiles([
          ...new Set([
            ...Object.keys(bundle),
            ...Object.values(installation).map((file) => file.slice(1)),
          ]),
        ]);
        const original =
          typeof html.source === 'string' ? html.source : new TextDecoder().decode(html.source);
        const version = createHash('sha256')
          .update(files.join('\n'))
          .update(JSON.stringify(compatibility))
          .update(original)
          .digest('hex')
          .slice(0, 16);
        const manifest: ShellManifest = {
          protocol: 1,
          version,
          compatibility,
          entry: '/' + application.fileName,
          css: files.filter((file) => file.endsWith('.css')),
          files,
          installation,
        };
        const token = new RegExp(`(["'\`])${SHELL_PLACEHOLDER}\\1`, 'g');
        const found = worker.code.match(token)?.length ?? 0;
        if (found !== 1) return this.error(`Expected one shell manifest token, found ${found}.`);
        worker.code = worker.code.replace(token, JSON.stringify(JSON.stringify(manifest)));
        // Only inert HTML and the stable worker change after hashing. Rewriting a
        // hashed bootstrap chunk would serve different bytes under the same URL.
        html.source = original.replace(
          '</head>',
          `<script id="spinel-runtime" type="application/json">${JSON.stringify(manifest).replaceAll('<', '\\u003c')}</script></head>`,
        );
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // A dedicated emitted-build acceptance fixture declares another format to
  // exercise selection. Normal builds always retain the actual format/SDK.
  const format =
    mode === 'offline-upgrade' ? Number(process.env.SPINEL_TEST_OFFLINE_FORMAT ?? 1) : 1;
  if (![1, 2, 3].includes(format)) throw new Error('Unsupported offline upgrade fixture format.');
  const compatibility = { format, sdkVersion: CURRENT_SDK_VERSION };
  // Each acceptance build declares its actual installed SDK. Distinct namespaces
  // also keep B from serving any unchanged A lazy files, without rewriting bytes
  // after hashing or pretending that the fixture implements a future converter.
  const fixtureSuffix = mode === 'offline-upgrade' ? `-format${format}` : '';
  return {
    root: fileURLToPath(new URL('./web', import.meta.url)),
    plugins: [
      react(),
      offlineShell(compatibility, mode === 'offline-upgrade' ? format : undefined),
    ],
    define: { __SPINEL_RUNTIME_COMPATIBILITY__: JSON.stringify(compatibility) },
    optimizeDeps: { rolldownOptions: { output: rendererOutput } },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      rolldownOptions: {
        input: {
          main: fileURLToPath(new URL('./web/index.html', import.meta.url)),
          application: fileURLToPath(new URL('./web/application.tsx', import.meta.url)),
          'service-worker': fileURLToPath(new URL('./web/service-worker.ts', import.meta.url)),
        },
        output: {
          ...rendererOutput,
          entryFileNames: (chunk) =>
            chunk.name === 'service-worker'
              ? 'service-worker.js'
              : `assets/[name]${fixtureSuffix}-[hash].js`,
          chunkFileNames: `assets/[name]${fixtureSuffix}-[hash].js`,
          assetFileNames: `assets/[name]${fixtureSuffix}-[hash][extname]`,
        },
      },
    },
  };
});
