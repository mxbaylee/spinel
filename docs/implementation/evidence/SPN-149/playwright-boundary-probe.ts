import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('package.json'));
const { server } = require('playwright-core/lib/coreBundle');
const outcomes: object[] = [];
for (const navigationFirst of [false, true]) {
  const context = Object.assign(new EventEmitter(), {
    attribution: {},
    instrumentation: { addListener() {}, removeListener() {} },
    isCreatingStorageStatePage: () => false,
  });
  const page = new server.Page({}, context);
  const manager = page.frameManager;
  let established = 0, closed = 0;
  page.on('websocket', (socket: EventEmitter) => { established++; socket.on('close', () => closed++); });
  manager.onWebSocketCreated('fixture-socket', 'ws://fixture.invalid/sync-api/items/fixture/socket');
  manager.onWebSocketRequest('fixture-socket', { wallTimeMs: 0, headers: {} });
  manager.onWebSocketResponse('fixture-socket', { status: 101, statusText: 'Switching Protocols', headers: {} });
  const clearForMainNavigation = () => manager._clearWebSockets({ parentFrame: () => null });
  if (navigationFirst) clearForMainNavigation();
  manager.webSocketClosed('fixture-socket');
  if (!navigationFirst) clearForMainNavigation();
  assert.equal(established, 1);
  assert.equal(closed, navigationFirst ? 0 : 1);
  outcomes.push({ ordering: navigationFirst ? 'navigation-map-clear then protocol-close' : 'protocol-close then navigation-map-clear', established, pageCloseEvents: closed });
  page.screencast.dispose();
  page.removeAllListeners();
}
console.log(JSON.stringify({ node: process.version, playwright: require('playwright-core/package.json').version, controlledDispatchOnly: true, browserLaunched: false, outcomes }, null, 2));
