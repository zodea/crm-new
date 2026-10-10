import type { Page, TestInfo } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import type { PayrollC1Action, PayrollC1FormRead } from '../app/lib/payroll/central-c1-contract'
import type { PayrollWorkbookArchive } from '../app/lib/payroll/central-workbook-contract'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { PHOTO, preparePayrollRosterWorkspace } from './helpers/payroll-roster-workspace'
import { migratePayrollWorkbookWorkspace } from './helpers/payroll-workbook-roundtrip'

test.use({ actionTimeout: 15000 })
async function fixture(page: Page, info: TestInfo) {
  const f = await preparePayrollRosterWorkspace(page, info)
  const matrix = await f.payroll.attendanceMatrix({ origin: 'real' }, { projectId: f.projectId, month: '2026-09', crewId: f.crewId })
  await f.payroll.executeAttendance({ commandId: randomUUID(), workspaceId: f.session.workspaceId, actorId: f.session.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: matrix.context.sourceVersion, projectId: f.projectId, scope: matrix.scope, action: { kind: 'upsert-attendance', record: { workerId: f.leader, crewId: f.crewId, workDate: '2026-09-01', hours: 8, overtimeHours: 0, workContent: '跨月完整工资册', note: '' } } })
  const draft = { projectId: f.projectId, crewId: f.crewId, leaderWorkerId: f.leader, memberWorkerIds: [f.leader, f.zero], month: '2026-09', note: '第二月份固定工资' }
  const command = (read: PayrollC1FormRead, action: PayrollC1Action) => f.payroll.executeC1({ commandId: randomUUID(), workspaceId: f.session.workspaceId, actorId: f.session.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: f.projectId, statementId: read.statementId, draftKey: read.draftKey, configScope: null, action })
  const saved = await command(await f.payroll.c1Form({ origin: 'real' }, { statementId: null, draftKey: randomUUID(), draft }), { kind: 'save-c1-draft', draft })
  const form = () => f.payroll.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
  await command(await form(), { kind: 'check-c1' })
  await command(await form(), { kind: 'release-c1', release: { actualAmount: 470, allocations: [{ workerId: f.leader, amount: 470 }, { workerId: f.zero, amount: 0 }] } })
  const privateRead = await f.roster.profile(f.leader)
  const upload = { fileName: '原照片.png', mimeType: 'image/png', fileSize: PHOTO.length, payloadBase64: PHOTO.toString('base64') }
  await f.roster.execute({ commandId: randomUUID(), workspaceId: privateRead.context.workspaceId, actorId: privateRead.context.actorId, origin: 'real', sourceVersion: privateRead.sourceVersion, action: 'save-profile', workerId: f.leader, values: { ...privateRead.values, laborContractSigned: true, laborContractSignedOn: '2026-08-01' }, uploads: { 'portrait': upload, 'bank-card': upload } })
  const scope = { projectId: f.projectId, statementIds: [f.statementId, saved.statementId!].sort(), registeredOn: '2026-09-22' }
  const preview = await f.roster.preview(scope)
  const archived = await f.roster.execute({ commandId: randomUUID(), workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', sourceVersion: preview.sourceVersion, action: 'archive', scope })
  return { ...f, statementIds: scope.statementIds, secondStatementId: saved.statementId!, rosterId: archived.archiveId! }
}
function unzip(bytes: Buffer) {
  const files: Array<{ name: string, data: Buffer }> = []
  let offset = 0
  while (offset + 30 < bytes.length && bytes.readUInt32LE(offset) === 0x04034B50) {
    const length = bytes.readUInt32LE(offset + 18)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28)
    files.push({ name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), data: bytes.subarray(start, start + length) })
    offset = start + length
  }
  return files
}
async function download(page: Page, info: TestInfo, button: string, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const file = await pending
  const path = info.outputPath(name)
  await file.saveAs(path)
  return readFile(path)
}

