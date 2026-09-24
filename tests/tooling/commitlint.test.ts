import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const cli = createRequire(import.meta.url).resolve('@commitlint/cli/cli.js')

function lint(message: string) {
  return spawnSync(process.execPath, [cli, '--color=false'], { input: message, encoding: 'utf8' })
}

describe('commitlint 项目接入', () => {
  it.each([
    'chore(repo): 使用 commitlint 校验提交说明',
    'fix(api): Nuxt API 返回中文错误信息',
    'feat(api)!: 调整接口\n\nBREAKING CHANGE: 移除旧接口\n\nRefs: #493',
    'Merge pull request #493 from zodea/example',
    'Revert "fix: 修正问题"',
  ])('真实 CLI 接受项目正常说明：%s', (message) => {
    const result = lint(message)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })

  it.each([
    ['更新', 'type-empty'],
    ['unknown(repo): 修改', 'type-enum'],
    ['fix: ', 'subject-empty'],
    [`docs(repo): ${'长'.repeat(101)}`, 'header-max-length'],
    [`docs(repo): 更新说明\n\n${'长'.repeat(101)}`, 'body-max-line-length'],
  ])('真实 CLI 拒绝错误说明并报告具体规则', (message, rule) => {
    const result = lint(message)
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain(rule)
  })
})
