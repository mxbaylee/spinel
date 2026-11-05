
import { test } from "/Users/mxbaylee/projects/spinel/node_modules/@playwright/test/index.js";
import { createRequire } from 'node:module';
import { writeFileSync, renameSync, existsSync, realpathSync } from 'node:fs';
const require = createRequire("/Users/mxbaylee/projects/spinel/node_modules/@playwright/test/package.json");
test.afterEach(async ({}, info) => {
  writeFileSync('settled.json', JSON.stringify({ title: info.title, status: info.status, retry: info.retry, workerIndex: info.workerIndex }));
});
test('same launcher barrier', async ({}, info) => {
  writeFileSync('ready.json.tmp', JSON.stringify({ pid: process.pid, parent: process.ppid, node: process.version, execPath: process.execPath, title: info.title, retry: info.retry, workerIndex: info.workerIndex, program: realpathSync(require.resolve('playwright/lib/program')), modules: Object.keys(require.cache).filter(p => p.includes('/node_modules/')).sort(), npmEnvironmentKeys: Object.keys(process.env).filter(k => /^(npm_|INIT_CWD|PATH$)/.test(k)).sort(), nodeOptions: process.env.NODE_OPTIONS ?? null }));
  renameSync('ready.json.tmp', 'ready.json');
  while (!existsSync('release')) await new Promise(resolve => setTimeout(resolve, 10));
});
