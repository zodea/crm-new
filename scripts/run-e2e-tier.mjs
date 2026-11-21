import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const [tier, ...args] = process.argv.slice(2)
if (tier !== 'pr' && tier !== 'nightly')
  throw new Error('测试层级应为 pr 或 nightly')

const cli = fileURLToPath(import.meta.resolve('@playwright/test/cli'))
const projects = tier === 'pr' ? ['--project=e2e-ui-parallel', '--project=e2e-central-shard-*'] : []
const run = spawnSync(process.execPath, [cli, 'test', ...projects, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CRM_E2E_TIER: tier,
    CRM_PRODUCTION_ACCEPTANCE: tier === 'nightly' ? '1' : '0',
  },
})
if (run.error)
  throw run.error
process.exitCode = run.status ?? 1
