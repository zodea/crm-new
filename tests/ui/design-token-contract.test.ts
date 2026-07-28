import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = process.cwd()
const APP_ROOT = join(PROJECT_ROOT, 'app')
const DESIGN_TOKEN_PATH = join(
  PROJECT_ROOT,
  'DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/tokens/content-v5.css',
)
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

describe('design token contract', () => {
  it('defines every product CSS variable consumed by the app', () => {
    expect(existsSync(DESIGN_TOKEN_PATH)).toBe(true)

    const files = [
      ...sourceFiles(APP_ROOT),
      join(PROJECT_ROOT, 'uno.config.ts'),
      DESIGN_TOKEN_PATH,
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
})
