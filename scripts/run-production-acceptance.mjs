import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('..', import.meta.url))
const id = randomUUID()
const build = `.tmp/production-acceptance-build-${id}`
const output = `.tmp/production-acceptance-output-${id}`
const runDirectory = resolve(project, `.tmp/production-acceptance-run-${id}`)
const report = resolve(runDirectory, 'report.json')
const downloads = resolve(runDirectory, 'downloads')
const entry = resolve(project, output, 'server/index.mjs')
const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096' }

function run(args, environment = env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: project, env: environment, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0)
        done()
      else
        reject(new Error(`生产验收命令未通过：${args[1]}，${signal || code}`))
    })
  })
}

async function main() {
  const temp = resolve(project, '.tmp')
  await mkdir(temp, { recursive: true })
  if ((await lstat(temp)).isSymbolicLink() || await realpath(temp) !== temp)
    throw new Error('生产验收要求项目内真实的 .tmp 目录。')
  await mkdir(downloads, { recursive: true })
  console.info(`生产验收报告：${report}`)
  const nuxt = resolve(project, 'node_modules/nuxt/bin/nuxt.mjs')
  await run([nuxt, 'build'])
  await run([nuxt, 'build', '--extends', resolve(project, 'tests/fixtures/invoice-ledger-layer')], {
    ...env,
    NUXT_BUILD_DIR: build,
    CRM_E2E_BUILD_OUTPUT_DIR: output,
  })
  await run([resolve(project, 'node_modules/@playwright/test/cli.js'), 'test', '--project=production', '--forbid-only', '--reporter=list,json', `--output=${resolve(runDirectory, 'results')}`], {
    ...env,
    CRM_PRODUCTION_ACCEPTANCE: '1',
    CRM_INVOICE_ACCEPTANCE: '1',
    CRM_INVOICE_CORRECTION_ACCEPTANCE: '1',
    CRM_COMPANY_PAYMENT_ACCEPTANCE: '1',
    CRM_E2E_SERVER_ENTRY: entry,
    CRM_INVOICE_E2E_ENTRY: entry,
    CRM_COMPANY_PAYMENT_E2E_ENTRY: entry,
    CRM_INVOICE_E2E_DOWNLOADS: downloads,
    PLAYWRIGHT_JSON_OUTPUT_NAME: report,
  })
  const { stats } = JSON.parse(await readFile(report, 'utf8'))
  if (!stats || stats.expected < 1 || stats.skipped !== 0 || stats.unexpected !== 0 || stats.flaky !== 0)
    throw new Error('生产验收必须全部首次通过，不能包含未执行、失败或重试后通过的用例；请查看报告。')
  console.info(`生产验收全部通过：${stats.expected} 项，0 跳过。`)
}

main().catch((cause) => {
  console.error(cause.message)
  process.exitCode = 1
})