async function issueAndArchive(f: Awaited<ReturnType<typeof fixture>>) {
  const query = { origin: 'real' as const, projectId: f.projectId }
  const numbered = await f.payroll.numbering(query, { projectId: f.projectId, statementId: null })
  await f.payroll.executeNumbering({ schemaVersion: 1, commandId: randomUUID(), workspaceId: numbered.context.workspaceId, actorId: numbered.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: numbered.context.sourceVersion, projectId: f.projectId, statementId: null, action: { kind: 'initialize', nextNumber: 128, evidenceNote: '完整图真实迁入验收：旧号核对至127' } })
  for (const statementId of f.statementIds) {
    const read = await f.payroll.numbering(query, { projectId: f.projectId, statementId })
    await f.payroll.executeNumbering({ schemaVersion: 1, commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: f.projectId, statementId, action: { kind: 'issue' } })
  }
  const archives: PayrollWorkbookArchive[] = []
  for (const mode of ['leader-cycle', 'project-month'] as const) {
    const input = { projectId: f.projectId, mode, statementIds: f.statementIds, rosterArchiveId: f.rosterId }
    const preview = await f.payroll.workbookPreview(query, input)
    const result = await f.payroll.executeWorkbook({ schemaVersion: 1, commandId: randomUUID(), workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: preview.sourceVersion, input, action: 'archive' })
    archives.push(await f.payroll.workbookArchive(query, { projectId: f.projectId, archiveId: result.archiveId }))
  }
  return archives
}

test('现代完整工资图经实际快照公开迁入后，两种历史目录仍可重下原编号名册与照片', async ({ page }, info) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  const f = await fixture(page, info)
  const originals = await issueAndArchive(f)
  const imported = await migratePayrollWorkbookWorkspace(page, info, f.projectId)
  const query = { origin: 'real' as const, projectId: imported.projectId }
  const summaries = await f.payroll.workbookArchives(query, { projectId: imported.projectId })
  expect(summaries).toHaveLength(2)
  const proof: unknown[] = []
  for (const original of originals) {
    const summary = summaries.find(row => row.mode === original.input.mode)!
    const archive = await f.payroll.workbookArchive(query, { projectId: imported.projectId, archiveId: summary.id })
    expect(archive.migration).toEqual({ originalId: original.id, originalContentHash: original.manifestHash })
    expect(archive.manifestHash).toBe(original.manifestHash)
    expect(archive.rosterRef?.contentHash).toBe(original.rosterRef?.contentHash)
    expect(archive.rosterRef?.id).not.toBe(original.rosterRef?.id)
    expect(archive.issues.map(row => [row.number, row.documentHash])).toEqual(original.issues.map(row => [row.number, row.documentHash]))
    await page.goto(`/subcontract/payroll/workbooks?origin=real&project=${encodeURIComponent(imported.projectId)}&archive=${encodeURIComponent(summary.id)}`)
    await expect(page.getByRole('region', { name: '已保存目录下载', exact: true })).toBeVisible({ timeout: 45000 })
    const bytes = await download(page, info, '下载工资、名册与照片 ZIP', `migrated-${summary.mode}.zip`)
    const files = unzip(bytes)
    const manifest = JSON.parse(files.find(file => file.name === '00-保存目录.json')!.data.toString('utf8'))
    expect(manifest.migrationNotice).toContain('本代身份已映射')
    expect(manifest.manifestHash).toBe(original.manifestHash)
    expect(files.filter(file => file.name.startsWith('photos/'))).toHaveLength(2)
    expect(files.filter(file => file.name.startsWith('photos/')).every(file => file.data.equals(PHOTO))).toBe(true)
    const payrollFiles = files.filter(file => file.name.endsWith('.xlsx') && file.name !== '01-实名名册.xlsx')
    expect(payrollFiles).toHaveLength(summary.mode === 'leader-cycle' ? 1 : 2)
    for (const file of payrollFiles) {
      const workbook = XLSX.read(file.data)
      expect(XLSX.utils.sheet_to_json(workbook.Sheets.实名名册!)).toHaveLength(2)
      if (summary.mode === 'leader-cycle')
        expect(XLSX.utils.sheet_to_json(workbook.Sheets.周期对账!)).toEqual([expect.objectContaining({ 公式应付: 962, 净实际: 950, 差额: 12 })])
      else
        expect(XLSX.utils.sheet_to_json(workbook.Sheets.月度对账!)).toEqual([expect.objectContaining({ 公式应付: 481, 净实际: file.name.startsWith('2026-08/') ? 480 : 470 })])
    }
    proof.push({ mode: summary.mode, originalId: original.id, mappedId: archive.id, manifestHash: archive.manifestHash, rosterRef: archive.rosterRef, formalNumbers: archive.issues.map(row => row.number), zipSha256: createHash('sha256').update(bytes).digest('hex'), files: files.map(file => file.name) })
  }
  await page.getByRole('region', { name: '已保存目录下载', exact: true }).scrollIntoViewIfNeeded()
  await writeFile(info.outputPath('migration-files.json'), JSON.stringify({ ...imported, proof }, null, 2))
  expect(errors).toEqual([])
})

