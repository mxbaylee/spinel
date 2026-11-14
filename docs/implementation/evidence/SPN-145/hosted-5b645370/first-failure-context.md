# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: offline-upgrade.spec.ts >> the actual SPN-054 eager client keeps its pending Doc and lazy files during new-host adoption
- Location: e2e/offline-upgrade.spec.ts:283:1

# Error details

```
AggregateError: Offline-upgrade failed; original failure is first.
```

```
Error: Chromium has no ServiceWorker trace category.
```

```
Error: Offline-upgrade worker diagnostics are incomplete.
```

# Test source

```ts
  116 |   let droppedRequests = 0;
  117 |   let droppedPhases = 0;
  118 |   let truncatedPaths = 0;
  119 |   let maximumBufferUse = 0;
  120 |   let started = false;
  121 |   let terminal: { dataLossOccurred: boolean } | undefined;
  122 |   const cdp = await browser.newBrowserCDPSession();
  123 |   const completed = Promise.withResolvers<void>();
  124 |   const collected = ({ value }: { value: unknown }) => trace.append(value);
  125 |   const bufferUsage = (event: { percentFull?: number; value?: number }) => {
  126 |     maximumBufferUse = Math.max(maximumBufferUse, event.percentFull ?? event.value ?? 0);
  127 |   };
  128 |   const complete = (event: { dataLossOccurred: boolean }) => {
  129 |     terminal = event;
  130 |     completed.resolve();
  131 |   };
  132 |   const safePath = (url: string) => {
  133 |     const value = new URL(url);
  134 |     const path = value.origin + value.pathname;
  135 |     if (path.length > 2048) truncatedPaths++;
  136 |     return path.slice(0, 2048);
  137 |   };
  138 |   const requested = (request: Request) => {
  139 |     const worker = request.serviceWorker();
  140 |     if (!worker) return;
  141 |     if (requests.length === requestLimit) {
  142 |       droppedRequests++;
  143 |       return;
  144 |     }
  145 |     const entry = {
  146 |       id: requests.length + 1,
  147 |       method: request.method(),
  148 |       path: safePath(request.url()),
  149 |       worker: safePath(worker.url()),
  150 |       startedMs: elapsedMs(),
  151 |       terminal: null,
  152 |     };
  153 |     requests.push(entry);
  154 |     pending.set(request, entry);
  155 |   };
  156 |   const finished = (request: Request) => {
  157 |     const entry = pending.get(request);
  158 |     if (entry) {
  159 |       entry.terminal = { outcome: 'finished', elapsedMs: elapsedMs() };
  160 |       pending.delete(request);
  161 |     }
  162 |   };
  163 |   const failed = (request: Request) => {
  164 |     const entry = pending.get(request);
  165 |     if (entry) {
  166 |       entry.terminal = {
  167 |         outcome: 'failed',
  168 |         elapsedMs: elapsedMs(),
  169 |         error: request.failure()?.errorText.slice(0, 512) ?? 'Unknown network failure',
  170 |       };
  171 |       pending.delete(request);
  172 |     }
  173 |   };
  174 |   cdp.on('Tracing.dataCollected', collected);
  175 |   cdp.on('Tracing.bufferUsage', bufferUsage);
  176 |   cdp.on('Tracing.tracingComplete', complete);
  177 |   context.on('request', requested);
  178 |   context.on('requestfinished', finished);
  179 |   context.on('requestfailed', failed);
  180 |   let finalizing: Promise<void> | undefined;
  181 |   function finish(firstFailure?: unknown) {
  182 |     return (finalizing ??= (async () => {
  183 |       const failures: unknown[] = firstFailure === undefined ? [] : [firstFailure];
  184 |       const deadline = Date.now() + collectionMs;
  185 |       context.off('request', requested);
  186 |       context.off('requestfinished', finished);
  187 |       context.off('requestfailed', failed);
  188 |       try {
  189 |         if (started)
  190 |           await before(
  191 |             Promise.all([cdp.send('Tracing.end'), completed.promise]),
  192 |             deadline,
  193 |             'Worker trace',
  194 |           );
  195 |       } catch (error) {
  196 |         failures.push(error);
  197 |       } finally {
  198 |         cdp.off('Tracing.dataCollected', collected);
  199 |         cdp.off('Tracing.bufferUsage', bufferUsage);
  200 |         cdp.off('Tracing.tracingComplete', complete);
  201 |         try {
  202 |           await before(cdp.detach(), deadline, 'Worker trace session cleanup');
  203 |         } catch (error) {
  204 |           failures.push(error);
  205 |         }
  206 |       }
  207 |       const captured = trace.result(terminal);
  208 |       const completeEvidence =
  209 |         started &&
  210 |         captured.complete &&
  211 |         maximumBufferUse < 1 &&
  212 |         !droppedRequests &&
  213 |         !droppedPhases &&
  214 |         !truncatedPaths;
  215 |       if (!completeEvidence)
> 216 |         failures.push(new Error('Offline-upgrade worker diagnostics are incomplete.'));
      |                       ^ Error: Offline-upgrade worker diagnostics are incomplete.
  217 |       const receipt = {
  218 |         schema: 1,
  219 |         startedAt,
  220 |         finishedAt: new Date().toISOString(),
  221 |         browser: browser.version(),
  222 |         identities,
  223 |         test: { id: info.testId, project: info.project.name, retry: info.retry },
  224 |         complete: completeEvidence && failures.length === (firstFailure === undefined ? 0 : 1),
  225 |         firstFailure: firstFailure === undefined ? null : String(firstFailure),
  226 |         collectionFailures: failures.slice(firstFailure === undefined ? 0 : 1).map(String),
  227 |         limits: { requests: requestLimit, phases: phaseLimit, collectionMs, persistenceMs },
  228 |         trace: captured,
  229 |         maximumBufferUse,
  230 |         phases,
  231 |         requests,
  232 |         droppedRequests,
  233 |         droppedPhases,
  234 |         truncatedPaths,
  235 |         pendingRequestsAtStop: [...pending.values()].map((request) => request.id),
  236 |         limitation:
  237 |           'Worker HTTP requests and raw ServiceWorker trace events are separate observations. ' +
  238 |           'No JavaScript promise ledger or historical-cause attribution is inferred; clocks are not aligned. ' +
  239 |           'Passive request records omit headers, cookies, bodies and URL queries. ' +
  240 |           'Raw browser trace arguments may contain synthetic fixture URLs.',
  241 |       };
  242 |       try {
  243 |         await writeFile(
  244 |           info.outputPath('spn-055-worker-lifecycle.json'),
  245 |           JSON.stringify(receipt, null, 2) + '\n',
  246 |           {
  247 |             signal: AbortSignal.timeout(persistenceMs),
  248 |           },
  249 |         );
  250 |       } catch (error) {
  251 |         failures.push(error);
  252 |       }
  253 |       pending.clear();
  254 |       if (failures.length === 1) throw failures[0];
  255 |       if (failures.length)
  256 |         throw new AggregateError(failures, 'Offline-upgrade failed; original failure is first.');
  257 |     })());
  258 |   }
  259 |   try {
  260 |     const deadline = Date.now() + collectionMs;
  261 |     const categories = await before(
  262 |       cdp.send('Tracing.getCategories'),
  263 |       deadline,
  264 |       'Worker trace categories',
  265 |     );
  266 |     if (!categories.categories.includes('ServiceWorker'))
  267 |       throw new Error('Chromium has no ServiceWorker trace category.');
  268 |     // Set before sending: a command timing out may still have started the trace.
  269 |     started = true;
  270 |     await before(
  271 |       cdp.send('Tracing.start', {
  272 |         transferMode: 'ReportEvents',
  273 |         bufferUsageReportingInterval: 1000,
  274 |         traceConfig: {
  275 |           recordMode: 'recordUntilFull',
  276 |           traceBufferSizeInKb: traceLimits.bytes / 1024,
  277 |           includedCategories: ['ServiceWorker'],
  278 |         },
  279 |       }),
  280 |       deadline,
  281 |       'Worker trace start',
  282 |     );
  283 |   } catch (error) {
  284 |     await finish(error);
  285 |     throw error;
  286 |   }
  287 |   return {
  288 |     mark(phase: string) {
  289 |       if (phases.length < phaseLimit)
  290 |         phases.push({ phase: phase.slice(0, 100), elapsedMs: elapsedMs() });
  291 |       else droppedPhases++;
  292 |     },
  293 |     finish,
  294 |   };
  295 | }
  296 | 
```