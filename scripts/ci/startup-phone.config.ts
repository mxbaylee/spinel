// Explicit diagnostic build only; normal vite.config.ts never imports this file.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import type { UserConfigFn } from 'vite';
import base from '../../vite.config.ts';
import { instrumentPhoneSource } from './startup-phone-instrumentation.ts';

export default defineConfig(async (env) => {
  const output = process.env.SPINEL_PHONE_DIST;
  if (!output || !output.startsWith('/'))
    throw new Error('SPINEL_PHONE_DIST must be an absolute disposable path.');
  const web = fileURLToPath(new URL('../../web/', import.meta.url));
  const observer = fileURLToPath(new URL('./startup-phone-observer.ts', import.meta.url));
  return mergeConfig(await (base as UserConfigFn)(env), {
    plugins: [
      {
        name: 'spn164-phone-observation',
        enforce: 'pre',
        transform(source: string, id: string) {
          if (!['startupStage.ts', 'api.ts', 'App.tsx'].some((file) => id === resolve(web, file)))
            return null;
          return instrumentPhoneSource(source, id.slice(web.length), observer);
        },
      },
    ],
    build: { outDir: output, emptyOutDir: false },
  });
});
