/** Explicit diagnostic only; never installed in ordinary responsiveness runs. */
type Method = (this: unknown, ...args: any[]) => any;
export interface DiagnosticManager {
  _pushHistory: Method;
  _emitChangeState: Method;
  getStateCache(unitId: string): { history: unknown[]; collaboration: unknown[] };
}

export function observeNativeDocComposition(
  manager: DiagnosticManager,
  composer: { compose: Method },
  unitId: string,
  now = () => performance.now(),
) {
  const originalCompose = composer.compose;
  if (
    typeof manager._pushHistory !== 'function' ||
    typeof manager._emitChangeState !== 'function' ||
    typeof originalCompose !== 'function'
  )
    throw new Error('Native diagnostic methods unavailable.');
  const composeDescriptor = Object.getOwnPropertyDescriptor(composer, 'compose');
  const methods = [
    ['_pushHistory', 'history'],
    ['_emitChangeState', 'collaboration'],
  ] as const;
  const originals = methods.map(([method]) => ({
    method,
    value: manager[method],
    descriptor: Object.getOwnPropertyDescriptor(manager, method),
  }));
  const limits = { phases: 160, states: 5_120, calls: 16_384, encodedNodes: 1_000_000, depth: 40 };
  const captures: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let states = 0,
    encodedNodes = 0,
    dropped = 0,
    activePair: number | null = null;
  let stopped = false,
    restored = false;
  const installedAt = now();
  const fail = (error: unknown) => {
    dropped++;
    if (errors.length < 32) errors.push(String(error));
  };
  const encode = (value: unknown, depth = 0): unknown => {
    if (++encodedNodes > limits.encodedNodes || depth > limits.depth)
      throw new Error('Native cache encoding limit.');
    if (value === undefined) return { kind: 'undefined' };
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return { kind: 'value', value };
    if (
      typeof value !== 'object' ||
      Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)
    )
      throw new Error('Native cache contains unsupported data.');
    return {
      kind: Array.isArray(value) ? 'array' : 'object',
      entries: Reflect.ownKeys(value).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value'))
          throw new Error('Native cache contains a symbol/accessor.');
        return [key, encode(descriptor.value, depth + 1)];
      }),
    };
  };
  const compose: Method = function (...args) {
    if (stopped || activePair === null) return Reflect.apply(originalCompose, this, args);
    const startedAt = now(),
      pair = activePair;
    let outcome = 'returned';
    try {
      return Reflect.apply(originalCompose, this, args);
    } catch (error) {
      outcome = 'threw';
      throw error;
    } finally {
      const endedAt = now();
      if (calls.length < limits.calls) calls.push({ pair, startedAt, endedAt, outcome });
      else fail('Native composition call overflow.');
    }
  };
  const wrappers = methods.map(
    ([method, phase], index): Method =>
      function (...args) {
        const originalFlush = originals[index].value;
        if (stopped || args[0] !== unitId) return Reflect.apply(originalFlush, this, args);
        const sequence = captures.length,
          captureStartedAt = now();
        const previousPair = activePair;
        let capture: Record<string, unknown> | undefined;
        try {
          const cache = manager.getStateCache(unitId)[phase];
          const count = cache.length;
          if (count) {
            if (
              sequence >= limits.phases ||
              states + count > limits.states ||
              previousPair !== null
            )
              throw new Error('Native cache capture limit/reentrant flush.');
            states += count;
            capture = {
              sequence,
              phase,
              method,
              captureStartedAt,
              cache: encode(cache),
              count,
              captureEndedAt: now(),
            };
            captures.push(capture);
            activePair = sequence;
          }
        } catch (error) {
          fail(error);
        }
        try {
          return Reflect.apply(originalFlush, this, args);
        } catch (error) {
          if (capture) capture.outcome = 'threw';
          throw error;
        } finally {
          if (capture) {
            capture.returnedAt = now();
            capture.outcome ??= 'returned';
          }
          activePair = previousPair;
        }
      },
  );
  const restore = (object: object, key: string, descriptor: PropertyDescriptor | undefined) => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  };
  try {
    for (const [index, { method }] of originals.entries())
      Object.defineProperty(manager, method, {
        configurable: true,
        writable: true,
        value: wrappers[index],
      });
    Object.defineProperty(composer, 'compose', {
      configurable: true,
      writable: true,
      value: compose,
    });
  } catch (error) {
    for (const { method, descriptor } of originals) restore(manager, method, descriptor);
    throw error;
  }
  return {
    finish() {
      if (!stopped) {
        stopped = true;
        const ownsCompose = composer.compose === compose;
        let ownsFlush = true;
        for (const [index, { method, descriptor }] of originals.entries()) {
          if (manager[method] === wrappers[index]) restore(manager, method, descriptor);
          else ownsFlush = false;
        }
        if (ownsCompose) restore(composer, 'compose', composeDescriptor);
        restored = ownsFlush && ownsCompose;
        if (!restored) fail('Native diagnostic method ownership changed.');
      }
      return {
        schema: 1,
        diagnosticOnly: true,
        unitId,
        installedAt,
        finishedAt: now(),
        limits,
        states,
        encodedNodes,
        dropped,
        errors,
        stopped,
        restored,
        captures,
        calls,
      };
    },
  };
}
