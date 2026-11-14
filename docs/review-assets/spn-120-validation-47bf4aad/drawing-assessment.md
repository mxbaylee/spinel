# 🔎 Native Doc drawing failure assessment

Source: `47bf4aad2a7b7e880dbb3cf43eb09d90da70c6ee`; Storybook run `43554616505`, attempt 1, desktop-light job `132324964897`. Artifact `14097504548`, ZIP SHA-256 `c203f06d01059c23bdeb0eb6f8737fd689186e852d3edd9557cf19f1b067d167`.

## Observed failure

`editor-sync-native--doc-drawing-capture` emits `expected 2 to be greater than 2`. The fail-closed wrapper detects one `playFunctionThrewException` even though Storybook reports `storyFinished.status=success`. No unhandled-error event is recorded. Other four selected Storybook variants passed. The original failure is retained; no rerun was requested.

`web/SyncNative.stories.tsx` last changed in SPN-058 commit `12aa9b0d`. The play function has three potentially matching assertions: resize increment and recreated-controls increment after Narrow editor (lines 380–381), and resize increment after Restore editor width (line 386). The retained error is truncated and contains no exact assertion/phase/counter name. Post-failure host, layout and canvas widths are all 1280 at viewport 1280×900, with the image selected. These later measurements do not establish the failed phase or cause.

## Hypothesis and bounded follow-up

The fixture observes global resize/control counters, sampled into hidden output every 100 ms, rather than proving the requested native width has settled. A pending unrelated resize could satisfy the first counter wait and permit a restore before the narrow width is observed. This is a hypothesis, not a confirmed diagnosis; the evidence also does not exclude a missing native control/resize event.

Recommend one separate **M** investigation and repair outcome, retaining the original native image insertion, text/image selection, pending-queue and no-selection-mutation contract. First add bounded phase/counter/host-and-native-width diagnostics; establish the causal failure using the existing Storybook fixture. Then repair the identified boundary at the lowest meaningful layer, with a negative control proving missing narrow/restore work cannot pass. Preserve existing budgets, no retries or fixed sleeps, existing selected variants and source/shared-dependency routing. Use the current Storybook interactions and focused controls; do not duplicate the entire browser matrix locally. Reassess scope before coding if the cause crosses native product rendering/persistence boundaries. No ticket ID is allocated by this assessment.

## Persona decision

Operator benefits from a trustworthy gate and bounded diagnostic workload; Owner and Collaborator require real drawing edits to survive while selection/resize cannot masquerade as saved edits; Link guest requires the same native interaction contract without changing access or edit permissions. Separate ownership avoids conflating this newly observed native fixture boundary with SPN-120’s finite retained cases. SPN-087’s obsolete CSS-only work is not automatically the owner. The choice incurs a focused follow-up and delays acceptance until its failure is disposed of; it does not waive a gate or erase the first failure. Agent decision only, under standing four-persona delegation.
