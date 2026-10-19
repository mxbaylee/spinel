import { CommandService } from '@univerjs/core';
import type { IExecutionOptions, Injector, ILogService, IConfigService } from '@univerjs/core';

// Temporary probe: object provenance, never content matching or a loading timer.
// A clone made by the SDK will deliberately fail to match rather than risk
// suppressing an unrelated edit. Durable records and outbound params are untouched.
const recovered = new WeakMap<object, { unit: string; user: string }>();
const textMutation = 'doc.mutation.rich-text-editing';
export function markRecoveredParams(id: string, params: object, unit: string, user: string) {
  if (id === textMutation && (params as { unitId?: string }).unitId === unit)
    recovered.set(params, { unit, user });
}
export class ProbeReplayCommands extends CommandService {
  private unit: string;
  private user: () => string | null;
  private failed = false;
  constructor(
    injector: Injector,
    log: ILogService,
    config: IConfigService,
    unit: string,
    user: () => string | null,
  ) {
    super(injector, log, config);
    this.unit = unit;
    this.user = user;
  }
  private executionOptions(id: string, params: object | undefined, options?: IExecutionOptions) {
    if (this.failed) throw new Error('Recovered execution failed; this probe is invalid.');
    if (id !== textMutation || !params || options?.syncOnly) return options;
    const marker = recovered.get(params);
    if (!marker) return options;
    if (
      marker.unit !== this.unit ||
      marker.user !== this.user() ||
      (params as { unitId?: string }).unitId !== this.unit
    )
      throw new Error('Recovered command is outside the synthetic probe scope.');
    recovered.delete(params);
    // Public execution flag; does not become part of the serialized mutation.
    // It also bypasses Doc permission checks, so this experiment is restricted
    // to the synthetic owner fixture and its unchanged account/unit generation.
    return { ...options, fromChangeset: true, spinelRecoveredIdentity: true };
  }
  override async executeCommand<P extends object = object, R = boolean>(
    id: string,
    params?: P,
    options?: IExecutionOptions,
  ): Promise<R> {
    const execution = this.executionOptions(id, params, options);
    try {
      const result = await super.executeCommand<P, R>(id, params, execution);
      if (execution?.spinelRecoveredIdentity && result === false)
        throw new Error('Recovered execution returned failure.');
      return result;
    } catch (error) {
      if (execution?.spinelRecoveredIdentity) this.failed = true;
      throw error;
    }
  }
  override syncExecuteCommand<P extends object = object, R = boolean>(
    id: string,
    params?: P,
    options?: IExecutionOptions,
  ): R {
    const execution = this.executionOptions(id, params, options);
    try {
      const result = super.syncExecuteCommand<P, R>(id, params, execution);
      if (execution?.spinelRecoveredIdentity && result === false)
        throw new Error('Recovered execution returned failure.');
      return result;
    } catch (error) {
      if (execution?.spinelRecoveredIdentity) this.failed = true;
      throw error;
    }
  }
}
