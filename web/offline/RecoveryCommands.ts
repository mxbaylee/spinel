import { CommandService } from '@univerjs/core';
import type { IExecutionOptions, Injector, ILogService, IConfigService } from '@univerjs/core';
import type { RecoveryLedger } from './RecoveryLedger.ts';

/** Public command boundary. The coordinator supplies one ledger per editor. */
export class RecoveryCommands extends CommandService {
  private ledger: () => RecoveryLedger | undefined;
  constructor(
    injector: Injector,
    log: ILogService,
    config: IConfigService,
    ledger: () => RecoveryLedger | undefined,
  ) {
    super(injector, log, config);
    this.ledger = ledger;
  }
  override async executeCommand<P extends object = object, R = boolean>(
    id: string,
    params?: P,
    options?: IExecutionOptions,
  ): Promise<R> {
    const ledger = this.ledger();
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
