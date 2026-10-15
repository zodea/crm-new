import { execFileSync, spawnSync } from 'node:child_process'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { checkPush, checkStagedPaths } from '../../scripts/git-hooks.mjs'

const head = 'a'.repeat(40)
const previous = 'b'.repeat(40)
const other = 'c'.repeat(40)
const zero = '0'.repeat(40)
const pushLine = (local = head, remote = previous) => `refs/heads/main ${local} refs/heads/main ${remote}\n`

function environment(options: {
  paths?: string[]
  tracked?: string[]
  untracked?: string[]
  missingBase?: boolean
  failDiff?: boolean
} = {}) {
  const state = { head, tracked: options.tracked || [] }
  const git = vi.fn((args: string[]): string => {
    if (args[0] === 'rev-parse')
      return args[2] === 'HEAD' ? state.head : args[2]!.replace(/\^\{commit\}$/, '')
    if (args[0] === 'merge-base') {
      if (options.missingBase)
        throw new Error('没有主干引用')
      return previous
    }
    if (args[0] === 'ls-files')
      return (options.untracked || []).join('\0')
    if (args[0] === 'diff' && args.includes('HEAD'))
      return state.tracked.join('\0')
    if (args[0] === 'diff' || args[0] === 'ls-tree') {
      if (options.failDiff)
        throw new Error('无法读取推送范围')
      return (options.paths || ['app/example.ts']).join('\0')
    }
    throw new Error(`未预期的 Git 调用：${args.join(' ')}`)
  })
  const verify = vi.fn()
  const run = (input = pushLine()) => checkPush(input, 'origin', git, verify)
  return { state, git, verify, run }
}

describe('暂存路径保护', () => {
  it.each([
    '.tmp/render.png',
    '.codex-tmp/task/output.json',
    '.worktrees/another-task',
    'tmp/helper.mjs',
    'temp/log.txt',
    '.claude/worktrees/agent',
    '.codex/sessions/run.jsonl',
    '.nuxt/types.d.ts',
    'node_modules/example/index.js',
    '.pnpm-store/v10/index',
    'coverage/report.json',
    'scripts/__pycache__/helper.pyc',
    '.eslintcache',
    'app.tsbuildinfo',
  ])('阻止误暂存的产物 %s', (path) => {
    expect(() => checkStagedPaths([path])).toThrow('不能提交')
  })

  it.each([
    'app/components/Template.vue',
    'scripts/git-hooks.mjs',
    'docs/guides/export.md',
    'docs/design/evidence/example/screenshot.png',
    'docs/design/evidence/example/verification.log',
    'docs/design/evidence/example/result.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.codex/config.toml',
    '.agents/skills/example/SKILL.md',
  ])('允许源码、正式证据、共享 AI 配置与文档：%s', (path) => {
    expect(() => checkStagedPaths([path])).not.toThrow()
  })
})

