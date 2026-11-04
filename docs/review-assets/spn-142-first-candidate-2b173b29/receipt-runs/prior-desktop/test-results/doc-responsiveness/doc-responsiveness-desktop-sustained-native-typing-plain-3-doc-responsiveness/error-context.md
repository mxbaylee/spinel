# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: doc-responsiveness.spec.ts >> desktop sustained native typing plain-3
- Location: e2e/doc-responsiveness.spec.ts:320:5

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 16
Received:    25.300000000046566
```

# Test source

```ts
  621 |           start: expectedInputCount,
  622 |           end: expectedInputCount,
  623 |         });
  624 |         expect((await readDocResponsiveness(f.other))?.selection).toMatchObject({
  625 |           start: 0,
  626 |           end: 0,
  627 |         });
  628 |         const initial = await integrity(f, clockOrigins);
  629 |         exactIntegrity(initial, expectedText, expectedInputCount);
  630 |         expect(initial.sender.history).toEqual(native.history);
  631 |         const initialReloads = await readReloads(reloadObservers);
  632 |         completeReloadObservation(initialReloads);
  633 |         expect(initialReloads.reloads).toEqual([]);
  634 |         const preUndoIntegrity: DocPreUndoIntegrity = {
  635 |           ...initial,
  636 |           passed: true,
  637 |           reloads: initialReloads.reloads,
  638 |         };
  639 |         evidence.preUndoIntegrity = preUndoIntegrity;
  640 |         const sealedNative = await readDocResponsiveness(f.page, false, {
  641 |           action: 'seal',
  642 |           epoch: drainArm!.epoch,
  643 |           generation: drainArm!.generation,
  644 |           unitId: drainArm!.unitId,
  645 |           timeOrigin: drainArm!.timeOrigin,
  646 |         });
  647 |         const drainWitness = sealedNative?.drainWitness as DocDrainWitness | null | undefined;
  648 |         evidence.drainWitness = drainWitness;
  649 |         expect(drainWitness).toBeTruthy();
  650 |         expect(drainWitness!.invalidated).toBe(false);
  651 |         expect(drainWitness!.invalidations).toEqual([]);
  652 |         expect(drainWitness!.epoch).toBe(drainArm!.epoch);
  653 |         expect(drainWitness!.generation).toBe(drainArm!.generation);
  654 |         expect(drainWitness!.unitId).toBe(native.unitId);
  655 |         expect(drainWitness!.timeOrigin).toBe(input.timeOrigin);
  656 |         expect(drainWitness!.expectedCompletedStates).toBe(expectedInputCount);
  657 |         expect(drainWitness!.completedStates).toBe(expectedInputCount);
  658 |         expect(drainWitness!.lastCompletedStateAt!).toBeGreaterThanOrEqual(input.keydownAt.at(-1)!);
  659 |         expect(drainWitness!.firstEmpty).toBeTruthy();
  660 |         expect(drainWitness!.firstEmpty).toEqual(native.drainWitness?.firstEmpty);
  661 |         expect(drainWitness!.firstEmpty!.observedAt).toBeGreaterThanOrEqual(
  662 |           drainWitness!.lastCompletedStateAt!,
  663 |         );
  664 |         expect(drainWitness!.firstEmpty!.pending).toEqual({ history: 0, collaboration: 0 });
  665 |         expect(drainWitness!.firstEmpty!.history).toEqual(native.history);
  666 |         expect(drainWitness!.firstEmpty!.highWater).toEqual(native.highWater);
  667 |         expect(drainWitness!.sealedAt!).toBeGreaterThanOrEqual(preUndoIntegrity.observedAt);
  668 |         const historyProgress: Record<string, unknown> = { phase: 'not-started' };
  669 |         evidence.undoRedoObservation = historyProgress;
  670 |         const undoRedo = await verifyUndoRedo(
  671 |           f,
  672 |           preUndoIntegrity,
  673 |           sample === 'plain-1',
  674 |           reloadObservers,
  675 |           clockOrigins,
  676 |           historyProgress,
  677 |         );
  678 |         evidence.undoRedo = undoRedo;
  679 |         expect(drainWitness!.sealedAt!).toBeLessThanOrEqual(undoRedo.beforeUndoAt);
  680 |         await expect
  681 |           .poll(async () => (await f.read()).body!.dataStream)
  682 |           .toBe(undoRedo.outcome === 'passed' ? expectedText : '\r\n');
  683 |         await Promise.all([online(f.page), online(f.other)]);
  684 |         expect(f.errors).toEqual([]);
  685 |         expect(input.keydownAt).toHaveLength(expectedInputCount);
  686 |         expect(input.keyToFrameMs).toHaveLength(expectedInputCount);
  687 |         evidence.correctness =
  688 |           undoRedo.outcome === 'passed'
  689 |             ? 'exact saved/live peer text, sender/peer selections, undo/redo and Online passed'
  690 |             : 'baseline redo refused at capacity; exact prior typing and Undo verified; recovered saved empty state';
  691 |         // Schema 5 retains the strict baseline history outcome and separately
  692 |         // observes capacity/idle work. Drain acceptance now uses the preregistered
  693 |         // browser-local witness; the unchanged late-read scalar remains descriptive.
  694 |         if (!baseline) {
  695 |           expect(native.highWater.history).toBeLessThanOrEqual(DOC_RESPONSIVENESS_GROUP_LIMIT);
  696 |           expect(native.highWater.collaboration).toBeLessThanOrEqual(
  697 |             DOC_RESPONSIVENESS_GROUP_LIMIT,
  698 |           );
  699 |           expect(capacityFlushes.length).toBeGreaterThan(0);
  700 |           for (const entry of native.flushes) {
  701 |             expect(['capacity', 'idle']).toContain(entry.reason);
  702 |             expect(Number.isInteger(entry.history) && entry.history >= 0).toBe(true);
  703 |             expect(Number.isInteger(entry.collaboration) && entry.collaboration >= 0).toBe(true);
  704 |             const pending = Math.max(entry.history, entry.collaboration);
  705 |             expect(pending).toBeGreaterThan(0);
  706 |             expect(pending).toBeLessThanOrEqual(DOC_RESPONSIVENESS_GROUP_LIMIT);
  707 |             if (entry.reason === 'capacity') expect(pending).toBe(DOC_RESPONSIVENESS_GROUP_LIMIT);
  708 |             if (entry.reason === 'idle') {
  709 |               expect(Number.isFinite(entry.quietForMs)).toBe(true);
  710 |               expect(entry.quietForMs!).toBeGreaterThanOrEqual(300);
  711 |             }
  712 |           }
  713 |           if (!profiled) {
  714 |             expect(frame.p95).toBeLessThanOrEqual(budgets[preset].inputP95Ms);
  715 |             expect(longTasks.max).toBeLessThanOrEqual(budgets[preset].longTaskMaxMs);
  716 |             // Idle samples must never dilute the registered capacity distribution.
  717 |             expect(capacityFlush!.p95).toBeLessThanOrEqual(budgets[preset].flushP95Ms);
  718 |             expect(capacityFlush!.max).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
  719 |             expect(idleFlush).not.toBeNull();
  720 |             {
> 721 |               expect(idleFlush!.p95).toBeLessThanOrEqual(budgets[preset].flushP95Ms);
      |                                      ^ Error: expect(received).toBeLessThanOrEqual(expected)
  722 |               expect(idleFlush!.max).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
  723 |             }
  724 |             expect(flushMaximum!).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
  725 |             expect(localDrainMs).not.toBeNull();
  726 |             expect(localDrainMs!).toBeLessThanOrEqual(1000);
  727 |           }
  728 |         }
  729 |         const finalReloads = await readReloads(reloadObservers);
  730 |         completeReloadObservation(finalReloads);
  731 |         expect(finalReloads.reloads).toEqual(undoRedo.reloads);
  732 |         evidence.reloadObservers = finalReloads.status;
  733 |         evidence.completed = true;
  734 |       } finally {
  735 |         if (finishInput)
  736 |           evidence.partialInput = await finishInput().catch((error) => ({ error: String(error) }));
  737 |         if (profiling) {
  738 |           const result = await cdp.send('Profiler.stop').catch(() => null);
  739 |           if (result)
  740 |             evidence.profileSha256 = await retainProfile(result.profile, profilerClock, info);
  741 |         }
  742 |         evidence.errors = f.errors;
  743 |         evidence.finalNative = await readDocResponsiveness(f.page).catch(() => null);
  744 |         if (reloadObservers) {
  745 |           const finalReloads = await readReloads(reloadObservers).catch(() => null);
  746 |           if (finalReloads) {
  747 |             evidence.reloadObservers = finalReloads.status;
  748 |             evidence.finalReloads = finalReloads.reloads;
  749 |           }
  750 |           await Promise.all([reloadObservers.sender.dispose(), reloadObservers.peer.dispose()]);
  751 |         }
  752 |         await writeFile(info.outputPath('spn108-metrics.json'), JSON.stringify(evidence, null, 2));
  753 |         await cdp.detach().catch(() => {});
  754 |         await f.close();
  755 |       }
  756 |     });
  757 | 
  758 | /** Only the separate continuation case reads native state at its final key's first frame. */
  759 | async function observeContinuationFrame(page: Page, unitId: string) {
  760 |   const handle = await page.evaluateHandle(
  761 |     ({ unitId, expectedKeys }) => {
  762 |       const installedAt = performance.now();
  763 |       let keyCount = 0;
  764 |       let frame: number | undefined;
  765 |       let result: {
  766 |         keyAt: number;
  767 |         frameAt: number;
  768 |         readStartedAt: number;
  769 |         readReturnedAt: number;
  770 |         responses: number;
  771 |         snapshot: DocResponsivenessEvidence | null;
  772 |       } | null = null;
  773 |       const keydown = (event: KeyboardEvent) => {
  774 |         if (
  775 |           !(event.target instanceof Element) ||
  776 |           !event.target.matches('[contenteditable="true"][data-u-comp="editor"]')
  777 |         )
  778 |           return;
  779 |         keyCount++;
  780 |         if (keyCount !== expectedKeys) return;
  781 |         const keyAt = performance.now();
  782 |         frame = requestAnimationFrame(() => {
  783 |           frame = undefined;
  784 |           const frameAt = performance.now();
  785 |           let snapshot: DocResponsivenessEvidence | null = null;
  786 |           let responses = 0;
  787 |           const read = (event: Event) => {
  788 |             const evidence = (event as CustomEvent<DocResponsivenessEvidence>).detail;
  789 |             if (evidence?.unitId !== unitId) return;
  790 |             responses++;
  791 |             snapshot = evidence;
  792 |           };
  793 |           window.addEventListener('spinel-doc-responsiveness-evidence', read);
  794 |           const readStartedAt = performance.now();
  795 |           try {
  796 |             window.dispatchEvent(
  797 |               new CustomEvent('spinel-doc-responsiveness-read', { detail: { includeText: true } }),
  798 |             );
  799 |           } finally {
  800 |             window.removeEventListener('spinel-doc-responsiveness-evidence', read);
  801 |             result = {
  802 |               keyAt,
  803 |               frameAt,
  804 |               readStartedAt,
  805 |               readReturnedAt: performance.now(),
  806 |               responses,
  807 |               snapshot,
  808 |             };
  809 |           }
  810 |         });
  811 |       };
  812 |       document.addEventListener('keydown', keydown, { capture: true, passive: true });
  813 |       return {
  814 |         read: () => ({ installedAt, unitId, expectedKeys, keyCount, result }),
  815 |         dispose() {
  816 |           document.removeEventListener('keydown', keydown, true);
  817 |           if (frame !== undefined) cancelAnimationFrame(frame);
  818 |         },
  819 |       };
  820 |     },
  821 |     { unitId, expectedKeys: expectedInputCount + 1 },
```