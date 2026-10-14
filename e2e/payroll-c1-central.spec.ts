import type { Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { preparePayrollC1Fixture as fixture, payrollC1Repository as repository } from './helpers/payroll-c1-workspace'

test.use({ actionTimeout: 15000 })
async function capture(page: Page, name: string, selector?: string, horizontal?: 'last-day' | 'totals' | 'normal-totals' | 'source-values') {
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    if (selector)
      await page.locator(selector).first().evaluate(node => node.scrollIntoView({ block: 'center' }))
    if (horizontal === 'totals')
      await page.locator('[data-ui="attendance-grid-scroll"]').evaluate(node => node.scrollLeft = node.scrollWidth - node.clientWidth)
    if (horizontal === 'normal-totals') {
      const normal = page.getByRole('columnheader', { name: '正常工时', exact: true })
      await expect.poll(() => normal.evaluate((column) => {
        const scroll = column.closest('[data-ui="attendance-grid-scroll"]')!
        const worker = scroll.querySelector('.c1-attendance-worker')!
        const bounds = scroll.getBoundingClientRect()
        const fixedWidth = worker.getBoundingClientRect().width
        const cell = column.getBoundingClientRect()
        scroll.scrollLeft += cell.left - bounds.left - fixedWidth - (bounds.width - fixedWidth - cell.width) / 2
        const visible = column.getBoundingClientRect()
        return visible.left >= worker.getBoundingClientRect().right - 1 && visible.right <= scroll.getBoundingClientRect().right + 1
      })).toBe(true)
      const worker = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '日薪480工人', exact: true }) })
      await expect(worker.getByRole('cell').nth(31)).toHaveText('7.51')
    }
    if (horizontal === 'source-values')
      await page.locator('#section-source > .overflow-x-auto').evaluate(node => node.scrollLeft = node.scrollWidth - node.clientWidth)
    if (horizontal === 'last-day') {
      const lastDay = page.getByRole('button', { name: '日薪480工人 2026-08-31 考勤', exact: true })
      await lastDay.evaluate((button) => {
        const scroll = button.closest('[data-ui="attendance-grid-scroll"]')!
        const worker = scroll.querySelector('.c1-attendance-worker')!
        const cell = button.getBoundingClientRect()
        const bounds = scroll.getBoundingClientRect()
        const fixedWidth = worker.getBoundingClientRect().width
        scroll.scrollLeft += cell.left - bounds.left - fixedWidth - (bounds.width - fixedWidth - cell.width) / 2
      })
      await lastDay.click({ trial: true })
      await lastDay.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(lastDay).toBeFocused()
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 960 })
}
async function cell(page: Page, name: string, date: string, hours: string, overtime: string) {
  await page.getByRole('button', { name: `${name} ${date} 考勤`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('正常工时', { exact: true }).fill(hours)
  await dialog.getByLabel('加班工时', { exact: true }).fill(overtime)
  await dialog.getByLabel('施工内容', { exact: true }).fill(`${date} 原施工内容`)
  const response = page.waitForResponse(response => response.url().endsWith('/api/commands/payroll-attendance') && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: '保存考勤', exact: true }).click()
  const saved = await response
  expect(saved.ok(), await saved.text()).toBe(true)
  await expect(dialog).toHaveCount(0)
}
test('无工程量项目考勤、个人标准、C1核对实发、原键恢复与配对冻结输出', async ({ page }, info) => {
  test.setTimeout(420000)
  const f = await fixture(page, info)
  const repo = repository(page)
  const query = { origin: 'real' as const }
  const matrixPath = `/subcontract/attendance?${new URLSearchParams({ origin: 'real', project: f.project, month: '2026-08', crew: f.crew, status: '["draft","checked"]' })}`
  await page.goto('/subcontract/payroll/new?origin=real&format=C1&month=2026-08')
  await expect(page.getByRole('combobox', { name: '工资项目', exact: true })).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('button', { name: '保存工资草稿', exact: true })).toBeDisabled()
  await capture(page, 'empty-project-form')
  await page.goto(matrixPath)
  await expect(page.getByRole('region', { name: '月度考勤矩阵', exact: true })).toBeVisible({ timeout: 30000 })
  const initial = await repo.attendanceMatrix(query, { projectId: f.project, month: '2026-08', crewId: f.crew })
  expect(initial.records).toHaveLength(0)
  await capture(page, 'empty-no-quantity-matrix')
  await cell(page, '日薪481负责人', '2026-08-01', '8', '2')
  await cell(page, '日薪480工人', '2026-08-02', '7.51', '0')
  await expect(page.getByRole('button', { name: '日薪480工人 2026-08-02 考勤', exact: true })).toContainText('7.51')
  await capture(page, 'saved-precision-matrix')
  await capture(page, 'month-last-day-scroll', '[data-ui="attendance-grid-scroll"]', 'last-day')
  await capture(page, 'month-totals-scroll', '[data-ui="attendance-grid-scroll"]', 'totals')
  await capture(page, 'month-normal-totals', '[data-ui="attendance-grid-scroll"]', 'normal-totals')
  await cell(page, '日薪480工人', '2026-08-02', '7.5', '0')
  await page.getByRole('link', { name: '新建 C1 工资', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新建 C1 工资草稿', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: '请款负责人', exact: true }).fill('日薪481')
  await page.getByRole('option', { name: '日薪481负责人', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '请款负责人', exact: true })).toBeEnabled()
  await page.getByRole('checkbox', { name: '日薪480工人', exact: true }).check()
  await page.getByRole('checkbox', { name: '无考勤零收款成员', exact: true }).check()
  await page.getByRole('button', { name: '核对考勤与个人标准', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存工资草稿', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'C1工资考勤与个人标准', exact: true })).toContainText('60.125')
  await page.getByRole('link', { name: '个人工资标准', exact: true }).click()
  await expect(page.getByLabel('日薪481负责人加班价', { exact: true })).toHaveValue('')
  await page.getByLabel('日薪481负责人加班价', { exact: true }).fill('55')
  await expect(page.getByRole('combobox', { name: '配置项目', exact: true })).toHaveValue(/^C1 无工程量验收 /)
  await expect(page.getByRole('combobox', { name: '配置班组', exact: true })).toHaveValue('计时班组')
  await capture(page, 'independent-overtime-config')
  await capture(page, 'independent-overtime-config-tail', '#section-rates > article:last-child')
  await expect(page.getByRole('button', { name: '保存个人标准', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '保存个人标准', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存个人标准', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新建 C1 工资草稿', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '核对考勤与个人标准', exact: true }).click()
  await expect(page.getByRole('region', { name: 'C1工资考勤与个人标准', exact: true })).toContainText('1,041.00')
  await capture(page, 'c1-draft-source')
  await capture(page, 'c1-draft-source-lines', '#section-source > .overflow-x-auto')
  await capture(page, 'c1-draft-source-values', '#section-source > .overflow-x-auto', 'source-values')
  await capture(page, 'c1-draft-source-tail', '#section-source details')
  const saving = page.waitForResponse(response => response.url().endsWith('/api/commands/payroll-c1') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存工资草稿', exact: true }).click()
  const saved = await saving
  expect(saved.ok(), await saved.text()).toBe(true)
  const { statementId } = await saved.json()
  await expect(page).toHaveURL(new RegExp(`/subcontract/payroll/${statementId}\\?`))
  const workspace = page.getByRole('region', { name: 'C1工资核对与发放', exact: true })
  await workspace.getByRole('button', { name: '核对考勤', exact: true }).click()
  await expect(workspace.getByRole('button', { name: '确认实际发放', exact: true })).toBeEnabled()
  await capture(page, 'checked-attendance')
  await page.getByRole('link', { name: '查看原考勤', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByLabel('施工内容', { exact: true }).fill('只改施工内容，合计不变')
  await page.getByRole('dialog').getByRole('button', { name: '保存考勤', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: '返回原工资', exact: true }).click()
  await expect(workspace).toBeVisible()
  await workspace.getByRole('button', { name: '重新核对考勤', exact: true }).click()
  await expect(workspace.getByRole('button', { name: '确认实际发放', exact: true })).toBeEnabled()
  await workspace.getByRole('button', { name: '确认实际发放', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('实际发放总额', { exact: true }).fill('900')
  await dialog.getByLabel('日薪481负责人收款金额', { exact: true }).fill('550')
  await dialog.getByLabel('日薪480工人收款金额', { exact: true }).fill('349.99')
  await expect(dialog.getByRole('button', { name: '确认实际发放', exact: true })).toBeDisabled()
  await capture(page, 'allocation-cent-error', '[role="dialog"]')
  await dialog.getByLabel('日薪480工人收款金额', { exact: true }).fill('350')
  await expect(dialog.getByLabel('无考勤零收款成员收款金额', { exact: true })).toHaveValue('0')
  let original = ''
  await page.route('**/api/commands/payroll-c1', async (route) => {
    if (!original && route.request().postDataJSON()?.action.kind === 'release-c1') {
      original = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('failed')
    }
    else {
      await route.continue()
    }
  })
  await dialog.getByRole('button', { name: '确认实际发放', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
  await capture(page, 'unknown-original-allocation', '[role="dialog"]')
  const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-c1') && request.postDataJSON()?.commandId === original)
  await dialog.getByRole('button', { name: '核对原提交', exact: true }).click()
  await replay
  await page.unroute('**/api/commands/payroll-c1')
  await expect(page.getByRole('button', { name: '下载工资与考勤表', exact: true })).toBeVisible()
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  await page.reload()
  await expect(page.getByRole('button', { name: '下载工资与考勤表', exact: true })).toBeVisible()
  const frozen = await repo.c1Output(query, statementId)
  expect(frozen.state).toBe('available')
  if (frozen.state !== 'available')
    throw new Error('新 C1 冻结资料必须完整')
  expect(frozen.document.grossAmount).toBe(1041)
  expect(frozen.document.actualAmount).toBe(900)
  expect(frozen.document.allocations.map(row => row.amount).sort((a, b) => a - b)).toEqual([0, 350, 550])
  const detail = await repo.detail(query, statementId)
  expect(detail.statement.lines.find(row => row.workerId === f.leader && row.itemName === '正常工时')).toMatchObject({ unitPrice: 60.125, amount: 481 })
  expect(detail.statement.stored.lines.find(row => row.workerId === f.leader && row.itemName === '正常工时')).toMatchObject({ unitPrice: 60.125, amount: 481 })
  await expect(page.locator('[aria-label="工资明细"]').getByRole('cell', { name: '60.125', exact: true }).first()).toBeVisible()
  await capture(page, 'released-paired-output')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载工资与考勤表', exact: true }).click()
  const file = await downloading
  const path = info.outputPath(file.suggestedFilename())
  await file.saveAs(path)
  const book = XLSX.read(await readFile(path))
  expect(book.SheetNames).toEqual(['工资表', '考勤表', '空鼓扣款汇总', '空鼓采用来源'])
  expect(XLSX.utils.sheet_to_json(book.Sheets.空鼓扣款汇总!)).toEqual([expect.objectContaining({ 本单空鼓扣款: 0 })])
  expect(XLSX.utils.sheet_to_json(book.Sheets.空鼓采用来源!)).toEqual([])
  expect(JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets.工资表!, { header: 1 }))).toContain('900')
  expect(JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets.考勤表!, { header: 1 }))).toContain('只改施工内容')
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.payroll-c1-print')).toBeVisible()
  const pdf = await page.pdf({ path: info.outputPath('c1-paired-output.pdf'), printBackground: true, preferCSSPageSize: true })
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const printed = await getDocument({ data: new Uint8Array(pdf) }).promise
  const texts: string[] = []
  for (let index = 1; index <= printed.numPages; index++) {
    const content = await (await printed.getPage(index)).getTextContent()
    texts.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join(''))
  }
  const normalized = texts.join('').normalize('NFKC').replace(/\s+/g, '')
  for (const word of ['C1工资表', '月度考勤表', '900.00', '无考勤零收款成员', '签字确认并按手印', '现场负责人'])
    expect(normalized).toContain(word)
  await writeFile(info.outputPath('print-validation.json'), JSON.stringify({ pageCount: printed.numPages, texts }, null, 2))
  await printed.destroy()
  await page.emulateMedia({ media: 'screen' })
  await page.goto(matrixPath)
  await page.getByRole('button', { name: '无考勤零收款成员 2026-08-31 考勤', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('已被签工或已发工资占用')
  await expect(page.getByRole('dialog').getByRole('button', { name: '保存考勤', exact: true })).toHaveCount(0)
  await capture(page, 'zero-member-month-lock', '[role="dialog"]')
  await writeFile(info.outputPath('verification.json'), JSON.stringify({ ...f, statementId, originalCommand: original, actual: 900, gross: 1041, realWorkbookRead: true, printedPdf: true, widths: [390, 768, 1024, 1280, 1440] }, null, 2))
})