test('两月工资从正式出具到两种固定目录、实际名册照片文件及丢响应冷恢复', async ({ page }, info) => {
  test.setTimeout(300000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
    window.print = () => {
      (window as unknown as { workbookPrints: number }).workbookPrints = 1
    }
  })
  const f = await fixture(page, info)
  await page.goto(`/subcontract/payroll?origin=real&project=${encodeURIComponent(f.projectId)}`)
  await page.getByRole('link', { name: '完整工作簿', exact: true }).click()
  await expect(page.getByLabel('负责人请款簿')).toBeVisible({ timeout: 45000 })
  await page.getByLabel('负责人请款簿').selectOption({ index: 1 })
  await page.getByLabel('名册归档版本').selectOption(f.rosterId)
  await page.getByRole('button', { name: '核对当前范围与固定版本', exact: true }).click()
  await expect(page.getByRole('region', { name: '工资目录预览', exact: true })).toContainText('尚未正式出具')
  await page.getByRole('link', { name: '核对正式出具', exact: true }).first().click()
  await page.getByLabel('下一张正式编号', { exact: true }).fill('128')
  await page.getByLabel('旧纸号核对依据', { exact: true }).fill('核对旧纸号至127，本项目下一张128')
  await page.getByRole('button', { name: '登记项目起点', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认登记起点', exact: true }).click()
  await page.getByRole('button', { name: '确认预览并正式出具', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '正式出具', exact: true }).click()
  await expect(page.getByText('正式工资编号：128', { exact: true })).toBeVisible()
  const firstIssued = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!)
  for (const statementId of f.statementIds.filter(id => id !== firstIssued)) {
    const read = await f.payroll.numbering({ origin: 'real', projectId: f.projectId }, { projectId: f.projectId, statementId })
    await f.payroll.executeNumbering({ schemaVersion: 1, commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: f.projectId, statementId, action: { kind: 'issue' } })
  }
  await page.getByRole('button', { name: '打印正式工资', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { workbookPrints: number }).workbookPrints)).toBe(1)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.payroll-c1-print')).toBeVisible()
  const pdf = await page.pdf({ path: info.outputPath('official-from-directory.pdf'), printBackground: true, preferCSSPageSize: true })
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const printed = await getDocument({ data: new Uint8Array(pdf) }).promise
  expect(printed.numPages).toBeGreaterThanOrEqual(2)
  const printText: string[] = []
  for (let index = 1; index <= printed.numPages; index++) {
    const content = await (await printed.getPage(index)).getTextContent()
    printText.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join(''))
  }
  expect(printText.join('')).toContain('128')
  expect(printText.join('')).toContain('考勤')
  await printed.destroy()
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await page.getByRole('button', { name: '返回原工资', exact: true }).last().click()
  await expect(page.getByLabel('名册归档版本')).toHaveValue(f.rosterId)
  await page.getByRole('button', { name: '核对当前范围与固定版本', exact: true }).click()
  await expect(page.getByRole('region', { name: '工资目录预览', exact: true })).toContainText('129')
  let lost = false
  await page.route('**/api/commands/payroll-workbook', async (route) => {
    if (lost)
      return route.continue()
    lost = true
    const response = await route.fetch()
    expect(response.ok(), await response.text()).toBe(true)
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收：目录已保存但响应丢失' }) })
  })
  await page.getByRole('button', { name: '保存当前目录版本', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原保存结果', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '核对原保存结果', exact: true }).click()
  await expect(page.getByRole('region', { name: '已保存目录下载', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/[?&]archive=payroll-workbook-/)
  const cycleUrl = page.url()
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await writeFile(info.outputPath(`layout-${width}.json`), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-shell-workspace], [data-ui=entity-form-shell], [data-ui=entity-form-layout], [data-ui=entity-form-content], #section-scope, #section-preview, select')].map(node => ({ tag: node.tagName, id: node.id, classes: node.className, width: node.getBoundingClientRect().width, left: node.getBoundingClientRect().left, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }))), null, 2))
    await expect.poll(() => page.locator('[data-shell-workspace]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    const table = page.getByLabel('目录工资明细', { exact: true })
    await table.focus()
    await expect(table).toBeFocused()
    if (width === 390) {
      await table.press('ArrowRight')
      await expect.poll(() => table.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    }
    await page.locator('[data-shell-workspace]').evaluate((node) => {
      node.scrollTop = 0
      node.scrollLeft = 0
    })
  }
  await page.getByRole('region', { name: '已保存目录下载', exact: true }).scrollIntoViewIfNeeded()
  const plain = XLSX.read(await download(page, info, '下载工资 XLSX', 'cycle-public.xlsx'))
  expect(plain.SheetNames).not.toContain('实名名册')
  expect(XLSX.utils.sheet_to_json(plain.Sheets.目录!)).toHaveLength(2)
  const cycleBytes = await download(page, info, '下载工资、名册与照片 ZIP', 'cycle-private.zip')
  const cycle = unzip(cycleBytes)
  expect(cycle.filter(file => file.name.startsWith('photos/'))).toHaveLength(2)
  expect(cycle.filter(file => file.name.startsWith('photos/')).every(file => file.data.equals(PHOTO))).toBe(true)
  const cycleBook = XLSX.read(cycle.find(file => file.name.endsWith('.xlsx') && file.name !== '01-实名名册.xlsx')!.data)
  expect(XLSX.utils.sheet_to_json(cycleBook.Sheets.实名名册!)).toHaveLength(2)
  expect(XLSX.utils.sheet_to_json(cycleBook.Sheets.周期对账!)).toEqual([expect.objectContaining({ 公式应付: 962, 净实际: 950, 差额: 12 })])
  await page.getByLabel('输出方式').selectOption('project-month')
  await page.getByLabel('名册归档版本').selectOption(f.rosterId)
  await page.getByRole('button', { name: '核对当前范围与固定版本', exact: true }).click()
  await page.getByRole('button', { name: '保存当前目录版本', exact: true }).click()
  await expect(page.getByRole('region', { name: '已保存目录下载', exact: true })).toBeVisible()
  await page.getByRole('region', { name: '已保存目录下载', exact: true }).scrollIntoViewIfNeeded()
  const month = unzip(await download(page, info, '下载工资、名册与照片 ZIP', 'month-private.zip'))
  for (const [period, actual] of [['2026-08', 480], ['2026-09', 470]] as const) {
    const workbook = XLSX.read(month.find(file => file.name.startsWith(`${period}/`) && file.name.endsWith('.xlsx'))!.data)
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.月度对账!)).toEqual([expect.objectContaining({ 公式应付: 481, 净实际: actual, 差额: 481 - actual })])
    expect(workbook.SheetNames.some(name => name.includes('考勤'))).toBe(true)
  }
  const profile = await f.roster.profile(f.leader)
  await f.roster.execute({ commandId: randomUUID(), workspaceId: profile.context.workspaceId, actorId: profile.context.actorId, origin: 'real', sourceVersion: profile.sourceVersion, action: 'save-profile', workerId: f.leader, values: { ...profile.values, portraitId: null }, uploads: {} })
  await page.goto(cycleUrl)
  await expect(page.getByRole('region', { name: '已保存目录下载', exact: true })).toBeVisible()
  const repeated = unzip(await download(page, info, '下载工资、名册与照片 ZIP', 'cycle-reopened.zip'))
  expect(repeated.find(file => file.name === '00-保存目录.json')!.data).toEqual(cycle.find(file => file.name === '00-保存目录.json')!.data)
  expect(repeated.filter(file => file.name.startsWith('photos/')).every(file => file.data.equals(PHOTO))).toBe(true)
  expect((await f.access(false)).ok()).toBe(true)
  await page.getByRole('button', { name: '下载工资、名册与照片 ZIP', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '私密' })).toBeVisible()
  await expect(page.getByRole('region', { name: '已保存目录下载', exact: true })).toHaveCount(0)
  await writeFile(info.outputPath('file-validation.json'), JSON.stringify({ cycleBytes: cycleBytes.length, cycleSha256: createHash('sha256').update(cycleBytes).digest('hex'), cycleFiles: cycle.map(file => file.name), monthFiles: month.map(file => file.name), printPages: printText.length, printText }, null, 2))
  expect(pageErrors).toEqual([])
})
