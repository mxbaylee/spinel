// Diagnostic overlay only. Never imported by an application or acceptance build.
export function instrumentNativePhases(installed: string) {
  let source = installed;
  const replace = (before: string, after: string) => {
    if (source.split(before).length !== 2) throw new Error('Ambiguous native anchor: ' + before);
    source = source.replace(before, after);
  };
  replace(
    'function composeDocStateActions(states, key) {',
    `function spn135Phase(name, invoke) {
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
    replace(
      `\t${method}(unitId) {`,
      `\t${method}(unitId) {
\t\treturn spn135Phase("${phase}", () => this._spn135${phase}(unitId));
\t}
\t_spn135${phase}(unitId) {`,
    );
  }
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

// Capture before native reversal/clearing; bound both traversal and retained bytes.
// All values are tagged, preserving own undefined fields and array holes/length.
export const idleCaptureSource = `
    if (reason === 'idle') {
      const captureStartedAt = performance.now();
      const diagnostic = globalThis as unknown as {
        __spn135Idle?: unknown[]; __spn135CaptureError?: string;
      };
      try {
        let visits = 0;
        const ancestors = new Set<object>();
        const encode = (value: unknown): unknown => {
          if (++visits > 100000) throw new Error('Idle capture exceeds 100000 values');
          if (value === undefined) return { kind: 'undefined' };
          if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
              (typeof value === 'number' && Number.isFinite(value)))
            return { kind: 'value', value };
          if (typeof value !== 'object' || ancestors.has(value))
            throw new Error('Unsupported or cyclic native capture value');
          ancestors.add(value);
          try {
            return { kind: Array.isArray(value) ? 'array' : 'object',
              entries: Reflect.ownKeys(value).map(key => {
                const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
                if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value'))
                  throw new Error('Unsupported native capture property');
                return [key, encode(descriptor.value)];
              }) };
          } finally { ancestors.delete(value); }
        };
        const cache = encode(pending);
        const captures = diagnostic.__spn135Idle ??= [];
        if (captures.length >= 100) throw new Error('Idle capture exceeds 100 intervals');
        const item = { reason, quietForMs, captureStartedAt, cache,
          captureEndedAt: performance.now() };
        if (new TextEncoder().encode(JSON.stringify([...captures, item])).byteLength > 4 * 1024 * 1024)
          throw new Error('Idle captures exceed 4 MiB');
        captures.push(item);
        item.captureEndedAt = performance.now();
        performance.measure('spn135-idle-capture', { start: captureStartedAt, end: performance.now() });
      } catch (error) { diagnostic.__spn135CaptureError = String(error); }
    }
`;
