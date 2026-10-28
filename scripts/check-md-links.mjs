import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import process from 'node:process'
import { isMainModule } from './is-main-module.mjs'

// 只检查相对文件目标；外链、站内锚点和协议链接不在本脚本范围。
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i

export function extractLinks(text) {
  const links = []
  let fenced = false
  text.split(/\r?\n/).forEach((raw, index) => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced
      return
    }
    if (fenced)
      return
    const line = raw.replace(/`[^`]*`/g, '')
    for (const match of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
      const target = match[1].replace(/^<|>$/g, '')
      if (target && !EXTERNAL.test(target))
        links.push({ line: index + 1, target })
    }
  })
  return links
}

export function resolveTarget(source, target) {
  if (WINDOWS_ABSOLUTE.test(target))
    return null
  let path = target.split('#')[0].split('?')[0]
  try {
    path = decodeURIComponent(path)
  }
  catch {}
  if (!path)
    return source
  return normalize(join(dirname(source), path)).replace(/\\/g, '/')
}

/**
 * @param {string[]} files 待检查的 Markdown（仓库相对路径）
 * @param {{ read: (path: string) => string, exists: (path: string) => boolean, only?: (source: string, resolved: string | null) => boolean }} io
 */
export function findBrokenLinks(files, { read, exists, only = () => true }) {
  const broken = []
  for (const source of files) {
    for (const { line, target } of extractLinks(read(source))) {
      const resolved = resolveTarget(source, target)
      if ((resolved === null || !exists(resolved)) && only(source, resolved))
        broken.push({ source, line, target })
    }
  }
  return broken
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const splitPaths = output => output.split('\0').filter(Boolean)

function main() {
  const staged = process.argv.includes('--staged')
  const tracked = splitPaths(git(['ls-files', '-z', '--', '*.md'])).filter(existsSync)
  let files = tracked
  let only

  if (staged) {
    // 只拦截本次引入的断链：暂存的 Markdown，以及仍指向本次删除/改名旧路径的文档，不因历史断链阻止提交。
    const changed = new Set(splitPaths(git(['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z', '--', '*.md'])))
    const removed = new Set(splitPaths(git(['diff', '--cached', '--name-only', '--diff-filter=D', '--no-renames', '-z'])))
    for (const path of splitPaths(git(['diff', '--cached', '--name-status', '--diff-filter=R', '-z'])).filter((_, i) => i % 3 === 1))
      removed.add(path)
    if (!changed.size && !removed.size)
      return
    files = removed.size ? tracked : tracked.filter(path => changed.has(path))
    only = (source, resolved) => changed.has(source) || (resolved !== null && removed.has(resolved))
  }

  const broken = findBrokenLinks(files, {
    read: path => readFileSync(path, 'utf8'),
    exists: existsSync,
    only,
  })
  if (broken.length) {
    console.error(`发现 ${broken.length} 处失效的 Markdown 相对链接：`)
    for (const { source, line, target } of broken)
      console.error(`  ${source}:${line} -> ${target}`)
    process.exitCode = 1
  }
  else if (!staged) {
    console.info(`已检查 ${files.length} 个 Markdown 文件，相对链接均有效。`)
  }
}

if (isMainModule(import.meta.url))
  main()
