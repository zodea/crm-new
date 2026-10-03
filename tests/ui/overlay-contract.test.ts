import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = join(process.cwd(), 'app')
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.vue'])
const LEGACY_LAYER = /--z-shell-(?:modal|overlay|drawer|popover)|shell-layer-(?:overlay|drawer|popover)/g
const RAW_GLOBAL_Z_INDEX = /\bz-\[[1-9]\d{2,}\]|z-index:\s*[1-9]\d{2,}\b/g

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return sourceFiles(path)
    const extension = entry.name.slice(entry.name.lastIndexOf('.'))
    return SOURCE_EXTENSIONS.has(extension) ? [path] : []
  })
}

function matches(pattern: RegExp): string[] {
  return sourceFiles(APP_ROOT).flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    return [...source.matchAll(pattern)].map((match) => {
      const line = source.slice(0, match.index).split('\n').length
      return `${relative(process.cwd(), path)}:${line} ${match[0]}`
    })
  })
}

describe('overlay composition contract', () => {
  it.each([
    { rule: 'legacy layer aliases or classes', pattern: LEGACY_LAYER },
    { rule: 'raw global z-index values', pattern: RAW_GLOBAL_Z_INDEX },
  ])('contains no $rule', ({ pattern }) => {
    expect(matches(pattern)).toEqual([])
  })
})
