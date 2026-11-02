/** This client exposes only reserved-label mutations. GitHub's App permission
 * is Pull requests: write, which is broader than this client interface.
 * Credentials never travel to a payload-controlled URL or a redirect. */
export class PrGitHub {
  readonly repository: string;
  readonly routerAppId: number | undefined;
  private readonly token: string;
  private readonly transport: typeof fetch;

  constructor(
    repository: string,
    token: string,
    transport: typeof fetch = fetch,
    routerAppId: string | undefined = process.env.SPINEL_CI_ROUTER_APP_ID,
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token)
      throw new Error('A repository and GitHub token are required.');
    if (
      routerAppId !== undefined &&
      routerAppId !== '' &&
      (typeof routerAppId !== 'string' ||
        !/^[1-9][0-9]*$/.test(routerAppId) ||
        !Number.isSafeInteger(Number(routerAppId)))
    )
      throw new Error('The CI router App ID must be a positive safe integer.');
    this.repository = repository;
    this.routerAppId =
      routerAppId === undefined || routerAppId === '' ? undefined : Number(routerAppId);
    this.token = token;
    this.transport = transport;
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    if (!/^[a-z][a-z0-9/.-]*(?:\?[^#]*)?$/.test(path) || path.includes('..'))
      throw new Error('Invalid repository API path.');
    const response = await this.transport(
      `https://api.github.com/repos/${this.repository}/${path}`,
      {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`GitHub ${method} ${path.split('?')[0]} returned ${response.status}.`);
    return response.status === 204 ? null : response.json();
  }

  get(path: string): Promise<unknown> {
    return this.request(path);
  }

  async list(path: string, key: string): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await this.get(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      const batch =
        key === ''
          ? result
          : result && typeof result === 'object'
            ? (result as Record<string, unknown>)[key]
            : undefined;
      if (!Array.isArray(batch)) throw new Error(`Missing GitHub collection ${key}.`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error(`GitHub collection ${key} exceeded the bounded pagination limit.`);
  }

  async addLabel(number: number, label: string): Promise<void> {
    if (!Number.isSafeInteger(number) || number <= 0 || label !== 'ci-revalidate')
      throw new Error('Only the reserved CI label may be changed.');
    await this.request(`issues/${number}/labels`, 'POST', { labels: [label] });
  }

  async removeLabel(number: number, label: string): Promise<void> {
    if (!Number.isSafeInteger(number) || number <= 0 || label !== 'ci-revalidate')
      throw new Error('Only the reserved CI label may be changed.');
    await this.request(`issues/${number}/labels/${label}`, 'DELETE');
  }
}
