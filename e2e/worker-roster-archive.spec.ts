import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { PayrollC1Action, PayrollC1FormRead } from '../app/lib/payroll/central-c1-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createPayrollRepository } from '../app/lib/payroll/central-repository'
import { createWorkerRosterRepository } from '../app/lib/worker-roster/repository'

const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
test.use({ actionTimeout: 15000 })
async function fixture(page: Page, info: TestInfo) {
  const reset = await page.request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const sessionId = `worker-roster-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
  const access = (allowed: boolean) => page.request.post('/api/testing/worker-roster/access', { headers: { 'x-ruihang-test-reset': '1' }, data: { allowed } })
  const granted = await access(true)
  expect(granted.ok(), await granted.text()).toBe(true)
  const fetcher = async (path: string, options?: { method?: 'POST', body?: unknown, query?: Record<string, unknown> }) => {
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
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: new Date().toISOString(), immutable: true } } })
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
  return { roster, payroll, access, projectId, leader, zero, statementId: saved.statementId! }
}
async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
}
function unzip(bytes: Buffer) {
  const files: { name: string, data: Buffer }[] = []
  let offset = 0
  while (offset + 30 < bytes.length && bytes.readUInt32LE(offset) === 0x04034B50) {
    const length = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    const begin = offset + 30 + nameLength + extraLength
    files.push({ name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), data: bytes.subarray(begin, begin + length) })
    offset = begin + length
  }
  return files
}

test('工人整页维护、工资成员归档、冷回读、真实照片 ZIP 与权限撤销', async ({ page }, info) => {
  test.setTimeout(240000)
  const pageErrors: string[] = []
  page.on('pageerror', cause => pageErrors.push(cause.message))
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  const f = await fixture(page, info)
  await page.goto(`/base/worker/private/${f.leader}?origin=real`)
  await expect(page.locator('[data-ui="entity-form-shell"]').getByRole('heading', { name: '工人私密资料', exact: true })).toBeVisible({ timeout: 30000 })
  expect(pageErrors).toEqual([])
  await page.getByLabel('签订情况', { exact: true }).selectOption('true')
  await page.getByLabel('签订日期', { exact: true }).fill('2026-08-01')
  await page.getByRole('link', { name: '编辑工人主档', exact: true }).click()
  const leaveDialog = page.getByRole('dialog', { name: '放弃资料修改', exact: true })
  await expect(leaveDialog).toBeVisible()
  await leaveDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('签订日期', { exact: true })).toHaveValue('2026-08-01')
  await page.getByLabel('上传证件照', { exact: true }).setInputFiles({ name: '证件照.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByLabel('上传银行卡照', { exact: true }).setInputFiles({ name: '银行卡.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByRole('button', { name: '保存资料与照片', exact: true }).click()
  await expect(page.getByText('资料版本 2；', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('签订情况', { exact: true })).toHaveValue('true')
  await expect(page.getByLabel('签订日期', { exact: true })).toHaveValue('2026-08-01')
  await capture(page, info, 'worker-private')
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await page.locator('#section-photos').scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`worker-photos-${width}.png`), animations: 'disabled' })
  }
  await page.goto(`/subcontract/payroll/roster?origin=real&project=${f.projectId}`)
  await page.getByLabel(`选择工资 ${f.statementId}`, { exact: true }).check()
  await page.getByLabel('资料登记日期', { exact: true }).fill('2026-09-22')
  await page.getByRole('button', { name: '核对所选 1 份工资的名册', exact: true }).click()
  const table = page.getByRole('region', { name: '名册成员', exact: true })
  await expect(table).toContainText('无考勤零收款成员')
  await expect(table).toContainText('440101199001011234')
  await page.route('**/api/commands/worker-roster', async (route) => {
    const applied = await route.fetch()
    expect(applied.ok(), await applied.text()).toBe(true)
    await route.fulfill({ status: 503, json: { data: { code: 'unavailable', message: '验收：提交已保存但响应丢失' } } })
  }, { times: 1 })
  await page.getByRole('button', { name: '按当前预览归档新版本', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '核对原提交', exact: true }).click()
  await expect(page.getByText('已归档版本 1', { exact: true })).toBeVisible()
  expect(await f.roster.archives(f.projectId)).toHaveLength(1)
  await expect(table).toContainText('6222000000001234')
  await capture(page, info, 'roster-archive')
  const scroll = page.getByLabel('实名名册横向滚动区域')
  await scroll.focus()
  await page.keyboard.press('ArrowRight')
  await expect(scroll).toBeFocused()
  await expect.poll(() => scroll.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载名册与照片 ZIP', exact: true }).click()
  const download = await downloading
  const output = info.outputPath('archive.zip')
  await download.saveAs(output)
  const files = unzip(await readFile(output))
  expect(files.filter(file => file.name.startsWith('photos/'))).toHaveLength(2)
  expect(files.filter(file => file.name.startsWith('photos/')).every(file => file.data.equals(PHOTO))).toBe(true)
  const book = XLSX.read(files.find(file => file.name.endsWith('.xlsx'))!.data, { type: 'buffer' })
  expect(XLSX.utils.sheet_to_json(book.Sheets['实名名册']!)).toHaveLength(2)
  const versions = await f.roster.archives(f.projectId)
  const original = await f.roster.archive(f.projectId, versions[0]!.id)
  expect(original.members.some(member => member.workerId === f.zero)).toBe(true)
  await page.goto(`/base/worker/private/${f.leader}?origin=real`)
  await page.getByLabel('签订日期', { exact: true }).fill('2026-09-20')
  await page.getByLabel('上传证件照', { exact: true }).setInputFiles({ name: '后来补充证件照.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByRole('button', { name: '保存资料与照片', exact: true }).click()
  await expect(page.getByText('资料版本 3；', { exact: false })).toBeVisible()
  await page.goto(`/subcontract/payroll/roster?origin=real&project=${f.projectId}`)
  await page.getByLabel(`选择工资 ${f.statementId}`, { exact: true }).check()
  await page.getByLabel('资料登记日期', { exact: true }).fill('2026-09-23')
  await page.getByRole('button', { name: '核对所选 1 份工资的名册', exact: true }).click()
  await page.getByRole('button', { name: '按当前预览归档新版本', exact: true }).click()
  await expect(page.getByText('已归档版本 2', { exact: true })).toBeVisible()
  const newer = await f.roster.archive(f.projectId, (await f.roster.archives(f.projectId)).find(row => row.version === 2)!.id)
  expect(newer.scope.registeredOn).toBe('2026-09-23')
  expect(newer.members.find(member => member.workerId === f.leader)!.values.portraitId).not.toBe(original.members.find(member => member.workerId === f.leader)!.values.portraitId)
  expect((await f.roster.archive(f.projectId, original.id)).members).toEqual(original.members)
  const oldPhoto = original.members.find(member => member.workerId === f.leader)!.photos[0]!
  expect((await f.roster.file({ projectId: f.projectId, archiveId: original.id, workerId: f.leader, assetId: oldPhoto.id })).payloadBase64).toBe(PHOTO.toString('base64'))
  await f.access(false)
  const denied = await page.request.get('/api/read/worker-roster/archive', { params: { projectId: f.projectId, archiveId: original.id } })
  expect(denied.status()).toBe(403)
  expect(await denied.text()).not.toContain('440101199001011234')
  expect((await page.request.get(`/api/read/workers/${f.leader}/form`)).status()).toBe(403)
  await page.getByRole('button', { name: '下载名册与照片 ZIP', exact: true }).click()
  await expect(page.locator('[data-ui="entity-form-shell"]').getByText('当前身份没有工人私密资料读取权限', { exact: true })).toBeVisible()
  await expect(page.getByText('440101199001011234', { exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