describe('推送范围与版本一致性', () => {
  it('已知文档和证据图片范围跳过完整检查', () => {
    const env = environment({ paths: ['README.md', 'docs/guides/说明 空格.md', 'docs/design/evidence/example/390.png'] })
    expect(env.run()).toBe(false)
    expect(env.verify).not.toHaveBeenCalled()
  })

  it.each(['.lintstagedrc', '.gitattributes', '.gitignore', '.github/workflows/ci.yml', 'scripts/check.sh', '.husky/commit-msg', 'pnpm-lock.yaml', 'app/assets/css/tokens.css', 'unknown.extension'])('配置/脚本/未知文件 %s 不得被当成文档', (path) => {
    const env = environment({ paths: [path] })
    expect(env.run()).toBe(true)
    expect(env.verify).toHaveBeenCalledOnce()
  })

  it.each([
    { tracked: ['app/fixed-but-uncommitted.ts'] },
    { tracked: ['.lintstagedrc'] },
    { untracked: ['server/new-module.ts'] },
  ])('本地源码或配置与提交不同则在测试前阻止', (options) => {
    const env = environment(options)
    expect(() => env.run()).toThrow('验证内容与待推送提交不一致')
    expect(env.verify).not.toHaveBeenCalled()
  })

  it('本地无关文档不阻止代码推送', () => {
    const env = environment({ tracked: ['README.md'], untracked: ['docs/research/notes.md'] })
    expect(env.run()).toBe(true)
  })

  it('非当前分支的代码版本不能借当前工作区测试过关', () => {
    const env = environment()
    expect(() => env.run(pushLine(other))).toThrow('不是当前 HEAD')
    expect(env.verify).not.toHaveBeenCalled()
  })

  it('多引用中任何不同代码版本都会阻止，不能只验证其中一个', () => {
    const env = environment()
    expect(() => env.run(pushLine() + pushLine(other))).toThrow('不是当前 HEAD')
    expect(env.verify).not.toHaveBeenCalled()
  })

  it('多个引用指向同一提交只验证一次', () => {
    const env = environment()
    expect(env.run(pushLine() + pushLine())).toBe(true)
    expect(env.verify).toHaveBeenCalledOnce()
  })

  it('新分支比较主干共同祖先', () => {
    const env = environment({ paths: ['README.md'] })
    expect(env.run(pushLine(head, zero))).toBe(false)
    expect(env.git).toHaveBeenCalledWith(['merge-base', head, 'refs/remotes/origin/main'])
  })

  it('找不到新分支基准时保守执行完整验证', () => {
    const env = environment({ missingBase: true, paths: ['README.md'] })
    expect(env.run(pushLine(head, zero))).toBe(true)
    expect(env.verify).toHaveBeenCalledOnce()
  })

  it('删除引用不执行测试', () => {
    const env = environment()
    expect(env.run(`(delete) ${zero} refs/heads/old ${previous}\n`)).toBe(false)
    expect(env.git).not.toHaveBeenCalled()
    expect(env.verify).not.toHaveBeenCalled()
  })

  it('手动调用无推送元数据时仍完整验证', () => {
    const env = environment()
    expect(env.run('')).toBe(true)
    expect(env.verify).toHaveBeenCalledOnce()
  })

  it('范围读取失败不能静默放行', () => {
    const env = environment({ failDiff: true })
    expect(() => env.run()).toThrow('无法读取推送范围')
    expect(env.verify).not.toHaveBeenCalled()
  })

  it('元数据损坏不能静默放行', () => {
    const env = environment()
    expect(() => env.run('invalid input')).toThrow('无法识别 Git 推送范围')
  })

  it('检查失败阻止推送', () => {
    const env = environment()
    env.verify.mockImplementation(() => {
      throw new Error('测试失败')
    })
    expect(() => env.run()).toThrow('测试失败')
  })

  it.each(['head', 'files'])('验证期间 %s 变化也阻止推送', (change) => {
    const env = environment()
    env.verify.mockImplementation(() => {
      if (change === 'head')
        env.state.head = other
      else
        env.state.tracked = ['app/changed-during-tests.ts']
    })
    expect(() => env.run()).toThrow(change === 'head' ? 'HEAD 已变化' : '验证内容与待推送提交不一致')
  })

  it('重命名保留旧路径判断，不能将源码改名为文档后跳过', () => {
    const env = environment({ paths: ['app/old.ts', 'docs/old.md'] })
    expect(env.run()).toBe(true)
    expect(env.git).toHaveBeenCalledWith(['diff', '--name-only', '--no-renames', '-z', previous, head, '--'])
  })
})

describe('项目 gitignore 的实际行为', () => {
  it('忽略 AI 临时目录和缓存，保留共享配置与正式证据', () => {
    const ignored = ['.tmp/check.txt', '.codex-tmp/render.png', '.worktrees/test/.git', 'tmp/tool.py', '.codex/cache/item', '.codex/sessions/run.jsonl', '.eslintcache', 'scripts/__pycache__/tool.pyc', 'app.tsbuildinfo', 'coverage/index.html']
    const deliverables = ['scripts/git-hooks.mjs', 'AGENTS.md', 'CLAUDE.md', '.codex/config.toml', '.agents/skills/example/SKILL.md', 'docs/design/evidence/example/390.png']
    const result = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      input: [...ignored, ...deliverables].join('\n'),
      encoding: 'utf8',
    }).trim().split(/\r?\n/)
    expect(result).toEqual(ignored)
  })
})

describe('真实 Node 钩子入口', () => {
  it('实际接收 Git 的删除引用输入，不启动完整验证', () => {
    const result = spawnSync(process.execPath, ['scripts/git-hooks.mjs', 'push', 'origin'], {
      input: `(delete) ${zero} refs/heads/old ${previous}\n`,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('跳过完整验证')
  })

  it('实际读取本仓库同版本引用，确认没有差异后跳过', () => {
    const current = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const result = spawnSync(process.execPath, ['scripts/git-hooks.mjs', 'push', 'origin'], {
      input: pushLine(current, current),
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('跳过完整验证')
  })

  it('入口以非零状态返回元数据错误，Git 可以据此阻止推送', () => {
    const result = spawnSync(process.execPath, ['scripts/git-hooks.mjs', 'push', 'origin'], {
      input: 'malformed input\n',
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('无法识别 Git 推送范围')
  })
})
