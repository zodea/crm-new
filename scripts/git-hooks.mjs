import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// 只拦截有明确用途的目录/缓存名，正式 evidence 下的图片、日志、JSON 仍可提交。
export function isTemporaryPath(path) {
  return /^(?:\.tmp|tmp|temp|\.codex-tmp|\.worktrees|coverage|playwright-report|test-results|blob-report)(?:\/|$)/i.test(path)
    || /^\.(?:claude\/worktrees|codex\/(?:cache|logs|sessions))(?:\/|$)/i.test(path)
    || /(?:^|\/)(?:node_modules|\.output|\.data|\.nuxt|\.nitro|\.cache|dist|\.pnpm-store|\.npm|\.vite|\.vitest|__pycache__|\.pytest_cache|\.ruff_cache)(?:\/|$)/i.test(path)
    || /(?:^|\/)(?:\.eslintcache|\.stylelintcache)$|\.(?:tsbuildinfo|py[cod])$/i.test(path)
}

export function checkStagedPaths(paths) {
  const blocked = paths.filter(isTemporaryPath)
  if (blocked.length)
    throw new Error(`临时目录、工作树或缓存不能提交，请仅取消这些路径的暂存（保留本地文件）：\n${blocked.join('\n')}`)
}

export function isDocumentationPath(path) {
  return /^(?:[^/]+\.md|docs\/.*\.(?:md|txt|log|png|jpe?g|webp|gif|svg|pdf))$/i.test(path)
}

const splitPaths = output => output.split('\0').filter(Boolean)
const isZero = sha => /^0+$/.test(sha)

export function checkPush(input, remote, git, verify) {
  const lines = input.trim().split(/\r?\n/).filter(Boolean)
  const targets = new Set()
  for (const line of lines) {
    const fields = line.split(/\s+/)
    const [, localSha, , remoteSha] = fields
    if (fields.length !== 4 || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(localSha) || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(remoteSha))
      throw new Error('无法识别 Git 推送范围，已阻止推送。')
    if (isZero(localSha))
      continue

    const commit = git(['rev-parse', '--verify', `${localSha}^{commit}`]).trim()
    let base = remoteSha
    if (isZero(remoteSha)) {
      try {
        base = git(['merge-base', commit, `refs/remotes/${remote}/main`]).trim()
      }
      catch {
        base = ''
      }
    }
    // 不做扩展名黑名单：只有已知文档可以跳过，配置/脚本/未知文件均完整验证。
    const paths = splitPaths(base
      ? git(['diff', '--name-only', '--no-renames', '-z', base, commit, '--'])
      : git(['ls-tree', '-r', '--name-only', '-z', commit]))
    if (!base || paths.some(path => !isDocumentationPath(path)))
      targets.add(commit)
  }

  // 无 Git 元数据的手动执行仍是完整验证入口。
  if (!lines.length)
    targets.add(git(['rev-parse', '--verify', 'HEAD']).trim())
  if (!targets.size)
    return false

  const head = git(['rev-parse', '--verify', 'HEAD']).trim()
  if ([...targets].some(target => target !== head))
    throw new Error('待验证的推送版本不是当前 HEAD；请到对应分支的工作目录逐一验证并推送。')

  const assertClean = () => {
    if (git(['rev-parse', '--verify', 'HEAD']).trim() !== head)
      throw new Error('验证期间 HEAD 已变化，请重新推送并验证。')
    const tracked = splitPaths(git(['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--']))
    const untracked = splitPaths(git(['ls-files', '--others', '--exclude-standard', '-z']))
    const dirty = [...tracked, ...untracked].filter(path => !isDocumentationPath(path))
    if (dirty.length)
      throw new Error(`验证内容与待推送提交不一致，请先处理以下源码/配置改动；钩子不会自动暂存或回退：\n${dirty.join('\n')}`)
  }
  assertClean()
  verify()
  assertClean()
  return true
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
}

function verify() {
  // 仅执行固定命令，兼容 Windows 的 .cmd 启动器；不将路径或用户输入插入 shell。
  execSync('pnpm typecheck && pnpm test', { stdio: 'inherit' })
}

function main() {
  const [, , command, argument] = process.argv
  if (command === 'staged') {
    checkStagedPaths(splitPaths(git(['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z'])))
  }
  else if (command === 'push') {
    const checked = checkPush(readFileSync(0, 'utf8'), argument, git, verify)
    console.info(checked ? '推送前类型检查与完整测试已通过。' : '本次仅文档/无内容变化/删除引用，跳过完整验证。')
  }
  else {
    throw new Error('用法：node scripts/git-hooks.mjs staged | push <远端>')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
