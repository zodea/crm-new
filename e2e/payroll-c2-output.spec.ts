import type { PayrollC2Action, PayrollC2Command, PayrollC2CommandRead, PayrollC2Draft } from '../app/lib/payroll/central-c2-contract'
import type { PayrollDayworkCommand, PayrollDayworkRecordDraft } from '../app/lib/payroll/central-daywork-contract'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { payrollC2Workspace } from './helpers/payroll-c2-workspace'

function command(read: PayrollC2CommandRead, action: PayrollC2Action): PayrollC2Command {
  return { commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'scope' in read ? read.scope.projectId : read.draft.projectId!, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, configId: 'scope' in read ? read.config?.id ?? null : null, action }
}

test('真实长签工发放后两表分页与下载回读，精确单价及明确空规则不被改写', async ({ page }, info) => {
  test.setTimeout(240000)
  const { repository, project, leader, ledger } = await payrollC2Workspace(page, '2027-03')
  const member = ledger.options.workers.find(worker => worker.name === '签工成员')!
  const zero = ledger.options.workers.find(worker => worker.name === '无签工零收款成员')!
  const query = { origin: 'real' as const }
  const scope = { projectId: project.id, leaderWorkerId: leader.id }
  await repository.executeC2(command(await repository.c2Config(query, scope), { kind: 'save-c2-config', config: { crewId: leader.crewId, unitRate: 350.125, ruleText: '' } }))
  const sourceIds: string[] = []
  const labels: string[] = []
  // 公开 HTTP 逐日登记形成长表；没有手写工资快照或替换浏览器读取。
  for (let day = 1; day <= 28; day++) {
    for (const [worker, units] of [[leader, 1], [member, 0.5]] as const) {
      const label = `签工${String(day).padStart(2, '0')}${units === 1 ? '甲' : '乙'}`
      labels.push(label)
      const record: PayrollDayworkRecordDraft = { projectId: project.id, crewId: leader.crewId, workerId: worker.id, workDate: `2027-03-${String(day).padStart(2, '0')}`, startTime: '08:00', endTime: units === 1 ? '17:00' : '12:00', laborUnits: units, status: 'confirmed', witness: '现场长名称证明人甲乙丙丁', confirmedOn: '2027-03-31', workContent: `${label}：逐项核实楼梯间细部修补、材料搬运及收尾施工。保留原施工内容与人工证明，长表分页后仍能逐条核对本月原记录。`, note: `${label}原备注` }
      const read = await repository.dayworkForm(query, { recordId: null, draftKey: randomUUID(), draft: record })
      const saving: PayrollDayworkCommand = { commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: project.id, recordId: null, draftKey: read.draftKey, originalScope: null, action: { kind: 'save-daywork', record } }
      sourceIds.push((await repository.executeDaywork(saving)).recordId)
    }
  }
  const draft: PayrollC2Draft = { projectId: project.id, crewId: leader.crewId, leaderWorkerId: leader.id, memberWorkerIds: [leader.id, member.id, zero.id], month: '2027-03', note: '长签工分页与实际文件验收' }
  const first = await repository.c2Form(query, { statementId: null, draftKey: 'c2-long-output', draft })
  const saved = await repository.executeC2(command(first, { kind: 'save-c2-draft', draft }))
  const statementId = saved.statementId!
  await repository.executeC2(command(await repository.c2Form(query, { statementId }), { kind: 'check-c2' }))
  const checked = await repository.c2Form(query, { statementId })
  expect(checked.totals.grossAmount.value).toBe(14705.25)
  await repository.executeC2(command(checked, { kind: 'release-c2', release: { actualAmount: 14000, allocations: [{ workerId: leader.id, amount: 9000 }, { workerId: member.id, amount: 5000 }, { workerId: zero.id, amount: 0 }] } }))
  const before = await repository.c2Output(query, statementId)
  expect(before.state).toBe('available')
  if (before.state !== 'available')
    throw new Error('长表必须来自实际公开发放')
  expect(before.document.daywork).toHaveLength(56)
  expect(before.document.config.ruleText).toBe('')
  // 后来修改主体规则与价格，不可改变已经发放的两份原表。
  await repository.executeC2(command(await repository.c2Config(query, scope), { kind: 'save-c2-config', config: { crewId: leader.crewId, unitRate: 399, ruleText: '后来修改的规则不得覆盖旧空规则' } }))
  expect((await repository.c2Output(query, statementId)).document).toEqual(before.document)
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  await page.goto(`/subcontract/payroll/${statementId}?origin=real`)
  await expect(page.getByRole('button', { name: '下载工资与签工表', exact: true })).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载工资与签工表', exact: true }).click()
  const file = await downloaded
  const path = info.outputPath(file.suggestedFilename())
  await file.saveAs(path)
  const book = XLSX.read(await readFile(path))
  expect(book.SheetNames).toEqual(['工资表', '签工表'])
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.签工表!, { header: 1, defval: null })
  expect(rows[2]).toEqual(['计算规则', '', null, null, null, null, null, null, null])
  expect(rows.slice(4, 60)).toHaveLength(56)
  expect(rows.slice(4, 60).filter(row => row[4] === 0.5)).toHaveLength(28)
  for (const label of labels) expect(JSON.stringify(rows)).toContain(`${label}原备注`)
  const wageRows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.工资表!, { header: 1 })
  expect(wageRows.some(row => row[0] === zero.name && row[2] === 0)).toBe(true)
  expect(wageRows.filter(row => row[3] === 350.125)).toHaveLength(2)
  await page.emulateMedia({ media: 'print' })
  const bytes = await page.pdf({ path: info.outputPath('c2-long-paired-output.pdf'), printBackground: true, preferCSSPageSize: true })
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise
  const texts: string[] = []
  for (let index = 1; index <= pdf.numPages; index++) {
    const content = await (await pdf.getPage(index)).getTextContent()
    texts.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join('').normalize('NFKC').replace(/\s+/g, ''))
  }
  expect(pdf.numPages).toBeGreaterThan(3)
  for (const label of labels) expect(texts.join('')).toContain(label)
  expect(texts.filter(text => text.includes('施工内容') && text.includes('姓名/日期')).length).toBeGreaterThan(1)
  expect(texts.join('')).toContain('已明确保存为空规则')
  expect(texts.join('')).not.toContain('后来修改的规则')
  expect(texts.join('')).toContain('14,000.00')
  expect(texts.join('')).toContain('签字确认并按手印')
  expect(texts.at(-1)).toContain('现场负责人')
  await writeFile(info.outputPath('long-output-verification.json'), JSON.stringify({ statementId, sourceIds, pageCount: pdf.numPages, texts, frozenRule: before.document.config.ruleText, laterConfigurationDoesNotChangeOutput: true, realWorkbookRows: rows }, null, 2))
  await pdf.destroy()
  await page.emulateMedia({ media: 'screen' })
  expect((await repository.c2Output(query, statementId)).document).toEqual(before.document)
})
