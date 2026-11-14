import assert from 'node:assert/strict';
import test from 'node:test';
import {
  heapSampleMode,
  summarizeSamplingProfile,
} from '../../e2e/doc-responsiveness-heap-sample.ts';

const node = (functionName: string, url: string, selfSize: number, children: any[] = []) => ({
  callFrame: { functionName, url, lineNumber: 1, columnNumber: 0 },
  selfSize,
  children,
});

test('allocation sites are summed across call paths, with scripts and the heaviest caller chain', () => {
  const profile = {
    head: node('(root)', '', 0, [
      node('flush', 'https://x/model.js', 0, [
        node('deepClone', 'https://x/model.js', 300, [node('copy', 'https://x/model.js', 50)]),
      ]),
      node('type', 'https://x/editor.js', 0, [node('deepClone', 'https://x/model.js', 100)]),
    ]),
  };
  const summary = summarizeSamplingProfile(profile);
  assert.equal(summary.totalBytes, 450);
  assert.deepEqual(summary.topSites[0], {
    site: 'deepClone model.js:1',
    bytes: 400,
    caller: 'flush model.js:1 < (root) :1',
  });
  assert.deepEqual(summary.topScripts[0], { script: 'model.js', bytes: 450 });
});

test('only the all and live modes enable sampling', () => {
  assert.equal(heapSampleMode('all'), 'all');
  assert.equal(heapSampleMode('live'), 'live');
  assert.equal(heapSampleMode('1'), null);
  assert.equal(heapSampleMode(undefined), null);
});
