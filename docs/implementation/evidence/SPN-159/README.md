# 🔬 Native drawing transition evidence

The two `controls-*.json` files are first-attempt counterfactual observations,
not successful product acceptance. `controls-narrow.json` shows an incorrect
narrow acceptance followed by an expected restore failure. `controls-restore.json`
shows a complete false positive at the narrowed width. The source/runtime and
limits are in [the implementation record](../../SPN-159.md). The historical
SPN-120 assertion and cause remain unknown.

## 🧪 Reproduce the bounded probe

Use the recorded source and matching installed dependencies. The preserved
`experiment.ts` is the exact probe used for the original controls, including
its fixed sample count, 1280×900 light contexts and 60-second outer deadline.
`controls` is meaningful against diagnostic source `f0cb3d401b82762428f668557f9b44f7bdf341d3`;
`corrected` runs one unintercepted sample against the corrected story. Keep the
single-workload memory watchdog and original story assertion budgets.

Create a task-owned `test-results/spn159/storybook/main.ts`:

```ts
import base from '../../../.storybook/main.ts';
import { resolve } from 'node:path';
export default {
  ...base,
  stories: ['../../../web/SyncNative.stories.tsx'],
  async viteFinal(config, options) {
    const result = await base.viteFinal!(config, options);
    result.cacheDir = resolve('test-results/spn159/vite-cache');
    return result;
  },
};
```

Its `preview.tsx` reexports the existing theme and decorators:

```ts
export { default } from '../../../.storybook/preview.tsx';
```

Build with the installed `node_modules/.bin/storybook build --config-dir
test-results/spn159/storybook --output-dir test-results/spn159/static`, using the
existing `.storybook/typescript-api.ts` import and a task-private `CACHE_DIR`.
Stop the build before running `node docs/implementation/evidence/SPN-159/experiment.ts
controls` (or `corrected`). Preserve the exact checked-out source, static asset
hashes and resulting JSON before any rebuild. The focused config selects the
existing native story only; hosted compatibility still owns all five variants.

## 🧹 Failure and cleanup records

Setup logs preserve the missing CLI entry, duplicate executable argument and
pressure preflight refusal; none executed a native sample. The watchdog JSON records the successful
diagnostic build/controls, 15 passing focused unit tests and resource-aborted
full typecheck and corrected static build. Neither resource abort is a pass. The
one corrected browser sample never ran. Owned processes and port
6019 were checked after the stopped batch, with no survivors. All fixture content
is synthetic; diagnostics contain command IDs, bounded geometry and event order.
