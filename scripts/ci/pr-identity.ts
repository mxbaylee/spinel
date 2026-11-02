export const REVALIDATE_LABEL = 'ci-revalidate';

export const codeCheckNames = [
  'Backlog',
  'Lint',
  'Typecheck',
  'Unit tests',
  'Lib tests',
  'Playwright smoke',
] as const;

export interface PullRequestIdentity {
  number: number;
  repository: string;
  headRepository: string;
  base: string;
  head: string;
  tested: string | null;
  baseRef: string;
  headRef: string;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
}

export interface CodeRunIdentity {
  number: number;
  base: string;
  head: string;
  tested: string;
  full: boolean;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
const repository = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const ref = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !/[\x00-\x20\x7f]/.test(value);
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** An unknown edit remains a full-validation request. Only the exact documented
 * title/body change shape qualifies for cheap policy work. */
export function exactTextEdit(raw: unknown): boolean {
  if (!object(raw) || raw.action !== 'edited' || !object(raw.changes)) return false;
  const entries = Object.entries(raw.changes);
  return (
    entries.length > 0 &&
    entries.every(([field, change]) => {
      if (!['title', 'body'].includes(field) || !object(change)) return false;
      const keys = Object.keys(change);
      return (
        keys.length === 1 &&
        keys[0] === 'from' &&
        (typeof change.from === 'string' || (field === 'body' && change.from === null))
      );
    })
  );
}

/** Do not infer missing source/repository identities from mutable branch names.
 * A merge SHA may be unavailable while GitHub computes mergeability; callers
 * must explicitly wait for or reject that state before admitting code evidence. */
export function parsePullRequestEvent(
  raw: unknown,
  expectedRepository: string,
): PullRequestIdentity {
  if (!repository(expectedRepository) || !object(raw) || !object(raw.pull_request))
    throw new Error('Invalid pull request event identity.');
  const pr = raw.pull_request;
  if (
    !object(raw.repository) ||
    raw.repository.full_name !== expectedRepository ||
    !number(raw.number) ||
    pr.number !== raw.number ||
    !object(pr.base) ||
    !object(pr.head) ||
    !object(pr.base.repo) ||
    pr.base.repo.full_name !== expectedRepository ||
    !object(pr.head.repo) ||
    !repository(pr.head.repo.full_name) ||
    !sha(pr.base.sha) ||
    !sha(pr.head.sha) ||
    !ref(pr.base.ref) ||
    !ref(pr.head.ref) ||
    typeof pr.title !== 'string' ||
    !(typeof pr.body === 'string' || pr.body === null) ||
    (pr.state !== 'open' && pr.state !== 'closed') ||
    !(pr.merge_commit_sha === undefined || pr.merge_commit_sha === null || sha(pr.merge_commit_sha))
  )
    throw new Error('Invalid pull request event identity.');
  return {
    number: raw.number,
    repository: expectedRepository,
    headRepository: pr.head.repo.full_name,
    base: pr.base.sha,
    head: pr.head.sha,
    tested: typeof pr.merge_commit_sha === 'string' ? pr.merge_commit_sha : null,
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    title: pr.title,
    body: pr.body,
    state: pr.state,
  };
}

/** The run name binds the eligible event to its immutable range. It identifies
 * which code run to inspect; it is not a successful validation result. */
export function parseCodeRunName(raw: unknown): CodeRunIdentity {
  const match =
    typeof raw === 'string'
      ? /^CI pr=([1-9][0-9]*) base=([a-f0-9]{40}) head=([a-f0-9]{40}) tested=([a-f0-9]{40}) full=([01])$/.exec(
          raw,
        )
      : null;
  if (
    !match ||
    match[0] !== raw ||
    !number(Number(match[1])) ||
    ![match[2], match[3], match[4]].every(sha)
  )
    throw new Error('Invalid CI run identity.');
  return {
    number: Number(match[1]),
    base: match[2],
    head: match[3],
    tested: match[4],
    full: match[5] === '1',
  };
}

export function formatCodeRunName(identity: CodeRunIdentity): string {
  if (typeof identity.full !== 'boolean') throw new Error('Invalid CI run identity.');
  const name = `CI pr=${identity.number} base=${identity.base} head=${identity.head} tested=${identity.tested} full=${identity.full ? 1 : 0}`;
  parseCodeRunName(name);
  return name;
}
