import type { Locator, Page, TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { payrollFeesBoundaries, payrollFeesReadableTables } from './helpers/payroll-fees-boundaries'
import { payrollFeesWorkspace } from './helpers/payroll-fees-workspace'

test.use({ actionTimeout: 15000 })
async function capture(page: Page, name: string, selector?: string) {
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    if (selector)
      await page.locator(selector).first().evaluate(node => node.scrollIntoView({ block: 'center' }))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), { message: `${name} @ ${width}px` }).toBe(true)
    await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth), { message: `${name} @ ${width}px` }).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 960 })
}
async function feeRow(page: Page, name: string, items: string[], price: number, kind = 'housing') {
  await page.getByRole('button', { name: '新增费用', exact: true }).click()
  const row = page.getByRole('article', { name: '费用配置行', exact: true }).last()
  await row.getByLabel('费用名称', { exact: true }).fill(name)
  if (kind !== 'management')
    await row.getByLabel('费用类别', { exact: true }).selectOption(kind)
  await row.getByLabel('启用此费用', { exact: true }).check()
  await row.getByLabel('费用单价', { exact: true }).fill(String(price))
  await row.getByLabel('费用单位', { exact: true }).fill('㎡')
  for (const item of items)
    await row.getByRole('checkbox', { name: new RegExp(`^${item} ·`) }).check()
  await row.getByLabel('费用完成量范围', { exact: true }).selectOption('project')
  return row
}
async function release(page: Page, statementId: string, amount: number) {
  await page.goto(`/subcontract/payroll/${encodeURIComponent(statementId)}?origin=real`)
  await page.getByRole('button', { name: '重新核对工资', exact: true }).click()
  await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('实际发放总额', { exact: true }).fill(String(amount))
  await dialog.getByLabel('同人普通工资与管理人收款金额', { exact: true }).fill(String(amount))
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认实际发放', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
  await dialog.getByRole('button', { name: '确认实际发放', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载冻结工资表', exact: true })).toBeVisible()
}
async function output(page: Page, info: TestInfo, name: string, actual: number, negative: number | null) {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  await page.reload()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载冻结工资表', exact: true }).click()
  const file = await download
  const path = info.outputPath(`${name}.xlsx`)
  await file.saveAs(path)
  const workbook = XLSX.read(await readFile(path))
  expect(XLSX.utils.sheet_to_json(workbook.Sheets.费用冻结汇总!)).toEqual([expect.objectContaining({ 本次实发: actual })])
  if (negative !== null)
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.负价代付清单!)).toEqual([expect.objectContaining({ 单位: '套', 数量: 30, 负单价: -20, 有符号金额: negative })])
  await page.getByRole('button', { name: '打印冻结工资表', exact: true }).click()
  await page.emulateMedia({ media: 'print' })
  await expect.poll(async () => (await page.locator('[data-payroll-print-page]').allTextContents()).join('').replaceAll(',', '')).toContain(actual.toFixed(2))
  // 产品打印验收仅保留这一份临时 PDF；指南继续以 Markdown 交付。
  const pdf = await page.pdf({ path: info.outputPath(`${name}.pdf`), printBackground: true, preferCSSPageSize: true })
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const printed = await getDocument({ data: new Uint8Array(pdf) }).promise
  const texts: string[] = []
  for (let index = 1; index <= printed.numPages; index++) {
    const content = await (await printed.getPage(index)).getTextContent()
    texts.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join(''))
  }
  expect(texts.join('').replaceAll(',', '')).toContain(actual.toFixed(2))
  if (negative !== null)
    expect(texts.join('')).toContain('-600.00')
  await writeFile(info.outputPath(`${name}-print-check.json`), JSON.stringify({ pages: printed.numPages, texts }, null, 2))
  await printed.destroy()
  await page.emulateMedia({ media: 'screen' })
}

