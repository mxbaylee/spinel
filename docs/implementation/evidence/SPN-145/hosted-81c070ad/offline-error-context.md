# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: offline-upgrade.spec.ts >> an interrupted real legacy preparation releases its worker before replacement activation
- Location: e2e/offline-upgrade.spec.ts:241:1

# Error details

```
AggregateError: Emitted worker lifetime control failed.
```

```
AssertionError: Expected values to be strictly equal:

true !== false

```

# Test source

```ts
  102 |         const request = forward(incoming, outgoing, backend);
  103 |         if (incoming.url === target) {
  104 |           downstream = outgoing;
  105 |           request.once('response', (response) => {
  106 |             response.once('data', () => partial.resolve());
  107 |             response.once('aborted', () => {
  108 |               emit('upstream-body-aborted');
  109 |               aborted.resolve();
  110 |             });
  111 |           });
  112 |           outgoing.once('close', () => emit('downstream-closed'));
  113 |         }
  114 |       }),
  115 |     );
  116 |     for (const [label, source] of [
  117 |       ['legacy', legacyDirectory],
  118 |       ['replacement', replacementDirectory],
  119 |     ] as const)
  120 |       emit('emitted-worker', {
  121 |         label,
  122 |         sha256: createHash('sha256')
  123 |           .update(await readFile(join(source, 'service-worker.js')))
  124 |           .digest('hex'),
  125 |       });
  126 |     emit('browser', { version: browser.version() });
  127 |     await page.goto(`http://127.0.0.1:${proxy}/lifetime-control`);
  128 |     await page.evaluate(() =>
  129 |       navigator.serviceWorker.register('/service-worker.js', { type: 'module' }),
  130 |     );
  131 |     await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  132 |     await page.evaluate((type) => {
  133 |       const observation = {
  134 |         original: navigator.serviceWorker.controller,
  135 |         result: null as null | { ok: boolean; error?: string },
  136 |       };
  137 |       const channel = new MessageChannel();
  138 |       Object.assign(window, { spinelPreparationControl: observation });
  139 |       channel.port1.onmessage = (event) => {
  140 |         observation.result = event.data;
  141 |         channel.port1.close();
  142 |       };
  143 |       observation.original!.postMessage({ type }, [channel.port2]);
  144 |     }, PREPARE_SHELL);
  145 |     await within(partial.promise, 5000, 'The actual legacy preparation did not request its asset.');
  146 |     directory = replacementDirectory;
  147 |     await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
  148 |     await page.waitForFunction(
  149 |       async () => (await navigator.serviceWorker.ready).waiting?.state === 'installed',
  150 |     );
  151 |     const state = () =>
  152 |       page.evaluate(async () => {
  153 |         const registration = await navigator.serviceWorker.ready;
  154 |         const observation = (
  155 |           window as Window & {
  156 |             spinelPreparationControl?: { original: ServiceWorker; result: unknown };
  157 |           }
  158 |         ).spinelPreparationControl!;
  159 |         return {
  160 |           active: registration.active?.state,
  161 |           activeIsOriginal: registration.active === observation.original,
  162 |           original: observation.original.state,
  163 |           waiting: registration.waiting?.state,
  164 |           preparation: observation.result,
  165 |         };
  166 |       });
  167 |     emit('replacement-waiting', await state());
  168 |     assert.ok(body && downstream);
  169 |     assert.equal((await state()).preparation, null);
  170 |     const closed = new Promise<void>((resolve) => downstream!.once('close', () => resolve()));
  171 |     body.destroy();
  172 |     emit('interrupt-upstream-body');
  173 |     await within(aborted.promise, 1000, 'The upstream response did not report its interruption.');
  174 |     if (mode === 'original') {
  175 |       const message = 'Original proxy retained its downstream response after upstream abort.';
  176 |       await assert.rejects(within(closed, 1000, message), { message });
  177 |       const blocked = await state();
  178 |       assert.equal(downstream.destroyed, false);
  179 |       assert.equal(blocked.preparation, null);
  180 |       assert.equal(blocked.waiting, 'installed');
  181 |       assert.equal(blocked.activeIsOriginal, true);
  182 |       emit('original-obstruction-confirmed', blocked);
  183 |       // Release this exact leaked HTTP owner, keeping the old page/worker alive.
  184 |       // No injected waitUntil, unregister, navigation, cache deletion or retry.
  185 |       downstream.destroy();
  186 |       emit('release-original-response');
  187 |     }
  188 |     await within(closed, 1000, 'Interrupted response remained open.');
  189 |     await page.waitForFunction(() =>
  190 |       Boolean(
  191 |         (window as Window & { spinelPreparationControl?: { result: unknown } })
  192 |           .spinelPreparationControl?.result,
  193 |       ),
  194 |     );
  195 |     const settled = await state();
  196 |     assert.equal((settled.preparation as { ok: boolean }).ok, false);
  197 |     await page.waitForFunction(async () => {
  198 |       const registration = await navigator.serviceWorker.ready;
  199 |       return !registration.waiting && registration.active?.state === 'activated';
  200 |     });
  201 |     const activated = await state();
> 202 |     assert.equal(activated.activeIsOriginal, false);
      |            ^ AssertionError: Expected values to be strictly equal:
  203 |     assert.equal(activated.original, 'redundant');
  204 |     emit('replacement-activated', activated);
  205 |   } catch (error) {
  206 |     failure = error;
  207 |     emit('first-failure', { error: String(error), downstreamClosed: downstream?.destroyed });
  208 |   } finally {
  209 |     try {
  210 |       await within(context.close(), 5000, 'Owned browser context did not close.');
  211 |     } catch (error) {
  212 |       cleanupFailures.push(error);
  213 |     }
  214 |     for (const socket of sockets) socket.destroy();
  215 |     for (const server of servers.filter((server) => server.listening))
  216 |       try {
  217 |         await within(
  218 |           new Promise<void>((resolve, reject) =>
  219 |             server.close((error) => (error ? reject(error) : resolve())),
  220 |           ),
  221 |           5000,
  222 |           'Owned HTTP server did not close.',
  223 |         );
  224 |       } catch (error) {
  225 |         cleanupFailures.push(error);
  226 |       }
  227 |     emit('cleanup-complete', { failures: cleanupFailures.map(String) });
  228 |   }
  229 |   if (failure || cleanupFailures.length)
  230 |     throw new AggregateError(
  231 |       [...(failure ? [failure] : []), ...cleanupFailures],
  232 |       'Emitted worker lifetime control failed.',
  233 |     );
  234 | }
  235 | 
```