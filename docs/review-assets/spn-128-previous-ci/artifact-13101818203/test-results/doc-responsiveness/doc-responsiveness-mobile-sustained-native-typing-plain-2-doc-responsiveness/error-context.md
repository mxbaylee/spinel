# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: doc-responsiveness.spec.ts >> mobile sustained native typing plain-2
- Location: e2e/doc-responsiveness.spec.ts:315:5

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 100
Received:    116.29999999981374
```

# Test source

```ts
  613 |           .toBe(expectedText);
  614 |         evidence.convergenceObservationMs = performance.now() - savedStarted;
  615 |         expect(native.selection).toMatchObject({
  616 |           start: expectedInputCount,
  617 |           end: expectedInputCount,
  618 |         });
  619 |         expect((await readDocResponsiveness(f.other))?.selection).toMatchObject({
  620 |           start: 0,
  621 |           end: 0,
  622 |         });
  623 |         const initial = await integrity(f, clockOrigins);
  624 |         exactIntegrity(initial, expectedText, expectedInputCount);
  625 |         expect(initial.sender.history).toEqual(native.history);
  626 |         const initialReloads = await readReloads(reloadObservers);
  627 |         completeReloadObservation(initialReloads);
  628 |         expect(initialReloads.reloads).toEqual([]);
  629 |         const preUndoIntegrity: DocPreUndoIntegrity = {
  630 |           ...initial,
  631 |           passed: true,
  632 |           reloads: initialReloads.reloads,
  633 |         };
  634 |         evidence.preUndoIntegrity = preUndoIntegrity;
  635 |         const sealedNative = await readDocResponsiveness(f.page, false, {
  636 |           action: 'seal',
  637 |           epoch: drainArm!.epoch,
  638 |           generation: drainArm!.generation,
  639 |           unitId: drainArm!.unitId,
  640 |           timeOrigin: drainArm!.timeOrigin,
  641 |         });
  642 |         const drainWitness = sealedNative?.drainWitness as DocDrainWitness | null | undefined;
  643 |         evidence.drainWitness = drainWitness;
  644 |         expect(drainWitness).toBeTruthy();
  645 |         expect(drainWitness!.invalidated).toBe(false);
  646 |         expect(drainWitness!.invalidations).toEqual([]);
  647 |         expect(drainWitness!.epoch).toBe(drainArm!.epoch);
  648 |         expect(drainWitness!.generation).toBe(drainArm!.generation);
  649 |         expect(drainWitness!.unitId).toBe(native.unitId);
  650 |         expect(drainWitness!.timeOrigin).toBe(input.timeOrigin);
  651 |         expect(drainWitness!.expectedCompletedStates).toBe(expectedInputCount);
  652 |         expect(drainWitness!.completedStates).toBe(expectedInputCount);
  653 |         expect(drainWitness!.lastCompletedStateAt!).toBeGreaterThanOrEqual(input.keydownAt.at(-1)!);
  654 |         expect(drainWitness!.firstEmpty).toBeTruthy();
  655 |         expect(drainWitness!.firstEmpty).toEqual(native.drainWitness?.firstEmpty);
  656 |         expect(drainWitness!.firstEmpty!.observedAt).toBeGreaterThanOrEqual(
  657 |           drainWitness!.lastCompletedStateAt!,
  658 |         );
  659 |         expect(drainWitness!.firstEmpty!.pending).toEqual({ history: 0, collaboration: 0 });
  660 |         expect(drainWitness!.firstEmpty!.history).toEqual(native.history);
  661 |         expect(drainWitness!.firstEmpty!.highWater).toEqual(native.highWater);
  662 |         expect(drainWitness!.sealedAt!).toBeGreaterThanOrEqual(preUndoIntegrity.observedAt);
  663 |         const historyProgress: Record<string, unknown> = { phase: 'not-started' };
  664 |         evidence.undoRedoObservation = historyProgress;
  665 |         const undoRedo = await verifyUndoRedo(
  666 |           f,
  667 |           preUndoIntegrity,
  668 |           sample === 'plain-1',
  669 |           reloadObservers,
  670 |           clockOrigins,
  671 |           historyProgress,
  672 |         );
  673 |         evidence.undoRedo = undoRedo;
  674 |         expect(drainWitness!.sealedAt!).toBeLessThanOrEqual(undoRedo.beforeUndoAt);
  675 |         await expect
  676 |           .poll(async () => (await f.read()).body!.dataStream)
  677 |           .toBe(undoRedo.outcome === 'passed' ? expectedText : '\r\n');
  678 |         await Promise.all([online(f.page), online(f.other)]);
  679 |         expect(f.errors).toEqual([]);
  680 |         expect(input.keydownAt).toHaveLength(expectedInputCount);
  681 |         expect(input.keyToFrameMs).toHaveLength(expectedInputCount);
  682 |         evidence.correctness =
  683 |           undoRedo.outcome === 'passed'
  684 |             ? 'exact saved/live peer text, sender/peer selections, undo/redo and Online passed'
  685 |             : 'baseline redo refused at capacity; exact prior typing and Undo verified; recovered saved empty state';
  686 |         // Schema 4 retains the strict baseline history outcome and separately
  687 |         // observes capacity/idle work. Drain acceptance now uses the preregistered
  688 |         // browser-local witness; the unchanged late-read scalar remains descriptive.
  689 |         if (!baseline) {
  690 |           expect(native.highWater.history).toBeLessThanOrEqual(DOC_RESPONSIVENESS_GROUP_LIMIT);
  691 |           expect(native.highWater.collaboration).toBeLessThanOrEqual(
  692 |             DOC_RESPONSIVENESS_GROUP_LIMIT,
  693 |           );
  694 |           expect(capacityFlushes.length).toBeGreaterThan(0);
  695 |           for (const entry of native.flushes) {
  696 |             expect(['capacity', 'idle']).toContain(entry.reason);
  697 |             expect(Number.isInteger(entry.history) && entry.history >= 0).toBe(true);
  698 |             expect(Number.isInteger(entry.collaboration) && entry.collaboration >= 0).toBe(true);
  699 |             const pending = Math.max(entry.history, entry.collaboration);
  700 |             expect(pending).toBeGreaterThan(0);
  701 |             expect(pending).toBeLessThanOrEqual(DOC_RESPONSIVENESS_GROUP_LIMIT);
  702 |             if (entry.reason === 'capacity') expect(pending).toBe(DOC_RESPONSIVENESS_GROUP_LIMIT);
  703 |             if (entry.reason === 'idle') {
  704 |               expect(Number.isFinite(entry.quietForMs)).toBe(true);
  705 |               expect(entry.quietForMs!).toBeGreaterThanOrEqual(300);
  706 |             }
  707 |           }
  708 |           if (!profiled) {
  709 |             expect(frame.p95).toBeLessThanOrEqual(budgets[preset].inputP95Ms);
  710 |             expect(longTasks.max).toBeLessThanOrEqual(budgets[preset].longTaskMaxMs);
  711 |             // Idle samples must never dilute the registered capacity distribution.
  712 |             expect(capacityFlush!.p95).toBeLessThanOrEqual(budgets[preset].flushP95Ms);
> 713 |             expect(capacityFlush!.max).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
      |                                        ^ Error: expect(received).toBeLessThanOrEqual(expected)
  714 |             if (idleFlush) {
  715 |               expect(idleFlush.p95).toBeLessThanOrEqual(budgets[preset].flushP95Ms);
  716 |               expect(idleFlush.max).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
  717 |             }
  718 |             expect(flushMaximum!).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
  719 |             expect(localDrainMs).not.toBeNull();
  720 |             expect(localDrainMs!).toBeLessThanOrEqual(1000);
  721 |           }
  722 |         }
  723 |         const finalReloads = await readReloads(reloadObservers);
  724 |         completeReloadObservation(finalReloads);
  725 |         expect(finalReloads.reloads).toEqual(undoRedo.reloads);
  726 |         evidence.reloadObservers = finalReloads.status;
  727 |         evidence.completed = true;
  728 |       } finally {
  729 |         if (finishInput)
  730 |           evidence.partialInput = await finishInput().catch((error) => ({ error: String(error) }));
  731 |         if (profiling) {
  732 |           const result = await cdp.send('Profiler.stop').catch(() => null);
  733 |           if (result)
  734 |             evidence.profileSha256 = await retainProfile(result.profile, profilerClock, info);
  735 |         }
  736 |         evidence.errors = f.errors;
  737 |         evidence.finalNative = await readDocResponsiveness(f.page).catch(() => null);
  738 |         if (reloadObservers) {
  739 |           const finalReloads = await readReloads(reloadObservers).catch(() => null);
  740 |           if (finalReloads) {
  741 |             evidence.reloadObservers = finalReloads.status;
  742 |             evidence.finalReloads = finalReloads.reloads;
  743 |           }
  744 |           await Promise.all([reloadObservers.sender.dispose(), reloadObservers.peer.dispose()]);
  745 |         }
  746 |         await writeFile(info.outputPath('spn108-metrics.json'), JSON.stringify(evidence, null, 2));
  747 |         await cdp.detach().catch(() => {});
  748 |         await f.close();
  749 |       }
  750 |     });
  751 | 
  752 | /** Only the separate continuation case reads native state at its final key's first frame. */
  753 | async function observeContinuationFrame(page: Page, unitId: string) {
  754 |   const handle = await page.evaluateHandle(
  755 |     ({ unitId, expectedKeys }) => {
  756 |       const installedAt = performance.now();
  757 |       let keyCount = 0;
  758 |       let frame: number | undefined;
  759 |       let result: {
  760 |         keyAt: number;
  761 |         frameAt: number;
  762 |         readStartedAt: number;
  763 |         readReturnedAt: number;
  764 |         responses: number;
  765 |         snapshot: DocResponsivenessEvidence | null;
  766 |       } | null = null;
  767 |       const keydown = (event: KeyboardEvent) => {
  768 |         if (
  769 |           !(event.target instanceof Element) ||
  770 |           !event.target.matches('[contenteditable="true"][data-u-comp="editor"]')
  771 |         )
  772 |           return;
  773 |         keyCount++;
  774 |         if (keyCount !== expectedKeys) return;
  775 |         const keyAt = performance.now();
  776 |         frame = requestAnimationFrame(() => {
  777 |           frame = undefined;
  778 |           const frameAt = performance.now();
  779 |           let snapshot: DocResponsivenessEvidence | null = null;
  780 |           let responses = 0;
  781 |           const read = (event: Event) => {
  782 |             const evidence = (event as CustomEvent<DocResponsivenessEvidence>).detail;
  783 |             if (evidence?.unitId !== unitId) return;
  784 |             responses++;
  785 |             snapshot = evidence;
  786 |           };
  787 |           window.addEventListener('spinel-doc-responsiveness-evidence', read);
  788 |           const readStartedAt = performance.now();
  789 |           try {
  790 |             window.dispatchEvent(
  791 |               new CustomEvent('spinel-doc-responsiveness-read', { detail: { includeText: true } }),
  792 |             );
  793 |           } finally {
  794 |             window.removeEventListener('spinel-doc-responsiveness-evidence', read);
  795 |             result = {
  796 |               keyAt,
  797 |               frameAt,
  798 |               readStartedAt,
  799 |               readReturnedAt: performance.now(),
  800 |               responses,
  801 |               snapshot,
  802 |             };
  803 |           }
  804 |         });
  805 |       };
  806 |       document.addEventListener('keydown', keydown, { capture: true, passive: true });
  807 |       return {
  808 |         read: () => ({ installedAt, unitId, expectedKeys, keyCount, result }),
  809 |         dispose() {
  810 |           document.removeEventListener('keydown', keydown, true);
  811 |           if (frame !== undefined) cancelAnimationFrame(frame);
  812 |         },
  813 |       };
```