test('多条补贴与独立管理簿：明确配置、未知提交恢复、520负价清单和真实输出', async ({ page }, info) => {
  test.setTimeout(600000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => errors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
  const f = await payrollFeesWorkspace(page, info)
  const ordinary = await f.project('fee-ordinary')
  const feeResponse = page.waitForResponse(response => response.url().endsWith('/api/read/payroll/a-fee-config'))
  await page.goto(ordinary.configPath())
  await writeFile(info.outputPath('fee-config-http.json'), JSON.stringify(await (await feeResponse).json(), null, 2))
  await expect(page.getByRole('region', { name: '项目主体费用与管理簿', exact: true })).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('button', { name: '新增费用', exact: true })).toBeVisible()
  const first = await feeRow(page, '墙地砖房补', ['墙砖', '地砖'], 1.3)
  await first.getByLabel('房补分类确认依据', { exact: true }).fill('经办核对项目原分项，所选墙砖和地砖为明确房补适用项；其余分项未采用。')
  await first.getByRole('button', { name: '确认所选房补分项并采用 1.30 元/㎡', exact: true }).click()
  await feeRow(page, '独立墙砖补贴', ['墙砖'], 0.2, 'subsidy')
  await capture(page, 'two-fees-explicit-scope', '#section-fees')
  let originalCommand = ''
  await page.route('**/api/commands/payroll-a-fees', async (route) => {
    if (!originalCommand && route.request().postDataJSON()?.action.kind === 'save-a-fees') {
      originalCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('failed')
    }
    else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: '保存费用配置', exact: true }).click()
  const pending = page.getByRole('alert', { name: '工资提交核对', exact: true })
  await expect(pending).toBeFocused()
  await capture(page, 'fees-unknown-preserves-command', '[aria-label="工资提交核对"]')
  const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-a-fees') && request.postDataJSON().commandId === originalCommand)
  await pending.getByRole('button', { name: '核对原提交', exact: true }).click()
  await replay
  await expect(page.getByRole('article', { name: '费用配置行', exact: true })).toHaveCount(0)
  await page.unroute('**/api/commands/payroll-a-fees')
  const ordinaryId = await ordinary.saveOrdinary()
  await page.goto(`/subcontract/payroll/${encodeURIComponent(ordinaryId)}?origin=real`)
  await expect(page.getByText('3,815.00', { exact: false }).first()).toBeVisible()
  await capture(page, 'ordinary-work-and-215-fees', '[aria-label="A工资处理"]')
  await release(page, ordinaryId, 3815)
  await output(page, info, 'ordinary-3815', 3815, null)
  const management = await f.project('fee-management')
  const workerWage = await management.saveOrdinary()
  await release(page, workerWage, 1000)
  await page.goto(management.configPath())
  await page.getByRole('button', { name: '新增班组管理范围', exact: true }).click()
  const editor = page.getByRole('region', { name: '管理关系编辑', exact: true })
  await editor.getByLabel('管理人', { exact: true }).selectOption(management.leaderWorkerId)
  await editor.getByLabel('管理簿首月比例', { exact: true }).fill('80')
  await editor.getByLabel('管理关系确认依据', { exact: true }).fill('明确管理一栋原施工责任。管理人自己的普通工资另簿核对；未完工淋浴板仍保原责任，后续可录明负价依据。')
  const responsibility = editor.getByRole('checkbox').first()
  await responsibility.check()
  await capture(page, 'management-original-responsibility', '#section-management')
  await page.getByRole('button', { name: '保存管理关系', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const config = await f.repository.aFeeConfig(f.query, { projectId: management.projectId, crewId: management.crewId, leaderWorkerId: management.leaderWorkerId, month: management.month, book: { bookPurpose: 'ordinary', managementBookId: null } })
  const bookId = config.managementBooks.find(m => m.book.managerWorkerId === management.leaderWorkerId)!.book.id
  await page.getByLabel('费用请款簿', { exact: true }).selectOption(bookId)
  await feeRow(page, '一栋墙地砖管理费', ['墙砖', '地砖'], 2.5, 'management')
  await page.getByRole('button', { name: '保存费用配置', exact: true }).click()
  await expect(page.getByRole('article', { name: '费用配置行', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '生成或打开本期管理费草稿', exact: true }).click()
  await expect(page).toHaveURL(url => /^\/subcontract\/payroll\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('config'))
  const firstManagement = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!)
  expect((await f.repository.aForm(f.query, { statementId: firstManagement })).totals.previouslyPaid.value).toBe(0)
  await release(page, firstManagement, 200)
  await page.goto(management.configPath('2026-08'))
  await page.getByLabel('费用请款簿', { exact: true }).selectOption(bookId)
  await page.getByRole('button', { name: '生成或打开本期管理费草稿', exact: true }).click()
  await expect(page).toHaveURL(url => /^\/subcontract\/payroll\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('config'))
  const secondManagement = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!)
  await page.getByRole('link', { name: '编辑工资草稿', exact: true }).click()
  await page.getByRole('button', { name: '新增负价代付行', exact: true }).click()
  const negative = page.getByRole('article', { name: '负价代付清单行', exact: true })
  await negative.getByLabel('代付清单名称', { exact: true }).fill('淋浴板未收尾代付')
  await negative.getByLabel('代付数量', { exact: true }).fill('30')
  await negative.getByLabel('代付单位', { exact: true }).fill('套')
  await negative.getByLabel('代付负单价', { exact: true }).fill('-20')
  await negative.getByLabel('代付事由', { exact: true }).fill('原施工范围中的30套淋浴板尚未收尾。经办按已经明确的管理责任核对代付清单，本行只影响管理费清单组成，未伪造该处完成，也未新增第三方实际付款。长事由末行须完整显示。')
  await negative.getByLabel('代付确认依据', { exact: true }).fill('管理人与经办共同确认：30套、每套负20元，共负600元。原责任仍保留；本管理簿先减清单，再按80%核算，扣此前实际已领200，得到520。')
  await selectShower(negative)
  await capture(page, 'negative-uncompleted-source', '#section-negative')
  await page.getByRole('button', { name: '保存负价清单', exact: true }).click()
  await expect(page.getByText('管理清单已保存，请重新核对本单后发放。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '新增负价代付行', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert', { name: '工资提交核对', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存负价清单', exact: true })).toBeDisabled()
  const read = await f.repository.aForm(f.query, { statementId: secondManagement })
  expect(read.totals.grossAmount.value).toBe(520)
  expect(read.totals.previouslyPaid.value).toBe(200)
  await page.goto(`/subcontract/payroll/${encodeURIComponent(secondManagement)}?origin=real`)
  await capture(page, 'management-520-calculation', '[aria-label="A工资处理"]')
  await release(page, secondManagement, 520)
  await capture(page, 'management-frozen-520', '[aria-label="冻结工资输出"]')
  const negativeDisplay = await payrollFeesReadableTables(page, info, { kind: 'negative' })
  await output(page, info, 'management-520', 520, -600)
  await page.goto(`/subcontract/payroll?${new URLSearchParams({ origin: 'real', project: management.projectId, month: '2026-07' })}`)
  await expect(page.getByText('独立管理费簿', { exact: true }).first()).toBeVisible()
  await capture(page, 'same-person-two-books')
  const booksDisplay = await payrollFeesReadableTables(page, info, { kind: 'same-person-list' })
  const boundaries = await payrollFeesBoundaries(page, {
    repository: f.repository,
    query: f.query,
    ordinary: { projectId: ordinary.projectId, crewId: ordinary.crewId, leaderWorkerId: ordinary.leaderWorkerId },
    management: { projectId: management.projectId, crewId: management.crewId, leaderWorkerId: management.leaderWorkerId },
    bookId,
  })
  expect((await f.repository.actualLedger(f.query, { projectId: management.projectId })).netAmount.value).toBe(1720)
  expect(errors.filter(error => error !== 'POST /api/commands/payroll-a-fees: net::ERR_FAILED' && !error.endsWith(': net::ERR_ABORTED'))).toEqual([])
  await writeFile(info.outputPath('verification.json'), JSON.stringify({ ordinaryId, workerWage, firstManagement, secondManagement, bookId, originalCommand, ordinaryActual: 3815, managementProjectActual: 1720, managementPreviouslyPaid: 200, managementCurrent: 520, boundaries, negativeDisplay, booksDisplay, errors, widths: [390, 768, 1024, 1280, 1440] }, null, 2))
})

async function selectShower(editor: Locator) {
  // 可读位置标签定位原责任细格；不写入隐藏 ID 或用未完成量假装完成事实。
  await editor.getByRole('checkbox', { name: /淋浴板/ }).last().check()
}
