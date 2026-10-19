import { CommandService } from '@univerjs/core';
import type { IExecutionOptions, Injector, ILogService, IConfigService } from '@univerjs/core';
import type { RecoveryLedger } from './RecoveryLedger.ts';

/** Public command boundary. The coordinator supplies one ledger per editor. */
export type RecoveryDispatchObserver = (
  mode: 'async' | 'sync',
  id: string,
  params?: object,
  options?: IExecutionOptions,
) => void;
export class RecoveryCommands extends CommandService {
  private observe?: RecoveryDispatchObserver;
  private ledger: () => RecoveryLedger | undefined;
  constructor(
    injector: Injector,
    log: ILogService,
    config: IConfigService,
    ledger: () => RecoveryLedger | undefined,
    observe?: RecoveryDispatchObserver,
  ) {
    super(injector, log, config);
    this.ledger = ledger;
    this.observe = observe;
  }
  override async executeCommand<P extends object = object, R = boolean>(
    id: string,
    params?: P,
    options?: IExecutionOptions,
  ): Promise<R> {
    const ledger = this.ledger();
    this.observe?.('async', id, params, options);
    const claim = ledger?.claim(id, params, options);
    try {
      const result = await super.executeCommand<P, R>(id, params, claim?.options ?? options);
      if (claim) ledger!.succeed(claim, result);
      return result;
    } catch (error) {
      if (claim) ledger!.reject(claim, error);
      throw error;
    }
  }
  override syncExecuteCommand<P extends object = object, R = boolean>(
    id: string,
    params?: P,
    options?: IExecutionOptions,
  ): R {
    const ledger = this.ledger();
    this.observe?.('sync', id, params, options);
    const claim = ledger?.claim(id, params, options);
    try {
      const result = super.syncExecuteCommand<P, R>(id, params, claim?.options ?? options);
      if (claim) ledger!.succeed(claim, result);
      return result;
    } catch (error) {
      if (claim) ledger!.reject(claim, error);
      throw error;
    }
  }
}
