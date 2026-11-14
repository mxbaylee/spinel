import { boundedClock, boundedJson, ControlError } from './browserstack-bounded-http.ts';
import type { ledgerStore } from './browserstack-ledger-store.ts';

export const capabilityLimits = Object.freeze({
  elapsedMs: 180000,
  createMs: 45000,
  actionEndMs: 135000,
  commandMs: 8000,
  cleanupCommandMs: 5000,
  commandCount: 80,
  cleanupRequests: 7,
  bodyBytes: 65536,
  contexts: 4,
  preflightMs: 30000,
});
type Ledger = ReturnType<typeof ledgerStore>;
type Driver = {
  command(path: string, method?: 'GET' | 'POST', body?: unknown): Promise<unknown>;
};
export type PreparedCapability = {
  accountId: string;
  authentication: 'platform-passkey' | 'driver-virtual-authenticator';
  preparedDocId: string;
  preparedSheetId: string;
  imageSha256: string;
};
export type CapabilityPreview = {
  origin: string;
  // Supplied only by the owned disposable production-preview launcher. It must
  // verify normal TLS, exact build/origin, manifest/worker and socket upgrade.
  verify(signal: AbortSignal): Promise<void>;
  // No session/cookie injection or navigator.credentials override. An absent
  // implementation is an explicit incomplete capability, never a passing auth.
  authenticateAndPrepare?(driver: Driver, signal: AbortSignal): Promise<PreparedCapability>;
  verifyOffline?(driver: Driver, prepared: PreparedCapability, signal: AbortSignal): Promise<void>;
  verifyReconnected?(driver: Driver, signal: AbortSignal): Promise<void>;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ControlError('capability-response-invalid');
  return value as Record<string, unknown>;
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function returnedTarget(
  capabilities: Record<string, unknown>,
  target: { device: string; osVersion: string },
) {
  const vendor =
    capabilities['bstack:options'] === undefined ? {} : object(capabilities['bstack:options']);
  const present = (values: unknown[]) => values.filter((value) => value !== undefined);
  const devices = present([
    capabilities.deviceName,
    capabilities.device,
    capabilities['appium:deviceName'],
    vendor.deviceName,
  ]);
  const platforms = present([
    capabilities.platformName,
    capabilities.platform,
    capabilities['appium:platformName'],
  ]);
  const versions = present([
    capabilities.platformVersion,
    capabilities['appium:platformVersion'],
    capabilities.osVersion,
    capabilities.os_version,
    vendor.osVersion,
  ]);
  const real = present([capabilities.realMobile, capabilities.real_mobile, vendor.realMobile]);
  const simulator = present([capabilities.isSimulator, capabilities.simulator, capabilities['appium:isSimulator']]);
  const normalized = (value: unknown) =>
    typeof value === 'string' && /^\d{1,3}(?:\.\d{1,3}){0,3}$/.test(value)
      ? value.replace(/(?:\.0)+$/, '')
      : null;
  if (
    capabilities.browserName !== 'safari' ||
    capabilities.acceptInsecureCerts !== false ||
    !devices.length ||
    devices.some((value) => value !== target.device) ||
    !platforms.length ||
    platforms.some((value) => typeof value !== 'string' || value.toLowerCase() !== 'ios') ||
    !versions.length ||
    normalized(target.osVersion) === null ||
    versions.some((value) => normalized(value) !== normalized(target.osVersion)) ||
    !real.length ||
    real.some((value) => value !== true && value !== 'true') ||
    simulator.some((value) => value !== false && value !== 'false')
  )
    throw new ControlError('capability-target-unproved');
  return {
    browser: 'safari' as const,
    device: devices[0] as string,
    os: 'iOS' as const,
    osVersion: versions[0] as string,
    realMobile: true as const,
    evidence: 'new-session-capabilities' as const,
  };
}
const safeFailure = (error: unknown) =>
  error instanceof ControlError &&
  /^(control-(deadline|bounds-invalid|response-too-large|request-too-large|response-invalid|request-failed|http-\d{3})|ledger-[a-z-]+|capability-[a-z-]+)$/.test(
    error.code,
  )
    ? error.code
    : 'capability-failed';
async function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new ControlError('control-deadline'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, stopped]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

export async function runIphoneCapability(options: {
  run: string;
  attempt: number;
  sourceSha: string;
  testedSha: string;
  quotaEvidence: Uint8Array;
  username: string;
  accessKey: string;
  target: { device: string; osVersion: string };
  preview: CapabilityPreview;
  ledger(signal: AbortSignal, deadline: number): Ledger;
  signal: AbortSignal;
  now?: () => number;
  fetcher?: typeof fetch;
}) {
  const now = boundedClock(options.now);
  let origin: URL;
  try {
    origin = new URL(options.preview.origin);
  } catch {
    throw new ControlError('capability-input-invalid');
  }
  if (
    !/^https:\/\/github\.com\/mxbaylee\/spinel\/actions\/runs\/[1-9][0-9]{0,19}$/.test(
      options.run,
    ) ||
    !Number.isSafeInteger(options.attempt) ||
    options.attempt < 1 ||
    !/^[a-f0-9]{40}$/.test(options.sourceSha) ||
    !/^[a-f0-9]{40}$/.test(options.testedSha) ||
    origin.origin !== options.preview.origin ||
    origin.protocol !== 'https:' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(origin.hostname) ||
    !/^iPhone [\w .+-]{1,80}$/.test(options.target.device) ||
    !/^\d+(\.\d+)*$/.test(options.target.osVersion) ||
    !options.username ||
    !options.accessKey
  )
    throw new ControlError('capability-input-invalid');
  const result = {
    scope: 'one-real-iphone-installed-context-capability',
    status: 'capability-incomplete',
    fullOfflineAcceptance: false,
    sourceSha: options.sourceSha,
    testedSha: options.testedSha,
    run: options.run,
    attempt: options.attempt,
    reservationId: null as string | null,
    sessionId: null as string | null,
    requestedTarget: options.target,
    actualTarget: null as ReturnType<typeof returnedTarget> | null,
    checks: {
      preflight: false,
      nativeContext: false,
      installedContext: false,
      authenticatedPreparation: false,
      terminated: false,
      offlineRelaunch: false,
    },
    authentication: 'not-attempted' as string,
    failure: null as string | null,
    phase: 'preflight',
    cleanup: {
      network: 'not-changed',
      deletion: 'not-created',
      terminal: 'unconfirmed',
      reservation: 'not-created',
    },
    terminalDurationSeconds: null as number | null,
    commandAttempts: 0,
    cleanupAttempts: 0,
    limits: capabilityLimits,
  };
  const preflightDeadline = Math.floor(now()) + capabilityLimits.preflightMs;
  const preflightSignal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(capabilityLimits.preflightMs),
  ]);
  await within(options.preview.verify(preflightSignal), preflightSignal);
  if (options.signal.aborted || now() >= preflightDeadline)
    throw new ControlError('control-deadline');
  result.checks.preflight = true;
  const identity = await options.ledger(preflightSignal, preflightDeadline).reserve({
    run: options.run,
    attempt: options.attempt,
    sourceSha: options.sourceSha,
    testedSha: options.testedSha,
    reservedSeconds: capabilityLimits.elapsedMs / 1000,
    createdAt: new Date(now()).toISOString(),
    quotaEvidence: options.quotaEvidence,
  });
  result.reservationId = identity.reservationId;
  result.cleanup.reservation = 'unsettled';
  const startedAt = Math.floor(now());
  const actionDeadline = startedAt + capabilityLimits.actionEndMs;
  const deadline = startedAt + capabilityLimits.elapsedMs;
  const allocationSignal = AbortSignal.timeout(capabilityLimits.elapsedMs);
  const actionSignal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(capabilityLimits.actionEndMs),
  ]);
  const headers = {
    Authorization: `Basic ${Buffer.from(`${options.username}:${options.accessKey}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  let sessionId: string | undefined;
  let networkMayBeOffline = false;
  let createDispatched = false;
  const action = (timeoutMs: number) => {
    if (actionSignal.aborted || now() + timeoutMs > actionDeadline)
      throw new ControlError('control-deadline');
  };
  const request = async (
    url: string,
    method: 'GET' | 'POST' | 'PUT',
    body?: unknown,
    timeoutMs = capabilityLimits.commandMs,
  ) => {
    action(timeoutMs);
    if (++result.commandAttempts > capabilityLimits.commandCount)
      throw new ControlError('capability-command-limit');
    return boundedJson({
      url,
      method,
      body,
      headers,
      signal: actionSignal,
      deadline: actionDeadline,
      timeoutMs,
      maximumBytes: capabilityLimits.bodyBytes,
      now,
      fetcher: options.fetcher,
    });
  };
  const driver: Driver = {
    async command(path, method = 'GET', body) {
      if (
        !sessionId ||
        !/^(contexts|context|url|element|elements|element\/[A-Za-z0-9_.:-]{1,160}\/(click|value)|execute\/(sync|async))$/.test(
          path,
        )
      )
        throw new ControlError('capability-command-invalid');
      const response = object(
        await request(
          `https://hub.browserstack.com/wd/hub/session/${sessionId}/${path}`,
          method,
          body,
        ),
      );
      if (!Object.hasOwn(response, 'value')) throw new ControlError('capability-response-invalid');
      const value = response.value;
      if (value && typeof value === 'object' && 'error' in value)
        throw new ControlError('capability-webdriver-error');
      return value;
    },
  };
  const context = (name: string) => driver.command('context', 'POST', { name });
  const mobile = (script: string, args: Record<string, unknown> = {}) =>
    driver.command('execute/sync', 'POST', { script: `mobile: ${script}`, args: [args] });
  const tap = async (label: string) => {
    const found = object(
      await driver.command('element', 'POST', { using: 'accessibility id', value: label }),
    );
    const id = found['element-6066-11e4-a52e-4f735466cecf'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(id))
      throw new ControlError('capability-response-invalid');
    await driver.command(`element/${id}/click`, 'POST', {});
  };
  const webState = () =>
    driver.command('execute/sync', 'POST', {
      script:
        'return {origin:location.origin,secure:isSecureContext,standalone:matchMedia("(display-mode: standalone)").matches||navigator.standalone===true,worker:!!navigator.serviceWorker?.controller};',
      args: [],
    });
  const installedWebview = async () => {
    const contexts = await driver.command('contexts');
    if (
      !Array.isArray(contexts) ||
      contexts.length > capabilityLimits.contexts + 1 ||
      !contexts.includes('NATIVE_APP')
    )
      throw new ControlError('capability-context-unavailable');
    for (const candidate of contexts) {
      if (candidate === 'NATIVE_APP') continue;
      if (typeof candidate !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(candidate))
        throw new ControlError('capability-response-invalid');
      await context(candidate);
      const state = object(await webState());
      if (
        state.origin === options.preview.origin &&
        state.secure === true &&
        state.standalone === true &&
        state.worker === true
      )
        return;
    }
    throw new ControlError('capability-installed-webview-unavailable');
  };
  async function finishSession() {
    // Independent from caller/action abort: always retain a bounded cleanup
    // opportunity, including after a lost create response or failed install.
    const cleanupSignal = allocationSignal;
    let cleanupRequests = 0;
    const clean = async (
      url: string,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      body?: unknown,
      signal = cleanupSignal,
    ) => {
      if (
        ++cleanupRequests > capabilityLimits.cleanupRequests ||
        now() + capabilityLimits.cleanupCommandMs > deadline
      )
        throw new ControlError('control-deadline');
      result.cleanupAttempts++;
      return boundedJson({
        url,
        method,
        body,
        headers,
        signal,
        deadline,
        timeoutMs: capabilityLimits.cleanupCommandMs,
        maximumBytes: capabilityLimits.bodyBytes,
        now,
        fetcher: options.fetcher,
      });
    };
    if (sessionId) {
      if (networkMayBeOffline) {
        try {
          await clean(
            `https://api.browserstack.com/automate/sessions/${sessionId}/update_network.json`,
            'PUT',
            { networkProfile: '4g-lte-good' },
          );
          if (!options.preview.verifyReconnected || now() + 10000 > deadline - 10000)
            throw new ControlError('control-deadline');
          const reconnectSignal = AbortSignal.any([cleanupSignal, AbortSignal.timeout(10000)]);
          const cleanupDriver: Driver = {
            async command(path, method = 'GET', body) {
              if (
                reconnectSignal.aborted ||
                cleanupRequests >= capabilityLimits.cleanupRequests - 2 ||
                now() + capabilityLimits.cleanupCommandMs > deadline - 10000 ||
                !/^(execute\/(sync|async))$/.test(path)
              )
                throw new ControlError('control-deadline');
              const response = object(
                await clean(
                  `https://hub.browserstack.com/wd/hub/session/${sessionId}/${path}`,
                  method,
                  body,
                  reconnectSignal,
                ),
              );
              if (
                !Object.hasOwn(response, 'value') ||
                (response.value && typeof response.value === 'object' && 'error' in response.value)
              )
                throw new ControlError('capability-response-invalid');
              return response.value;
            },
          };
          await within(
            options.preview.verifyReconnected(cleanupDriver, reconnectSignal),
            reconnectSignal,
          );
          result.cleanup.network = 'restored-and-reachability-verified';
        } catch {
          result.cleanup.network = 'unconfirmed';
        }
      }
      try {
        const deleted = object(
          await clean(`https://hub.browserstack.com/wd/hub/session/${sessionId}`, 'DELETE'),
        );
        if (
          !Object.hasOwn(deleted, 'value') ||
          (deleted.value && typeof deleted.value === 'object' && 'error' in deleted.value)
        )
          throw new ControlError('capability-webdriver-error');
        result.cleanup.deletion = 'request-accepted';
      } catch {
        result.cleanup.deletion = 'unconfirmed';
      }
      try {
        const terminal = object(
          object(
            await clean(`https://api.browserstack.com/automate/sessions/${sessionId}.json`, 'GET'),
          ).automation_session,
        );
        if (
          terminal.hashed_id !== sessionId ||
          typeof terminal.browserstack_status !== 'string' ||
          !['done', 'error', 'timeout'].includes(terminal.browserstack_status) ||
          typeof terminal.duration !== 'number' ||
          !Number.isFinite(terminal.duration) ||
          terminal.duration < 0 ||
          terminal.duration > Number.MAX_SAFE_INTEGER
        )
          throw new ControlError('capability-terminal-unproved');
        result.cleanup.terminal = 'confirmed';
        result.terminalDurationSeconds = terminal.duration;
      } catch {
        result.cleanup.terminal = 'unconfirmed';
      }
    } else if (createDispatched) result.cleanup.deletion = 'session-id-unavailable';
    try {
      if (now() + 30000 > deadline) throw new ControlError('control-deadline');
      await options.ledger(cleanupSignal, deadline).retainUncertainty(identity, sessionId);
    } catch {
      result.cleanup.reservation = 'initial-reservation-retained-update-unconfirmed';
    }
    if (
      result.cleanup.terminal !== 'confirmed' ||
      result.cleanup.deletion !== 'request-accepted' ||
      result.cleanup.network === 'unconfirmed'
    ) {
      result.status = 'capability-incomplete';
      result.failure ??= 'capability-cleanup-unconfirmed';
    }
  }
  try {
    result.phase = 'create';
    action(capabilityLimits.createMs);
    result.commandAttempts++;
    createDispatched = true;
    const created = object(
      await boundedJson({
        url: 'https://hub.browserstack.com/wd/hub/session',
        method: 'POST',
        headers,
        body: {
          capabilities: {
            alwaysMatch: {
              browserName: 'safari',
              acceptInsecureCerts: false,
              timeouts: { implicit: 0, pageLoad: 5000, script: 5000 },
              'bstack:options': {
                deviceName: options.target.device,
                osVersion: options.target.osVersion,
                realMobile: true,
                projectName: 'Spinel',
                buildName: `SPN-090 capability ${identity.reservationId}`,
                sessionName: 'Installed iPhone capability',
                idleTimeout: 60,
              },
            },
          },
        },
        signal: actionSignal,
        deadline: Math.min(actionDeadline, startedAt + capabilityLimits.createMs),
        timeoutMs: capabilityLimits.createMs,
        maximumBytes: capabilityLimits.bodyBytes,
        now,
        fetcher: options.fetcher,
      }),
    );
    const value = object(created.value);
    if (typeof value.sessionId !== 'string' || !/^[a-f0-9]{40}$/.test(value.sessionId))
      throw new ControlError('capability-session-identity-unavailable');
    sessionId = value.sessionId;
    result.sessionId = sessionId;
    // Persist the known provider identity before further device interaction.
    action(30000);
    await options.ledger(actionSignal, actionDeadline).retainUncertainty(identity, sessionId);
    result.actualTarget = returnedTarget(object(value.capabilities), options.target);
    result.phase = 'open-production';
    await driver.command('url', 'POST', { url: options.preview.origin });
    const browser = object(await webState());
    if (browser.origin !== options.preview.origin || browser.secure !== true)
      throw new ControlError('capability-origin-mismatch');
    result.phase = 'native-install';
    const contexts = await driver.command('contexts');
    if (!Array.isArray(contexts) || !contexts.includes('NATIVE_APP'))
      throw new ControlError('capability-native-unavailable');
    await context('NATIVE_APP');
    result.checks.nativeContext = true;
    const safari = object(await mobile('activeAppInfo'));
    if (safari.bundleId !== 'com.apple.mobilesafari')
      throw new ControlError('capability-target-mismatch');
    await tap('Share');
    await tap('Add to Home Screen');
    await tap('Add');
    await mobile('pressButton', { name: 'home' });
    await tap('Spinel');
    await installedWebview();
    result.checks.installedContext = true;
    result.phase = 'authenticate-and-prepare';
    if (
      !options.preview.authenticateAndPrepare ||
      !options.preview.verifyOffline ||
      !options.preview.verifyReconnected
    )
      throw new ControlError('capability-authentication-not-configured');
    const prepared = await within(
      options.preview.authenticateAndPrepare(driver, actionSignal),
      actionSignal,
    );
    if (
      !uuid(prepared.accountId) ||
      !uuid(prepared.preparedDocId) ||
      !uuid(prepared.preparedSheetId) ||
      prepared.preparedDocId === prepared.preparedSheetId ||
      !/^[a-f0-9]{64}$/.test(prepared.imageSha256) ||
      !['platform-passkey', 'driver-virtual-authenticator'].includes(prepared.authentication)
    )
      throw new ControlError('capability-preparation-invalid');
    action(0);
    result.authentication = prepared.authentication;
    result.checks.authenticatedPreparation = true;
    result.phase = 'terminate';
    await context('NATIVE_APP');
    const active = object(await mobile('activeAppInfo'));
    if (
      typeof active.bundleId !== 'string' ||
      !/^[A-Za-z0-9.-]{1,160}$/.test(active.bundleId) ||
      ['com.apple.mobilesafari', 'com.apple.springboard'].includes(active.bundleId) ||
      typeof active.pid !== 'number' ||
      !Number.isSafeInteger(active.pid) ||
      active.pid <= 0
    )
      throw new ControlError('capability-installed-app-identity-unavailable');
    if (
      (await mobile('terminateApp', { bundleId: active.bundleId })) !== true ||
      (await mobile('queryAppState', { bundleId: active.bundleId })) !== 1
    )
      throw new ControlError('capability-termination-unproved');
    result.checks.terminated = true;
    result.phase = 'offline-relaunch';
    networkMayBeOffline = true;
    await request(
      `https://api.browserstack.com/automate/sessions/${sessionId}/update_network.json`,
      'PUT',
      { networkProfile: 'no-network' },
    );
    await mobile('pressButton', { name: 'home' });
    await tap('Spinel');
    const reopened = object(await mobile('activeAppInfo'));
    if (
      reopened.bundleId !== active.bundleId ||
      typeof reopened.pid !== 'number' ||
      !Number.isSafeInteger(reopened.pid) ||
      reopened.pid <= 0 ||
      reopened.pid === active.pid
    )
      throw new ControlError('capability-relaunch-unproved');
    await installedWebview();
    await within(options.preview.verifyOffline(driver, prepared, actionSignal), actionSignal);
    action(0);
    result.checks.offlineRelaunch = true;
    result.status = 'capability-observed';
  } catch (error) {
    result.failure = safeFailure(error);
  } finally {
    await finishSession();
  }
  return result;
}
