// Repo facts -> districts and a dependency graph. Pure functions, no network.

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|vendor|target|bin|obj|coverage|__pycache__|venv|\.venv|\.next|\.nuxt|\.git)(\/|$)/
const HIDDEN_DIR = /(^|\/)\.(?!github\/)[^/]+\//
const TEXT_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'rb', 'php', 'cs', 'c', 'h', 'cpp', 'hpp', 'cc', 'scala', 'ex', 'exs', 'hs', 'lua', 'dart', 'sh', 'sql', 'css', 'scss', 'html', 'md', 'mdx', 'json', 'yml', 'yaml', 'toml'])
export const SOURCE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'go'])
const LOCK = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)|\.map|\.d\.ts)$/

export const ext = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase()
export const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1)
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function keepFile(path: string, size: number) {
  return TEXT_EXT.has(ext(path)) && !SKIP_DIR.test(path) && !HIDDEN_DIR.test(path) && !LOCK.test(path) && size < 1_000_000
}

export type Group = { id: string; path: string; files: string[] }

// Tests, examples and docs: counted, drawn, but never allowed to shape the world or its bosses.
export const SIDELINE = /(^|\/)(tests?|__tests__|spec|e2e|examples?|docs?|benchmarks?|fixtures?)\/|\.(test|spec)\.\w+$/i
const MONOREPO = /(^|\/)(packages|apps|services|modules|crates|libs|plugins)\/$/
const weight = (files: string[]) => files.filter(f => !SIDELINE.test(f)).length

// Top-level folders become districts. A folder holding most of the repo (src/, packages/)
// is split into its children instead, so the world isn't one giant district.
export function pickDistricts(paths: string[], max = 12): Group[] {
  const childrenOf = (prefix: string, files: string[]) => {
    const direct: string[] = []
    const dirs = new Map<string, string[]>()
    for (const f of files) {
      const rest = f.slice(prefix.length)
      const i = rest.indexOf('/')
      if (i < 0) direct.push(f)
      else {
        const d = prefix + rest.slice(0, i + 1)
        dirs.get(d)?.push(f) ?? dirs.set(d, [f])
      }
    }
    return { direct, dirs }
  }

  const top = childrenOf('', paths)
  let groups: Group[] = [...top.dirs].map(([path, files]) => ({ id: path, path, files }))
  const total = weight(paths)
  const tried = new Set<string>()
  for (let round = 0; round < 6; round++) {
    const big = groups.find(g => !tried.has(g.id) && (weight(g.files) > Math.max(4, total * 0.5) || (MONOREPO.test(g.path) && weight(g.files) > 12)))
    if (!big) break
    tried.add(big.id)
    const split = childrenOf(big.path, big.files)
    if (split.dirs.size < 2) continue
    groups = groups.filter(g => g !== big)
    if (split.direct.length) groups.push({ id: big.path, path: big.path, files: split.direct })
    for (const [path, files] of split.dirs) groups.push({ id: path, path, files })
  }

  groups.sort((a, b) => weight(b.files) - weight(a.files) || b.files.length - a.files.length)
  if (groups.length > max - 1) {
    const rest = groups.splice(max - 2)
    groups.push({ id: '*', path: '', files: rest.flatMap(g => g.files) })
  }
  return [{ id: 'root', path: '', files: top.direct }, ...groups].filter(g => g.files.length)
}

export function parseImports(path: string, text: string): string[] {
  const out: string[] = []
  const e = ext(path)
  if (e === 'py') {
    for (const m of text.matchAll(/^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w.]+))/gm)) out.push(m[1] || m[2])
  } else if (e === 'go') {
    for (const block of text.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) for (const m of block[1].matchAll(/"([^"]+)"/g)) out.push(m[1])
    for (const m of text.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)) out.push(m[1])
  } else {
    for (const m of text.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g))
      out.push(m[1] || m[2] || m[3])
  }
  return out
}

function join(dir: string, rel: string) {
  const parts = dir.split('/').filter(Boolean)
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']

// Returns internal files a specifier points at; [] for packages from npm/pypi/etc.
export function resolveImport(from: string, spec: string, files: Set<string>, goModule = ''): string[] {
  const e = ext(from)
  const first = (cands: string[]) => { const hit = cands.find(c => files.has(c)); return hit ? [hit] : [] }

  if (e === 'py') {
    let mod = spec
    let base = ''
    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)![0].length
      base = join(dirOf(from), '../'.repeat(dots - 1))
      mod = spec.slice(dots)
    }
    const rel = mod.replace(/\./g, '/')
    const roots = spec.startsWith('.') ? [base] : ['', 'src', 'lib', 'app']
    return first(roots.flatMap(r => rel ? [join(r, rel + '.py'), join(r, rel + '/__init__.py')] : [join(r, '__init__.py')]))
  }

  if (e === 'go') {
    if (!goModule || !spec.startsWith(goModule)) return []
    const dir = spec.slice(goModule.length).replace(/^\//, '')
    return [...files].filter(f => dirOf(f) === (dir ? dir + '/' : '') && f.endsWith('.go') && !f.endsWith('_test.go'))
  }

  const js = (target: string) => {
    const stem = target.replace(/\.(m|c)?jsx?$/, '')
    return first([target, ...JS_EXT.map(x => stem + x), ...JS_EXT.map(x => target + '/index' + x), ...JS_EXT.map(x => target + '/src/index' + x)])
  }
  if (spec.startsWith('.')) return js(join(dirOf(from), spec))
  if (/^[@~]\//.test(spec)) return js(join('src', spec.slice(2)))
  // Monorepo sibling: 'shared/x' or '@scope/shared/x' -> packages/shared/x
  const parts = spec.split('/')
  const name = spec.startsWith('@') ? parts[1] : parts[0]
  const rest = parts.slice(spec.startsWith('@') ? 2 : 1).join('/')
  for (const root of ['packages/', 'apps/', 'libs/', 'modules/']) {
    if (!name) break
    const hit = js(root + name + (rest ? '/' + rest : ''))
    if (hit.length) return hit
  }
  return []
}

// Top-level names a file defines (functions, classes, exported consts). Used for "which is defined here?" questions.
export function parseExports(path: string, text: string): string[] {
  const e = ext(path)
  const out: string[] = []
  const grab = (re: RegExp) => { for (const m of text.matchAll(re)) out.push(m[1]) }
  if (e === 'py') {
    grab(/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm)
    grab(/^class\s+([A-Za-z]\w*)/gm)
  } else if (e === 'go') {
    grab(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm)
    grab(/^type\s+([A-Z]\w*)/gm)
  } else {
    grab(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)
    grab(/^(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm)
    grab(/^(?:[\w$]+\.)+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/gm) // res.send = function send()
    for (const m of text.matchAll(/^export\s*\{([^}]+)\}/gm))
      for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop()!.trim(); if (/^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default') out.push(n) }
  }
  return [...new Set(out)]
}

// External packages a file uses (for boss abilities).
export function externalPackages(from: string, specs: string[]) {
  const e = ext(from)
  return [...new Set(specs.filter(s => !s.startsWith('.') && !/^[@~]\//.test(s))
    .map(s => e === 'go' ? s.split('/').pop()! : s.startsWith('@') ? s.split('/')[1] ?? s : s.split(/[/.]/)[0])
    .filter(s => s && !['react', 'fs', 'path', 'os', 'sys', 'fmt', 'typing', 'node:fs', 'node:path', 'strings', 'errors'].includes(s)))]
}
