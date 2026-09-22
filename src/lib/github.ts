// GitHub access without a key. Everything here fits the 60 req/hr unauthenticated limit:
// ~4 API calls + one per district. File contents come from raw.githubusercontent.com,
// which doesn't count against the API limit.

const API = 'https://api.github.com'

export class RateLimitError extends Error {
  resetAt: Date | null
  constructor(resetAt: Date | null) {
    super(`GitHub's hourly limit for visitors without a login is used up.${resetAt ? ` It resets at ${resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''} Try a demo world meanwhile.`)
    this.resetAt = resetAt
  }
}

export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/$/, '')
  const m = s.match(/github\.com\/([\w.-]+)\/([\w.-]+)/) || s.match(/^([\w.-]+)\/([\w.-]+)$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

export class GitHub {
  calls = 0
  token: string | undefined
  constructor(token?: string) {
    // Optional, never asked for in the UI. Power users: localStorage.setItem('github_token', '...')
    try { this.token = token || globalThis.localStorage?.getItem('github_token') || undefined } catch { /* storage blocked */ }
  }

  async api<T>(path: string): Promise<{ data: T; res: Response }> {
    this.calls++
    const res = await fetch(API + path, {
      headers: { Accept: 'application/vnd.github+json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
    })
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = res.headers.get('x-ratelimit-reset')
      throw new RateLimitError(reset ? new Date(+reset * 1000) : null)
    }
    if (res.status === 404) throw new Error('Repository not found. Check the name, or it may be private.')
    if (res.status === 409) throw new Error('This repository is empty.')
    if (!res.ok) throw new Error(`GitHub returned ${res.status}.`)
    return { data: (await res.json()) as T, res }
  }

  async repo(owner: string, repo: string) {
    const { data } = await this.api<any>(`/repos/${owner}/${repo}`)
    return {
      owner: data.owner.login as string,
      name: data.name as string,
      description: (data.description as string | null) ?? '',
      stars: data.stargazers_count as number,
      branch: data.default_branch as string,
      language: (data.language as string | null) ?? '',
    }
  }

  async tree(owner: string, repo: string, branch: string) {
    const { data } = await this.api<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
    return {
      files: data.tree.filter(t => t.type === 'blob').map(t => ({ path: t.path, size: t.size ?? 0 })),
      truncated: data.truncated,
    }
  }

  async contributors(owner: string, repo: string) {
    const { data } = await this.api<any[]>(`/repos/${owner}/${repo}/contributors?per_page=12`).catch(() => ({ data: [] as any[] }))
    return data.filter(c => c.type !== 'Bot' && !String(c.login).endsWith('[bot]'))
      .map(c => ({ login: c.login as string, commits: c.contributions as number }))
  }

  // One call per folder: commit count, last touched, and who works there.
  // Count is exact under 100 commits, estimated from the Link header's last page above that.
  async activity(owner: string, repo: string, path: string) {
    const { data, res } = await this.api<any[]>(`/repos/${owner}/${repo}/commits?per_page=100${path ? `&path=${encodeURIComponent(path)}` : ''}`)
    const last = res.headers.get('link')?.match(/[?&]page=(\d+)>; rel="last"/)
    const commits = last ? (+last[1] - 1) * 100 + 50 : data.length
    const authors: Record<string, number> = {}
    for (const c of data) {
      const who = c.author?.login
      if (who) authors[who] = (authors[who] || 0) + 1
    }
    const newest = data[0]?.commit?.committer?.date
    const lastDays = newest ? Math.floor((Date.now() - Date.parse(newest)) / 86_400_000) : null
    return { commits, lastDays, authors }
  }
}

// File list from jsDelivr's GitHub mirror: no API call, no rate limit.
// It needs a branch name, so try the two common defaults; callers fall back to the API tree.
export async function jsdelivrFiles(owner: string, repo: string, branches = ['main', 'master']) {
  for (const branch of branches) {
    const res = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${encodeURIComponent(branch)}?structure=flat`).catch(() => null)
    if (!res?.ok) continue
    const data = await res.json() as { files: { name: string; size: number }[] }
    return { branch, files: data.files.map(f => ({ path: f.name.slice(1), size: f.size })) }
  }
  return null
}

export async function rawFiles(owner: string, repo: string, branch: string, paths: string[], onEach?: () => void) {
  const out: Record<string, string> = {}
  let i = 0
  const get = async (url: string) => { const res = await fetch(url); return res.ok ? res.text() : null }
  const worker = async () => {
    while (i < paths.length) {
      const p = paths[i++]
      const file = p.split('/').map(encodeURIComponent).join('/')
      try {
        const text = await get(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${encodeURIComponent(branch)}/${file}`).catch(() => null)
          ?? await get(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file}`)
        if (text != null) out[p] = text
      } catch { /* skip unreadable file */ }
      onEach?.()
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker))
  return out
}
