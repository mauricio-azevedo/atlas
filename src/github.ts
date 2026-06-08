export type PullRequest = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  body: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
};

export type PullRequestFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

export type PullRequestSnapshot = {
  repository: string;
  pullRequest: PullRequest;
  files: PullRequestFile[];
};

export class GitHubClient {
  constructor(private readonly token?: string) {}

  async getPullRequestSnapshot(repository: string, prNumber: number): Promise<PullRequestSnapshot> {
    const [owner, repo] = parseRepository(repository);
    const pullRequest = await this.request<PullRequest>(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    const files = await this.requestPaginated<PullRequestFile>(`/repos/${owner}/${repo}/pulls/${prNumber}/files`);

    return { repository, pullRequest, files };
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, { headers: this.headers() });

    if (!response.ok) {
      throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  private async requestPaginated<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let page = 1;

    while (true) {
      const response = await fetch(`https://api.github.com${path}?per_page=100&page=${page}`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
      }

      const pageItems = (await response.json()) as T[];
      items.push(...pageItems);

      if (pageItems.length < 100) {
        return items;
      }

      page += 1;
    }
  }

  private headers() {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }
}

function parseRepository(repository: string) {
  const parts = repository.split('/');

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Repository must use owner/name format.');
  }

  return [parts[0], parts[1]] as const;
}
