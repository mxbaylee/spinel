import { isIP } from 'node:net';

export type FixtureOrigin = {
  origin: string;
  host: string;
  hostname: string;
  port: number;
  servername: string | undefined;
};

/** Keep the public origin independent of the listener's loopback address. */
export function parseFixtureOrigin(value = 'https://localhost:8176'): FixtureOrigin {
  const invalid = () => new Error('invalid-fixture-https-origin');
  if (typeof value !== 'string' || !/^https:\/\/[^/?#@\\\s]+\/?$/i.test(value)) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const ip = isIP(hostname);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !hostname ||
    hostname.length > 253 ||
    (!ip &&
      !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))
  )
    throw invalid();
  const port = Number(url.port || 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid();
  return {
    origin: url.origin,
    host: url.host,
    hostname,
    port,
    servername: ip ? undefined : hostname,
  };
}
