import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../../app/lib/migration/core-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'

export function payrollC1Repository(page: Page) {
  return createPayrollRepository(async (path, options) => {
    const response = await page.request.fetch(path, { method: options?.method || 'GET', params: options?.query ? Object.fromEntries(Object.entries(options.query).map(([key, value]) => [key, String(value)])) : undefined, data: options?.body })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  })
}

/** 每条用例独立迁入真实 SQLite 来源，避免跨测试依赖。 */
export async function payrollC1Workspace(page: Page, month: string, info: TestInfo) {
  await preparePayrollC1Fixture(page, info)
  const repository = payrollC1Repository(page)
  const options = await repository.attendanceMatrix({ origin: 'real' }, { projectId: '', month, crewId: null })
  const matches = options.options.projects.filter(project => project.name.startsWith('C1 无工程量验收 '))
  expect(matches, '需要本用例唯一真实迁入项目').toHaveLength(1)
  const project = matches[0]!
  const matrix = await repository.attendanceMatrix({ origin: 'real' }, { projectId: project.id, month, crewId: null })
  const leader = matrix.workers.find(worker => worker.name === '日薪481负责人')!
  expect(leader?.eligible).toBe(true)
  return { repository, project, leader, matrix }
}

export async function preparePayrollC1Fixture(page: Page, info: TestInfo) {
  const output = info.outputPath('source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-c1-migration-source.ts'), output, randomUUID()])
  const prepared = JSON.parse(await readFile(output, 'utf8'))
  const { source, snapshotSha256, byteLength } = prepared
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const reset = await page.request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const response = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const mapped = (entityType: string, legacyId: string) => {
    const row = batch.mappings.find(row => row.entityType === entityType && row.legacyId === legacyId)
    expect(row?.serverId).toBeTruthy()
    return row!.serverId!
  }
  const f = { project: mapped('projects', 'c1-live'), crew: mapped('crews', 'c1-live-crew'), leader: mapped('workers', 'c1-live-leader'), worker: mapped('workers', 'c1-live-worker'), zero: mapped('workers', 'c1-live-zero'), historicalProject: mapped('projects', 'c1-project'), batchId: batch.batchId }
  await writeFile(info.outputPath('identities.json'), JSON.stringify(f, null, 2))
  return f
}
