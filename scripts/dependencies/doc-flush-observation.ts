/**
 * Copyright 2023-present DreamNum Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for Spinel: opt-in scalar observations at native flush boundaries.
 * Source: packages/docs/src/services/doc-state-change-manager.service.ts,
 * dream-num/univer v1.1.0. No Pro code is read or modified.
 */
// Exact transforms of the Apache-2.0 Univer v1.1.0 Doc state manager.
// Modified for Spinel: opt-in scalar observations; native bodies stay unchanged.
// Covered by patch-univer-docs.ts's complete original-file hash guard.
export const docFlushObservationReplacements = [
  {
    before:
      '\tflushPendingChanges(unitId) {\n\t\tthis._pushHistory(unitId);\n\t\tthis._emitChangeState(unitId);\n\t}',
    after: `\tobserveFlushes(unitId, observer) {
\t\tconst entry = { unitId, observer, active: true, observerErrors: 0 };
\t\t(this._spinelFlushObservers ??= new Set()).add(entry);
\t\treturn {
\t\t\tdispose: () => { entry.active = false; this._spinelFlushObservers.delete(entry); },
\t\t\treadStatus: () => ({ active: entry.active, observerErrors: entry.observerErrors })
\t\t};
\t}
\t_spinelObservedFlush(unitId, phase, origin, body) {
\t\tif (!this._spinelFlushObservers?.size) return body.call(this, unitId, origin);
\t\tconst observers = [...this._spinelFlushObservers].filter((entry) => entry.unitId === unitId && entry.active);
\t\tif (!observers.length) return body.call(this, unitId, origin);
\t\tconst counts = () => {
\t\t\tconst cache = this.getStateCache(unitId);
\t\t\treturn { history: cache.history.length, collaboration: cache.collaboration.length };
\t\t};
\t\tconst before = counts();
\t\tconst sequence = this._spinelFlushSequence = (this._spinelFlushSequence ?? 0) + 1;
\t\tconst startedAt = performance.now();
\t\tlet outcome = "threw";
\t\ttry {
\t\t\tconst result = body.call(this, unitId, origin);
\t\t\toutcome = "returned";
\t\t\treturn result;
\t\t} finally {
\t\t\tconst endedAt = performance.now();
\t\t\tconst after = counts();
\t\t\tfor (const entry of observers) {
\t\t\t\ttry { entry.observer({ sequence, unitId, phase, origin, startedAt, endedAt, before, after, outcome }); }
\t\t\t\tcatch { entry.observerErrors++; }
\t\t\t}
\t\t}
\t}
\tflushPendingChanges(unitId, reason) {
\t\treturn this._spinelObservedFlush(unitId, "pair", reason === "capacity" ? "policy-capacity" : reason === "idle" ? "policy-idle" : "public-flush", this._spinelFlushPendingChanges);
\t}
\t_spinelFlushPendingChanges(unitId, origin) {
\t\tthis._pushHistory(unitId, origin);
\t\tthis._emitChangeState(unitId, origin);
\t}`,
    count: 1,
  },
  ...(['history', 'collaboration'] as const).map((phase) => {
    const method = phase === 'history' ? '_pushHistory' : '_emitChangeState';
    return {
      before: `\t${method}(unitId) {`,
      after: `\t${method}(unitId, origin = "unknown") {
\t\treturn this._spinelObservedFlush(unitId, "${phase}", origin, this._spinel${method});
\t}
\t_spinel${method}(unitId) {`,
      count: 1,
    };
  }),
  {
    before: '\t\t\t\tthis._pushHistory(unitId);\n\t\t\t\tthis._emitChangeState(unitId);',
    after:
      '\t\t\t\tthis._pushHistory(unitId, "history-command");\n\t\t\t\tthis._emitChangeState(unitId, "history-command");',
    count: 1,
  },
  {
    before:
      'pendingStates[pendingStates.length - 1].segmentId !== changeState.segmentId) cb(unitId);',
    after:
      'pendingStates[pendingStates.length - 1].segmentId !== changeState.segmentId) cb(unitId, "segment-boundary");',
    count: 1,
  },
  {
    before: '\t\t\t\t\tcb(unitId);',
    after: '\t\t\t\t\tcb(unitId, type === "history" ? "history-timer" : "collaboration-timer");',
    count: 2,
  },
  {
    before: '\t\t} else cb(unitId);',
    after: '\t\t} else cb(unitId, "immediate");',
    count: 1,
  },
  {
    before: '\tdispose() {\n\t\tif (this._historyTimer != null)',
    after:
      '\tdispose() {\n\t\tfor (const entry of this._spinelFlushObservers ?? []) entry.active = false;\n\t\tthis._spinelFlushObservers?.clear();\n\t\tif (this._historyTimer != null)',
    count: 1,
  },
];
