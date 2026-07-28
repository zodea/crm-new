import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = process.cwd()
const APP_ROOT = join(PROJECT_ROOT, 'app')
const DESIGN_ROOT = join(
  PROJECT_ROOT,
  'DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d',
)
const DESIGN_TOKEN_PATH = join(
  DESIGN_ROOT,
  'tokens/content-v5.css',
)
const DESIGN_STYLES_PATH = join(DESIGN_ROOT, 'styles.css')
const DESIGN_MANIFEST_PATH = join(DESIGN_ROOT, '_ds_manifest.json')
const DESIGN_HTML_PATH = join(PROJECT_ROOT, 'DC重构设计源码/app.dc.html')
const APP_TOKEN_BRIDGE_PATH = join(PROJECT_ROOT, 'app/assets/css/tokens.css')
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.vue'])
const RUNTIME_TOKEN_PREFIXES = ['--reka-']

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return sourceFiles(path)
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : []
  })
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function matches(source: string, pattern: RegExp): Set<string> {
  return new Set(Array.from(source.matchAll(pattern), match => match[1]))
}

function importedCssFiles(entry: string, visited = new Set<string>()): string[] {
  if (visited.has(entry))
    return []
  visited.add(entry)

  const source = readFileSync(entry, 'utf8')
  const imports = Array.from(
    source.matchAll(/@import\s+["']([^"']+\.css)["'];/g),
    match => resolve(dirname(entry), match[1]),
  )

  return [
    ...imports.flatMap(path => importedCssFiles(path, visited)),
    entry,
  ]
}

function tokenEntries(file: string) {
  const source = withoutComments(readFileSync(file, 'utf8'))
  return Array.from(
    source.matchAll(/^\s*(--[\w-]+):([^;]+);/gm),
    match => ({
      name: match[1],
      value: match[2].replace(/\s+/g, ' ').trim(),
      definedIn: relative(DESIGN_ROOT, file).replaceAll('\\', '/'),
    }),
  )
}

describe('design token contract', () => {
  it('defines every product CSS variable consumed by the app', () => {
    expect(existsSync(DESIGN_TOKEN_PATH)).toBe(true)

    const designTokenFiles = importedCssFiles(DESIGN_TOKEN_PATH)
    const files = [
      ...sourceFiles(APP_ROOT),
      join(PROJECT_ROOT, 'uno.config.ts'),
      ...designTokenFiles,
    ]
    const source = files
      .map(file => withoutComments(readFileSync(file, 'utf8')))
      .join('\n')
    const references = matches(source, /var\(\s*(--[\w-]+)/g)
    const definitions = matches(source, /(?:^|[;{,\s'"`])(--[\w-]+)['"`]?\s*:/gm)
    const missing = [...references]
      .filter(token => !definitions.has(token))
      .filter(token => !RUNTIME_TOKEN_PREFIXES.some(prefix => token.startsWith(prefix)))
      .sort()

    expect(missing).toEqual([])
  })

  it('keeps shared control and overlay aliases in the canonical token source', () => {
    const definitions = matches(
      withoutComments(readFileSync(DESIGN_TOKEN_PATH, 'utf8')),
      /(?:^|[;{,\s])(--[\w-]+)\s*:/gm,
    )

    const requiredTokens = [
      '--radius-control',
      '--shadow-dialog',
      '--shadow-float',
    ]

    for (const token of requiredTokens)
      expect(definitions.has(token), token).toBe(true)
  })

  it('keeps one owner for each global token across the design entry and app bridge', () => {
    const owners = new Map<string, string[]>()
    const ownerFiles = [
      ...importedCssFiles(DESIGN_TOKEN_PATH),
      APP_TOKEN_BRIDGE_PATH,
    ]

    for (const file of ownerFiles) {
      const definitions = matches(
        withoutComments(readFileSync(file, 'utf8')),
        /(?:^|[;{,\s])(--[\w-]+)\s*:/gm,
      )
      for (const token of definitions)
        owners.set(token, [...(owners.get(token) ?? []), file])
    }

    const duplicates = [...owners]
      .filter(([, files]) => files.length > 1)
      .map(([token, files]) => `${token}: ${files.join(', ')}`)
      .sort()

    expect(duplicates).toEqual([])
  })

  it('keeps the generated manifest aligned with the complete active CSS import graph', () => {
    const manifest = JSON.parse(readFileSync(DESIGN_MANIFEST_PATH, 'utf8'))
    const activeTokens = importedCssFiles(DESIGN_STYLES_PATH)
      .flatMap(tokenEntries)

    expect(manifest.globalCssPaths).toEqual(['styles.css'])
    expect(manifest.tokens.map((token: {
      name: string
      value: string
      definedIn: string
    }) => ({
      name: token.name,
      value: token.value,
      definedIn: token.definedIn,
    }))).toEqual(activeTokens)
  })

  it('wires spacing, current design styles and the Nuxt bridge through explicit entries', () => {
    const designTokens = readFileSync(DESIGN_TOKEN_PATH, 'utf8')
    const designStyles = readFileSync(DESIGN_STYLES_PATH, 'utf8')
    const designHtml = readFileSync(DESIGN_HTML_PATH, 'utf8')
    const appBridge = readFileSync(APP_TOKEN_BRIDGE_PATH, 'utf8')

    expect(designTokens).toMatch(/^@import "\.\/typography\.css";\r?\n@import "\.\/spacing\.css";/)
    expect(designStyles).toContain('@import "./tokens/content-v5.css";')
    expect(designStyles).not.toContain('@import "./tokens/colors.css";')
    expect(designStyles).not.toContain('@import "./tokens/spacing.css";')
    expect(designStyles).not.toContain('@import "./tokens/typography.css";')
    expect(designHtml.match(/<link rel="stylesheet"/g)).toHaveLength(1)
    expect(designHtml).toContain('crm-e3d87120-cf57-4b83-8a9b-188c305f529d/styles.css')
    expect(appBridge).toMatch(/^@import ".+\/tokens\/content-v5\.css";/)
  })
})
