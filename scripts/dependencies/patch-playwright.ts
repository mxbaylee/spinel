/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for Spinel: do not pool APIRequestContext HTTP(S) sockets. A stalled
 * server can expire an idle socket before reading a queued request on it.
 * Source: microsoft/playwright v1.64.1, packages/playwright-core/src/server/fetch.ts.
 * Browser networking, application HTTP timeouts and request retries are unchanged.
 */
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const originalHash = '829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d';
const before =
  'agent = protocol === "https:" ? new import_https2.default.Agent({ keepAlive: true }) : new import_http3.default.Agent({ keepAlive: true });';
const after =
  '// Modified for Spinel (SPN-168): API clients use fresh connections; never replay a request.\n          ' +
  before.replaceAll('keepAlive: true', 'keepAlive: false');

export function preparePlaywrightPatch(source: string) {
  const original = source.replace(after, before);
  if (createHash('sha256').update(original).digest('hex') !== originalHash)
    throw new Error('Unrecognized Playwright build; review the API connection patch.');
  if (original.split(before).length !== 2)
    throw new Error('Playwright API agent target must occur exactly once.');
  const patched = original.replace(before, after);
  if (source !== original && source !== patched)
    throw new Error('Partially modified Playwright build; restore the pinned package.');
  return { original, patched };
}

export async function patchInstalledPlaywright(root: string, omitDev = false) {
  const directory = resolve(root, 'node_modules/playwright-core');
  try {
    await access(directory);
  } catch (error) {
    // Production-only installs intentionally omit this development dependency.
    // A present but damaged package, or a missing normal install, must fail.
    if (omitDev && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.version !== '1.64.1')
    throw new Error(
      'Upgrading Playwright: review API connection lifetime before removing this patch.',
    );
  const path = resolve(directory, 'lib/coreBundle.js');
  const source = await readFile(path, 'utf8');
  const { patched } = preparePlaywrightPatch(source);
  if (source !== patched) await writeFile(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await patchInstalledPlaywright(
    resolve(import.meta.dirname, '../..'),
    process.env.NODE_ENV === 'production' ||
      (process.env.npm_config_omit ?? '').split(/\s+/).includes('dev'),
  );
