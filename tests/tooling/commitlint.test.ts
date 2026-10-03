import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const cli = createRequire(import.meta.url).resolve('@commitlint/cli/cli.js')
const cliTimeoutMs = 30_000

async function lint(message: string): Promise<{ status: number | null, output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--color=false'], { timeout: cliTimeoutMs })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (status, signal) => {
      if (signal)
        reject(new Error(`commitlint 未正常结束：${signal}\n${output}`))
      else
        resolve({ status, output })
    })
    child.stdin.end(message)
  })
}

describe('commitlint 项目接入', () => {
  it.each([
    'chore(repo): 使用 commitlint 校验提交说明',
    'fix(api): Nuxt API 返回中文错误信息',
    'feat(api)!: 调整接口\n\nBREAKING CHANGE: 移除旧接口\n\nRefs: #493',
    'Merge pull request #493 from zodea/example',
    'Revert "fix: 修正问题"',
    `docs: ${'长'.repeat(94)}`,
    `docs: 更新说明\n\n${'长'.repeat(100)}`,
  ])('真实 CLI 接受项目正常说明：%s', async (message) => {
    const result = await lint(message)
    expect(result.status, result.output).toBe(0)
  }, cliTimeoutMs + 5_000)

  it.each([
    ['更新', 'type-empty'],
    ['unknown(repo): 修改', 'type-enum'],
    ['fix: ', 'subject-empty'],
    [`docs: ${'长'.repeat(95)}`, 'header-max-length'],
    [`docs(repo): 更新说明\n\n${'长'.repeat(101)}`, 'body-max-line-length'],
  ])('真实 CLI 拒绝错误说明并报告具体规则：%s', async (message, rule) => {
    const result = await lint(message)
    expect(result.status).not.toBe(0)
    expect(result.output).toContain(rule)
  }, cliTimeoutMs + 5_000)
})
