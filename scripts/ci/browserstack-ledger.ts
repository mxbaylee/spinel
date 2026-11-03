// Provider evidence belongs in durable Git history, not an expiring Actions artifact.
// This client can read/update only the dedicated accounting branch and ledger path.
export const accountingBranch = 'ci/browserstack-accounting';
const ledgerPath = 'ledger.json';
const maxBytes = 1_048_576;
type Row = Record<string, unknown>;
export type LedgerSnapshot = { value: unknown | null; blobSha: string | null };

/** Reads a JSON body without buffering past `limit` bytes or past `signal`. */
export async function readJsonBody(
  response: Response,
  signal: AbortSignal,
  limit: number,
): Promise<unknown> {
  if (!response.body) throw new Error('invalid-response');
  const reader = response.body.getReader();
  const buffer = Buffer.alloc(limit);
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read().catch(() => {
        throw new Error('request-failed');
      });
      if (signal.aborted) throw new Error('request-failed');
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > buffer.length) throw new Error('response-too-large');
      buffer.set(chunk.value, length - chunk.value.byteLength);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)),
    ) as unknown;
  } catch {
    throw new Error('invalid-response');
  }
}

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('ledger-invalid-response');
  return value as Row;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value))
    throw new Error('ledger-invalid-response');
  return value;
}

/**
 * Each read()/write() invocation has its own 60-second deadline; write includes
 * immutable readback. Time between phases does not consume the next deadline.
 * Requests retain their 8-second limit and the client's shared eight-request cap.
 */
export function ledgerClient(options: {
  repository: string;
  token: string;
  fetcher?: typeof fetch;
}) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(options.repository) ||
    !options.token
  )
    throw new Error('ledger-missing-credentials');
  const fetcher = options.fetcher ?? fetch;
  const api = `https://api.github.com/repos/${options.repository}`;
  let requests = 0;
  async function request(
    overall: AbortSignal,
    path: string,
    method = 'GET',
    body?: unknown,
    missing = false,
  ) {
    if (++requests > 8) throw new Error('ledger-request-limit');
    const signal = AbortSignal.any([overall, AbortSignal.timeout(8_000)]);
    let response: Response;
    try {
      response = await fetcher(`${api}/${path}`, {
        method,
        signal,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('ledger-request-failed');
    }
    if (missing && response.status === 404) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`ledger-http-${response.status}`);
    }
    try {
      return await readJsonBody(response, signal, maxBytes * 2);
    } catch {
      throw new Error('ledger-invalid-response');
    }
  }
  async function contents(overall: AbortSignal, ref: string) {
    const data = row(
      await request(overall, `contents/${ledgerPath}?ref=${encodeURIComponent(ref)}`),
    );
    if (
      data.type !== 'file' ||
      data.path !== ledgerPath ||
      data.encoding !== 'base64' ||
      typeof data.size !== 'number' ||
      data.size < 0 ||
      data.size > maxBytes ||
      typeof data.content !== 'string' ||
      !/^[A-Za-z0-9+/=\n]*$/.test(data.content)
    )
      throw new Error('ledger-invalid-response');
    const bytes = Buffer.from(data.content, 'base64');
    if (bytes.length !== data.size || bytes.length > maxBytes)
      throw new Error('ledger-invalid-response');
    return { content: bytes.toString('utf8'), blobSha: sha(data.sha) };
  }
  return {
    async read(): Promise<LedgerSnapshot> {
      const overall = AbortSignal.timeout(60_000);
      const ref = await request(
        overall,
        `git/ref/heads/${accountingBranch}`,
        'GET',
        undefined,
        true,
      );
      if (ref === null) return { value: null, blobSha: null };
      const data = await contents(overall, sha(row(row(ref).object).sha));
      try {
        return { value: JSON.parse(data.content) as unknown, blobSha: data.blobSha };
      } catch {
        throw new Error('ledger-invalid-json');
      }
    },
    async write(previous: LedgerSnapshot, value: unknown, runId: string, attempt: string) {
      const overall = AbortSignal.timeout(60_000);
      if (!/^\d+$/.test(runId) || !/^\d+$/.test(attempt)) throw new Error('ledger-invalid-run');
      const content = `${JSON.stringify(value, null, 2)}\n`;
      if (Buffer.byteLength(content) > maxBytes) throw new Error('ledger-full');
      const message = `Record BrowserStack accounting ${runId} attempt ${attempt}`;
      let commit: string;
      if (previous.blobSha) {
        // GitHub rejects a stale content SHA. Never force or retry a conflicting write.
        const result = row(
          await request(overall, `contents/${ledgerPath}`, 'PUT', {
            message,
            branch: accountingBranch,
            sha: sha(previous.blobSha),
            content: Buffer.from(content).toString('base64'),
          }),
        );
        commit = sha(row(result.commit).sha);
      } else {
        // An orphan branch contains accounting only, with no production-source mutation.
        const tree = row(
          await request(overall, 'git/trees', 'POST', {
            tree: [{ path: ledgerPath, mode: '100644', type: 'blob', content }],
          }),
        );
        const created = row(
          await request(overall, 'git/commits', 'POST', {
            message,
            tree: sha(tree.sha),
            parents: [],
          }),
        );
        commit = sha(created.sha);
        await request(overall, 'git/refs', 'POST', {
          ref: `refs/heads/${accountingBranch}`,
          sha: commit,
        });
      }
      const verified = await contents(overall, commit);
      if (verified.content !== content) throw new Error('ledger-write-mismatch');
      return {
        commit,
        url: `https://github.com/${options.repository}/blob/${commit}/${ledgerPath}`,
      };
    },
  };
}

export function ledgerFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^ledger-(http-\d{3}|invalid-response|request-failed|request-limit|missing-credentials|invalid-json|invalid-run|full|write-mismatch)$/.test(
    message,
  )
    ? message
    : 'ledger-operation-failed';
}
