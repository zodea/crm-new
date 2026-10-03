import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../../app/lib/migration/core-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'

/** Re-export the actual daily workspace SQLite, then use the public migration lifecycle. */
export async function migratePayrollWorkbookWorkspace(page: Page, info: TestInfo, originalProjectId: string) {
  const response = await page.request.get('/api/testing/worker-roster/snapshot', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(response.ok(), await response.text()).toBe(true)
  const snapshot = await response.json()
  const bytes = Buffer.from(snapshot.payloadBase64, 'base64')
  expect(bytes.length).toBe(snapshot.byteLength)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(snapshot.snapshotSha256)
  const snapshotPath = info.outputPath('actual-named-workspace-test-clone.sqlite')
  const sourcePath = info.outputPath('actual-workbook-source.json')
  await writeFile(snapshotPath, bytes)
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-workbook-snapshot-source.ts'), snapshotPath, sourcePath])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(sourcePath, 'utf8'))
  expect(snapshotSha256).toBe(snapshot.snapshotSha256)
  const reset = await page.request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `worker-roster-${randomUUID()}` })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const result = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(result.ok(), await result.text()).toBe(true)
  }
  const prepared = await page.request.post('/api/testing/worker-roster/prepare', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(prepared.ok(), await prepared.text()).toBe(true)
  const access = await page.request.post('/api/testing/worker-roster/access', { headers: { 'x-ruihang-test-reset': '1' }, data: { allowed: true } })
  expect(access.ok(), await access.text()).toBe(true)
  const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === originalProjectId)?.serverId
  expect(projectId).toBeTruthy()
  return { projectId: projectId!, snapshotSha256, byteLength, batchId: batch.batchId }
}
