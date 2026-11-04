import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../../app/lib/migration/core-contract'
import type { PayrollC1Action, PayrollC1FormRead } from '../../app/lib/payroll/central-c1-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import { createWorkerRosterRepository } from '../../app/lib/worker-roster/repository'

export const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
export async function preparePayrollRosterWorkspace(page: Page, info: TestInfo) {
  const reset = await page.request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const sessionId = `worker-roster-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
  const access = (allowed: boolean) => page.request.post('/api/testing/worker-roster/access', { headers: { 'x-ruihang-test-reset': '1' }, data: { allowed } })
  const granted = await access(true)
  expect(granted.ok(), await granted.text()).toBe(true)
  const fetcher = async (path: string, options?: { method?: 'GET' | 'POST' | 'PUT', body?: unknown, query?: Record<string, unknown> }) => {
    const response = await page.request.fetch(path, { method: options?.method ?? 'GET', params: options?.query ? Object.fromEntries(Object.entries(options.query).map(([key, value]) => [key, String(value)])) : undefined, data: options?.body })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const payroll = createPayrollRepository(fetcher)
  const roster = createWorkerRosterRepository(fetcher)
  const sourceFile = info.outputPath('source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-c1-migration-source.ts'), sourceFile, randomUUID()])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(sourceFile, 'utf8'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const response = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const mapped = (entityType: string, legacyId: string) => batch.mappings.find(row => row.entityType === entityType && row.legacyId === legacyId)!.serverId!
  const projectId = mapped('projects', 'c1-live')
  const leader = mapped('workers', 'c1-live-leader')
  const zero = mapped('workers', 'c1-live-zero')
  const crewId = mapped('crews', 'c1-live-crew')
  const isolated = await page.request.post('/api/testing/worker-roster/prepare', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(isolated.ok(), await isolated.text()).toBe(true)
  expect((await access(true)).ok()).toBe(true)
  const workerResponse = await page.request.get(`/api/read/workers/${leader}/form`)
  expect(workerResponse.ok(), await workerResponse.text()).toBe(true)
  const workerForm = await workerResponse.json()
  const workerSave = await page.request.put(`/api/commands/workers/${leader}`, { data: { id: leader, workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'worker:write', commandId: randomUUID(), baseVersion: workerForm.version, action: 'draft', draft: { ...workerForm.draft, name: '名册负责人', gender: '男', hometown: '广东', idCard: '440101199001011234', phone: '13800000001', bankName: '测试银行', bankAccount: '6222000000001234', projectStatus: '在场', entryDate: '2026-08-01' }, attachments: {} } })
  expect(workerSave.ok(), await workerSave.text()).toBe(true)
  const matrix = await payroll.attendanceMatrix({ origin: 'real' }, { projectId, month: '2026-08', crewId })
  await payroll.executeAttendance({ commandId: randomUUID(), workspaceId: session.workspaceId, actorId: session.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId: leader, crewId, workDate: '2026-08-01', hours: 8, overtimeHours: 0, workContent: '名册验收真实考勤', note: '' } } })
  const draft = { projectId, crewId, leaderWorkerId: leader, memberWorkerIds: [leader, zero], month: '2026-08', note: '名册不可变版本验收' }
  const command = (read: PayrollC1FormRead, action: PayrollC1Action) => payroll.executeC1({ commandId: randomUUID(), workspaceId: session.workspaceId, actorId: session.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, statementId: read.statementId, draftKey: read.draftKey, configScope: null, action })
  const saved = await command(await payroll.c1Form({ origin: 'real' }, { statementId: null, draftKey: randomUUID(), draft }), { kind: 'save-c1-draft', draft })
  const form = () => payroll.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
  await command(await form(), { kind: 'check-c1' })
  await command(await form(), { kind: 'release-c1', release: { actualAmount: 480, allocations: [{ workerId: leader, amount: 480 }, { workerId: zero, amount: 0 }] } })
  return { roster, payroll, access, projectId, crewId, session, leader, zero, statementId: saved.statementId! }
}
