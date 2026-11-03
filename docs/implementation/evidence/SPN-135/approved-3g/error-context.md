# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: doc-responsiveness.spec.ts >> desktop sustained native typing plain-1
- Location: e2e/doc-responsiveness.spec.ts:318:5

# Error details

```
Error: expect(received).not.toBe(expected) // Object.is equality

Expected: not "Line 1: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 2: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 3: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 4: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 5: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 6: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 7: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 8: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 9: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 10: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 11: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 12: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 13: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 14: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 15: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.Line 16: Read the whole paragraph, including the far right edge. Keep the original page size and all of this text when navigating.·
"
```

# Test source

```ts
  102 |       sourceInstalledAt: value.installedAt,
  103 |       sourceTimeOrigin: value.timeOrigin,
  104 |       dropped: value.dropped,
  105 |       malformed: value.malformed,
  106 |     });
  107 |     for (const event of value.events)
  108 |       reloads.push({
  109 |         ...event,
  110 |         surface,
  111 |         observedAt: event.observedAt + offset,
  112 |         sourceObservedAt: event.observedAt,
  113 |         sourceTimeOrigin: value.timeOrigin,
  114 |       });
  115 |   }
  116 |   return {
  117 |     reloads: reloads.toSorted((a, b) => a.observedAt - b.observedAt),
  118 |     status,
  119 |     origins: { sender: sender.timeOrigin, peer: peer.timeOrigin },
  120 |   };
  121 | }
  122 | 
  123 | function completeReloadObservation(value: Awaited<ReturnType<typeof readReloads>>) {
  124 |   for (const status of value.status) {
  125 |     expect(status.dropped).toBe(0);
  126 |     expect(status.malformed).toBe(0);
  127 |   }
  128 | }
  129 | 
  130 | async function integrity(f: DocFixture, origins: ClockOrigins): Promise<DocIntegritySnapshot> {
  131 |   const [sender, peer, stored] = await Promise.all([
  132 |     readDocResponsiveness(f.page, true),
  133 |     readDocResponsiveness(f.other, true),
  134 |     f.readState(),
  135 |   ]);
  136 |   const native = (value: DocResponsivenessEvidence | null, offset: number): DocNativeIntegrity => {
  137 |     expect(value).not.toBeNull();
  138 |     expect(typeof value!.text).toBe('string');
  139 |     return {
  140 |       unitId: value!.unitId,
  141 |       observedAt: value!.observedAt + offset,
  142 |       ...fingerprint(value!.text!),
  143 |       selection: value!.selection,
  144 |       history: value!.history,
  145 |       pending: value!.pending,
  146 |       highWater: value!.highWater,
  147 |     };
  148 |   };
  149 |   expect(Number.isSafeInteger(stored.revision)).toBe(true);
  150 |   return {
  151 |     observedAt: await now(f.page),
  152 |     sender: native(sender, 0),
  153 |     peer: native(peer, origins.peer - origins.sender),
  154 |     saved: { revision: stored.revision, ...fingerprint(stored.snapshot.body!.dataStream) },
  155 |   };
  156 | }
  157 | 
  158 | function exactIntegrity(value: DocIntegritySnapshot, text: string, selection: number) {
  159 |   const expected = fingerprint(text);
  160 |   for (const current of [value.sender, value.peer, value.saved])
  161 |     expect(current).toMatchObject(expected);
  162 |   expect(value.sender.unitId).toBe(value.peer.unitId);
  163 |   expect(value.sender.selection).toMatchObject({ start: selection, end: selection });
  164 |   expect(value.peer.selection).toMatchObject({ start: 0, end: 0 });
  165 |   expect(value.sender.pending).toEqual({ history: 0, collaboration: 0 });
  166 |   expect(value.peer.pending).toEqual({ history: 0, collaboration: 0 });
  167 | }
  168 | 
  169 | async function converge(f: DocFixture, text: string, origins: ClockOrigins) {
  170 |   await saved(f.page);
  171 |   await exactText(f.page, text);
  172 |   await exactText(f.other, text);
  173 |   await expect.poll(async () => (await f.read()).body!.dataStream, { timeout: 30_000 }).toBe(text);
  174 |   const value = await integrity(f, origins);
  175 |   exactIntegrity(value, text, text.length - 2);
  176 |   return value;
  177 | }
  178 | 
  179 | async function verifyUndoRedo(
  180 |   f: DocFixture,
  181 |   initial: DocPreUndoIntegrity,
  182 |   all: boolean,
  183 |   observers: ReloadObservers,
  184 |   origins: ClockOrigins,
  185 |   progress: Record<string, unknown>,
  186 | ): Promise<DocUndoRedoEvidence> {
  187 |   const groups = all ? initial.sender.history.undos : 1;
  188 |   expect(groups).toBeGreaterThan(0);
  189 |   expect(initial.sender.history.undos).toBeLessThanOrEqual(
  190 |     baseline
  191 |       ? DOC_RESPONSIVENESS_BASELINE_HISTORY_LIMIT
  192 |       : DOC_RESPONSIVENESS_CANDIDATE_HISTORY_LIMIT,
  193 |   );
  194 |   expect(initial.sender.history.redos).toBe(0);
  195 |   progress.requestedGroups = groups;
  196 |   progress.phase = 'before-undo';
  197 |   const beforeUndoAt = await now(f.page);
  198 |   progress.beforeUndoAt = beforeUndoAt;
  199 |   await f.page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  200 |   await saved(f.page);
  201 |   const undone = (await readDocResponsiveness(f.page, true))!;
> 202 |   expect(undone.text).not.toBe(expectedText);
      |                           ^ Error: expect(received).not.toBe(expected) // Object.is equality
  203 |   expect(undone.text!.endsWith('\r\n')).toBe(true);
  204 |   expect(expectedText.startsWith(undone.text!.slice(0, -2))).toBe(true);
  205 |   expect(undone.selection).toMatchObject({
  206 |     start: undone.text!.length - 2,
  207 |     end: undone.text!.length - 2,
  208 |   });
  209 |   const firstUndo = await converge(f, undone.text!, origins);
  210 |   expect(firstUndo.sender.history).toEqual({
  211 |     undos: initial.sender.history.undos - 1,
  212 |     redos: 1,
  213 |   });
  214 |   progress.firstUndo = firstUndo;
  215 |   for (let group = 1; group < groups; group++) await f.page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  216 |   await saved(f.page);
  217 |   let undo = firstUndo;
  218 |   if (all) {
  219 |     undo = await converge(f, '\r\n', origins);
  220 |     expect((await readDocResponsiveness(f.page))?.selection).toMatchObject({ start: 0, end: 0 });
  221 |   }
  222 |   expect(undo.sender.history).toEqual({
  223 |     undos: initial.sender.history.undos - groups,
  224 |     redos: groups,
  225 |   });
  226 |   progress.undo = undo;
  227 |   const afterUndoAt = await now(f.page);
  228 |   progress.afterUndoAt = afterUndoAt;
  229 |   const beforeRedoReloads = await readReloads(observers);
  230 |   completeReloadObservation(beforeRedoReloads);
  231 |   expect(beforeRedoReloads.reloads).toEqual([]);
  232 |   progress.phase = 'redo';
  233 |   const beforeRedoAt = await now(f.page);
  234 |   progress.beforeRedoAt = beforeRedoAt;
  235 |   // Pinned Univer's full-document SharedController binds Ctrl+Y off macOS;
  236 |   // the Shift+Z alternative is registered only for macOS.
  237 |   for (let group = 0; group < groups; group++) await f.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  238 |   // Observe a concrete outcome. A timeout or generic assertion error can never
  239 |   // select the documented baseline-only capacity-refusal branch.
  240 |   await expect
  241 |     .poll(
  242 |       async () => {
  243 |         const reloads = await readReloads(observers);
  244 |         completeReloadObservation(reloads);
  245 |         progress.reloads = reloads.reloads;
  246 |         if (reloads.reloads.length) return 'reload';
  247 |         const [sender, peer, stored] = await Promise.all([
  248 |           readDocResponsiveness(f.page, true),
  249 |           readDocResponsiveness(f.other, true),
  250 |           f.read(),
  251 |         ]);
  252 |         return sender?.text === expectedText &&
  253 |           sender.history.redos === 0 &&
  254 |           peer?.text === expectedText &&
  255 |           stored.body!.dataStream === expectedText
  256 |           ? 'converged'
  257 |           : 'pending';
  258 |       },
  259 |       { timeout: 30_000 },
  260 |     )
  261 |     .not.toBe('pending');
  262 |   const afterRedoAt = await now(f.page);
  263 |   progress.afterRedoAt = afterRedoAt;
  264 |   const observed = await readReloads(observers);
  265 |   completeReloadObservation(observed);
  266 |   let outcome: DocUndoRedoEvidence['outcome'] = 'passed';
  267 |   let final: DocIntegritySnapshot;
  268 |   if (observed.reloads.length) {
  269 |     expect(baseline, 'Candidate history must never reload or refuse an edit').toBe(true);
  270 |     expect(groups).toBe(1);
  271 |     expect(initial.sender.history.undos).toBe(1);
  272 |     expect(observed.reloads).toHaveLength(1);
  273 |     const [event] = observed.reloads;
  274 |     expect(event).toMatchObject({
  275 |       surface: 'sender',
  276 |       unitId: initial.sender.unitId,
  277 |       reason: 'capacity',
  278 |       clean: false,
  279 |     });
  280 |     expect(event!.observedAt).toBeGreaterThanOrEqual(beforeRedoAt);
  281 |     expect(event!.observedAt).toBeLessThanOrEqual(afterRedoAt);
  282 |     exactIntegrity(undo, '\r\n', 0);
  283 |     expect(undo.sender.history).toEqual({ undos: 0, redos: 1 });
  284 |     progress.phase = 'baseline-capacity-recovery';
  285 |     final = await converge(f, '\r\n', origins);
  286 |     expect(final.saved.revision).toBe(undo.saved.revision);
  287 |     expect(final.sender.history).toEqual({ undos: 0, redos: 0 });
  288 |     expect(final.sender.highWater).toEqual({ history: 0, collaboration: 0 });
  289 |     outcome = 'baseline-capacity-refusal';
  290 |   } else {
  291 |     final = await converge(f, expectedText, origins);
  292 |     expect(final.sender.history).toEqual({ undos: initial.sender.history.undos, redos: 0 });
  293 |   }
  294 |   progress.final = final;
  295 |   const last = await readReloads(observers);
  296 |   completeReloadObservation(last);
  297 |   expect(last.reloads).toEqual(observed.reloads);
  298 |   const result: DocUndoRedoEvidence = {
  299 |     outcome,
  300 |     requestedGroups: groups,
  301 |     beforeUndoAt,
  302 |     afterUndoAt,
```