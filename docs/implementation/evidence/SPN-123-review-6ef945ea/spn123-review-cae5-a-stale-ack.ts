import assert from 'node:assert/strict';
import { fixture, turns, wire, write } from '/Users/mxbaylee/projects/spinel-spn-123-production/lib/sync-client/tests/fixture.ts';
const results = [];
for (const refuse of [false, true]) {
  const f = fixture();
  const events = [];
  try {
    const source = f.client({ diagnostics: () => ({ sink: (event) => events.push(structuredClone(event)), context: { component: 'editor' } }) });
    source.resume();
    await turns();
    source.edit([write({v:'committed first save'})]);
    source.sync.retry();
    await turns();
    const first = source.submits().at(-1)!;
    const accepted = await f.accept(first);
    source.sync.receive({type:'ack', mutationId:first.mutationId, duplicate:false, ...wire(accepted.edit)});
    await turns();
    assert.equal(source.sync.confirmedRevision, 2);
    events.length = 0;
    source.edit([write({v:'second save never submitted to server'})]);
    source.sync.retry();
    await turns();
    const second = source.submits().at(-1)!;
    assert.equal(second.baseRevision, 2);
    if (refuse) source.sync.refuse('divergence');
    // Negative protocol input: matching immutable identity but old revision/body.
    // The current-head normal path rejects this same shape-valid input as stale.
    source.sync.receive({type:'ack', mutationId:second.mutationId, duplicate:false, ...wire(accepted.edit)});
    await turns();
    results.push({refusedBeforeAck:refuse, currentRevision:source.sync.confirmedRevision, submittedBaseRevision:second.baseRevision, ackRevision:accepted.edit.revision, durableHistoryRows:f.storage.history.length, failures:source.failures, operationResults:events.filter(event=>event.name==='operation.result')});
  } finally { f.close(); }
}
console.log(JSON.stringify({candidate:'cae5a58689b049e4f62c3a815482e21bb5212f49',negativeInput:'matching second request identity with old revision2 receipt; server never accepted second write',results},null,2));
assert.equal(results[0].operationResults.some(event=>event.details.outcome==='success'),false);
assert.equal(results[1].operationResults.some(event=>event.details.outcome==='success'),true);
