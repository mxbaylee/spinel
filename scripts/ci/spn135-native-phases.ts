// Diagnostic overlay only. Never imported by an application or acceptance build.
export function instrumentNativePhases(installed: string) {
  let source = installed;
  const replace = (before: string, after: string) => {
    if (source.split(before).length !== 2) throw new Error('Ambiguous native anchor: ' + before);
    source = source.replace(before, after);
  };
  replace(
    'function composeDocStateActions(states, key) {',
    `function spn135WithOrigin(manager, origin, invoke) {
\tconst previous = manager._spn135Origin;
\tmanager._spn135Origin = origin;
\ttry { return invoke(); } finally { manager._spn135Origin = previous; }
}
function spn135Capture(manager, unitId, phase) {
\tconst pending = (phase === "history" ? manager._historyStateCache : manager._changeStateCache).get(unitId);
\tif (!Array.isArray(pending) || pending.length === 0) return;
\tconst captureStartedAt = performance.now();
\ttry {
\t\tlet visits = 0;
\t\tconst ancestors = new Set();
\t\tfunction encode(value) {
\t\t\tif (++visits > 100000) throw new Error("Native capture exceeds 100000 values");
\t\t\tif (value === undefined) return { kind: "undefined" };
\t\t\tif (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return { kind: "value", value };
\t\t\tif (typeof value !== "object" || ancestors.has(value)) throw new Error("Unsupported or cyclic native capture value");
\t\t\tancestors.add(value);
\t\t\ttry { return { kind: Array.isArray(value) ? "array" : "object", entries: Reflect.ownKeys(value).map(key => {
\t\t\t\tconst descriptor = Object.getOwnPropertyDescriptor(value, key);
\t\t\t\tif (typeof key !== "string" || !Object.hasOwn(descriptor, "value")) throw new Error("Unsupported native capture property");
\t\t\t\treturn [key, encode(descriptor.value)];
\t\t\t}) }; } finally { ancestors.delete(value); }
\t\t}
\t\tconst captures = globalThis.__spn135Native ??= [];
\t\tif (captures.length >= 1000) throw new Error("Native capture exceeds 1000 invocations");
\t\t// The investigation targets the terminal group below capacity32. Keep full
\t\t// phase/count/origin evidence for capacity groups without copying their state.
\t\tconst cache = pending.length < 32 ? encode(pending) : null;
\t\tconst item = { id: captures.length + 1, unitId, phase, origin: manager._spn135Origin ?? "direct",
\t\t\tcount: pending.length, cache, cacheOmitted: cache === null ? "capacity-or-larger" : null,
\t\t\tcaptureStartedAt, captureEndedAt: performance.now() };
\t\tconst bytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
\t\t// Reserve space for closing timestamps and array punctuation before retaining.
\t\tconst total = (globalThis.__spn135NativeBytes ?? 0) + bytes + 512;
\t\tif (total > 4 * 1024 * 1024) throw new Error("Native captures exceed 4 MiB");
\t\tglobalThis.__spn135NativeBytes = total;
\t\tcaptures.push(item);
\t\titem.captureEndedAt = performance.now();
\t\treturn item;
\t} catch (error) { globalThis.__spn135CaptureError = String(error); }
}
function spn135Phase(name, invoke) {
\tconst start = performance.now();
\ttry { return invoke(); }
\tfinally {
\t\ttry { performance.measure("spn135-" + name, { start, end: performance.now() }); }
\t\tcatch (error) { globalThis.__spn135PhaseError = String(error); }
\t}
}
function composeDocStateActions(states, key) {
\treturn spn135Phase("composition-" + key, () => spn135ComposeDocStateActions(states, key));
}
function spn135ComposeDocStateActions(states, key) {`,
  );
  for (const [method, phase] of [
    ['flushPendingChanges', 'flush'],
    ['_pushHistory', 'history'],
    ['_emitChangeState', 'collaboration'],
  ]) {
    const invocation = `spn135Phase("${phase}", () => this._spn135${phase}(unitId))`;
    const body =
      phase === 'flush'
        ? `return spn135WithOrigin(this, this._spn135Origin ?? "public-flush", () => ${invocation});`
        : `const capture = spn135Capture(this, unitId, "${phase}");
\t\tconst start = performance.now();
\t\ttry { return ${invocation}; }
\t\tfinally { if (capture) { capture.phaseStartedAt = start; capture.phaseEndedAt = performance.now(); } }`;
    replace(
      `\t${method}(unitId) {`,
      `\t${method}(unitId) {
\t\t${body}
\t}
\t_spn135${phase}(unitId) {`,
    );
  }
  for (const timer of ['_historyTimer', '_changeStateCacheTimer']) {
    replace(
      `this.${timer} = setTimeout(() => {\n\t\t\t\t\tcb(unitId);`,
      `this.${timer} = setTimeout(() => {\n\t\t\t\t\tspn135WithOrigin(this, type + "-timer", () => cb(unitId));`,
    );
  }
  replace(
    'segmentId !== changeState.segmentId) cb(unitId);',
    'segmentId !== changeState.segmentId) spn135WithOrigin(this, "segment-boundary", () => cb(unitId));',
  );
  replace('} else cb(unitId);', '} else spn135WithOrigin(this, "immediate", () => cb(unitId));');
  replace(
    'const unitId = univerDoc.getUnitId();\n\t\t\t\tthis._pushHistory(unitId);\n\t\t\t\tthis._emitChangeState(unitId);',
    'const unitId = univerDoc.getUnitId();\n\t\t\t\tspn135WithOrigin(this, "history-command", () => { this._pushHistory(unitId); this._emitChangeState(unitId); });',
  );
  replace(
    '\t\tundoRedoService.pushUndoRedo({\n\t\t\tunitID: unitId,',
    '\t\tspn135Phase("history-publication", () => undoRedoService.pushUndoRedo({\n\t\t\tunitID: unitId,',
  );
  replace(
    '\t\t\t\tparams: redoParams\n\t\t\t}]\n\t\t});\n\t\tcacheStates.length = 0;',
    '\t\t\t\tparams: redoParams\n\t\t\t}]\n\t\t}));\n\t\tcacheStates.length = 0;',
  );
  replace(
    '\t\tthis._docStateChange$.next(changeState);',
    '\t\tspn135Phase("collaboration-publication", () => this._docStateChange$.next(changeState));',
  );
  return source;
}

// Label the existing public policy call without changing its return/throw path.
export const policyOriginSource = `
      const diagnostic = manager as unknown as { _spn135Origin?: string };
      const previousOrigin = diagnostic._spn135Origin;
      diagnostic._spn135Origin = 'policy-' + reason;
      try { manager.flushPendingChanges(unitId); }
      finally { diagnostic._spn135Origin = previousOrigin; }
`;
