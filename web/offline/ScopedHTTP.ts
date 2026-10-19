import type { HTTPRequest, IHTTPImplementation } from '@univerjs/network';
import type { OfflineScope } from './OfflineAccess.ts';
import { OfflineAccess } from './OfflineAccess.ts';
import { remoteRequest } from './remoteRequest.ts';

/** Only the public protocol paths exercised by this editor's pinned SDK. */
export function protocolRequestMode(request: HTTPRequest, scope: OfflineScope): 'read' | 'write' {
  const url = new URL(request.getUrlWithParams(), scope.origin);
  if (url.origin !== scope.origin || url.username || url.password || url.hash)
    throw new Error('Offline editor request left its instance.');
  for (const [key, expected] of [
    ['unitID', scope.unitId],
    ['spinelAccount', scope.accountId],
  ]) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1 || values.some((value) => value !== expected))
      throw new Error('Protocol query left its prepared scope.');
  }
  const parts = url.pathname.split('/').map(decodeURIComponent);
  const type = String(scope.kind === 'doc' ? 1 : 2);
  if (
    request.method === 'GET' &&
    url.pathname === '/universer-api/user/session-ticket' &&
    url.searchParams.getAll('unitID').length === 1 &&
    url.searchParams.get('unitID') === scope.unitId
  )
    return 'read';
  if (
    request.method === 'POST' &&
    url.pathname === '/universer-api/authz/-/object/-/batch_allowed'
  ) {
    const raw = request.getBody();
    if (typeof raw !== 'string') throw new Error('Unrecognized permission request.');
    const body = JSON.parse(raw);
    if (
      !Array.isArray(body?.requests) ||
      !body.requests.length ||
      !body.requests.every((entry: { unitID?: string } | null) => entry?.unitID === scope.unitId)
    )
      throw new Error('Permission request left its prepared document.');
    return 'read';
  }
  if (request.method === 'GET' && parts[1] === 'universer-api' && parts[2] === 'snapshot') {
    if (
      parts.length === 8 &&
      parts[3] === type &&
      parts[4] === 'unit' &&
      parts[5] === scope.unitId &&
      parts[6] === 'rev' &&
      /^\d+$/.test(parts[7])
    )
      return 'read';
    if (
      parts.length === 9 &&
      parts[3] === 'block' &&
      parts[4] === type &&
      parts[5] === 'unit' &&
      parts[6] === scope.unitId &&
      parts[7] === 'block' &&
      parts[8] &&
      !parts[8].includes('/')
    )
      return 'read';
  }
  if (
    request.method === 'POST' &&
    parts.length === 7 &&
    parts[1] === 'universer-api' &&
    parts[2] === 'comb' &&
    parts[3] === type &&
    parts[4] === 'unit' &&
    parts[5] === scope.unitId &&
    parts[6] === 'new_changes'
  ) {
    const raw = request.getBody();
    if (typeof raw !== 'string') throw new Error('Unrecognized changeset request.');
    const envelope = JSON.parse(raw);
    const changeset = envelope?.changeset;
    if (
      envelope?.unitID !== scope.unitId ||
      envelope.type !== Number(type) ||
      changeset?.unitID !== scope.unitId ||
      changeset.type !== Number(type) ||
      changeset.userID !== scope.accountId
    )
      throw new Error('Changeset left its original account or document.');
    return 'write';
  }
  throw new Error('Offline editor requested an unsupported protocol operation.');
}

/** Install at IHTTPImplementation; an earlier interceptor is not sufficient. */
export class ScopedHTTP implements IHTTPImplementation {
  private access: OfflineAccess;
  private transport: IHTTPImplementation;
  constructor(access: OfflineAccess, transport: IHTTPImplementation) {
    this.access = access;
    this.transport = transport;
  }
  send(request: HTTPRequest) {
    const mode = protocolRequestMode(request, this.access.scope);
    const url = request.getUrlWithParams();
    const body = request.getBody();
    return remoteRequest(this.access, mode, () => {
      if (
        request.getUrlWithParams() !== url ||
        request.getBody() !== body ||
        protocolRequestMode(request, this.access.scope) !== mode
      )
        throw new Error('Queued protocol request changed operation.');
      // The server compares this immutable account with the actual cookie on
      // every request. A cookie switch cannot reattribute old pending edits.
      // SDK HTTPHeaders.set appends. Repeated subscriptions must keep exactly
      // one binding, and must never accept a preexisting foreign binding.
      const binding = request.headers.get('X-Spinel-Account');
      if (binding && (binding.length !== 1 || binding[0] !== this.access.scope.accountId))
        throw new Error('Protocol request changed account.');
      if (!binding) request.headers.set('X-Spinel-Account', this.access.scope.accountId);
      return this.transport.send(request);
    });
  }
}
