import type { BrowserContext } from '@playwright/test';
import { syncNetwork } from './sync-network.ts';

/** Chromium's HTTP offline switch alone may leave an existing socket alive. */
export async function interruptibleNetwork(context: BrowserContext) {
  const network = await syncNetwork(context);
  return {
    ...network,
    holdJoinAcknowledgements: network.holdResume,
    joinAcknowledgementHeld: network.resumeHeld,
    releaseJoinAcknowledgements: network.releaseResume,
    loseAcknowledgement: network.loseAcknowledgment,
    acknowledgementLost: () => Boolean(network.lostMutationId()),
  };
}
