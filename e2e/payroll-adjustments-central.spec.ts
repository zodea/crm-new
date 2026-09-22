import type { Page, TestInfo } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { payrollAdjustmentWorkspace } from './helpers/payroll-adjustment-workspace'
import { payrollC2Workspace } from './helpers/payroll-c2-workspace'

test.use({ actionTimeout: 15000 })
const browserErrors: string[] = []
test.afterEach(async ({ page }, info) => {
  await writeFile(info.outputPath('browser-errors.json'), JSON.stringify({ page: page.url(), errors: browserErrors }, null, 2))
})
async function capture(page: Page, info: TestInfo, name: string, selector?: string) {
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    if (selector)
      await page.locator(selector).first().evaluate(node => node.scrollIntoView({ block: 'center' }))
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
}

test('原工资独立更正、真退40、后月处理60与跨页同源冷读', async ({ page }, info) => {
  test.setTimeout(420000)
  browserErrors.length = 0
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('requestfailed', request => browserErrors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
  const f = await payrollAdjustmentWorkspace(page, info)
  const originalOutput = await f.repository.c2Output(f.query, f.statementId)
  const sourcePath = `/subcontract/payroll/${encodeURIComponent(f.statementId)}?${new URLSearchParams({ origin: 'real', project: f.projectId, month: '2026-08', crew: f.crewId })}`
  await page.goto(sourcePath)
  await expect(page.getByRole('link', { name: '发起独立核算更正', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('link', { name: '发起独立核算更正', exact: true }).click()
  await expect(page.getByRole('heading', { name: '独立工资更正', exact: true })).toBeVisible()
  await page.getByLabel('更正主体单价（元 / 工）', { exact: true }).last().fill('900')
  await page.getByLabel('更正原因', { exact: true }).fill('原主体单价记录错误。经现场负责人、签工人员和工资经办人共同复核，本次仅修正原核算采用的单价，原始签工记录、工作内容、现场证明以及原签收金额继续保留。后续退款和以后工资处理分别留存事实，不把本次差额直接记作已经退款。')
  await page.getByLabel('人工核对依据', { exact: true }).fill('与负责人逐条核对签工和原单价。\n依据一：原签工确认记录与实际工作时间。\n依据二：原工资签收及全员金额分配。\n依据三：双方确认的主体单价更正说明。\n依据四：分次退款与后续工资处理记录。长依据末行可完整回读。')
  await page.getByRole('button', { name: '按当前资料核对本稿', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存更正草稿', exact: true })).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 960 })
  const sourceTable = page.getByLabel('原逐条签工更正', { exact: true }).last()
  await sourceTable.focus()
  await expect(sourceTable).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => sourceTable.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
  await capture(page, info, 'correction-full-page', '#section-reason')
  await page.getByRole('button', { name: '保存更正草稿', exact: true }).click()
  await page.getByRole('link', { name: '编辑并确认更正', exact: true }).click()
  await page.getByRole('button', { name: '确认核算更正', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('尚未发生实际补发或退款')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认核算更正', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '确认核算更正', exact: true }).click()
  await dialog.getByRole('button', { name: '确认并保存记录', exact: true }).click()
  await expect(page.getByRole('region', { name: '原更正链当前余额' })).toContainText('-100.00')
  const adjustmentId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!)
  expect((await f.repository.actualLedger(f.query, { projectId: f.projectId })).netAmount.value).toBe(1000)
  await capture(page, info, 'confirmed-correction-no-cash')
  await verifyOutput(page, info, 'correction', '原主体单价记录错误', '本次有符号差额', -100)
  await page.getByRole('link', { name: '登记实际补发或退款', exact: true }).click()
  await page.getByLabel('真实发生日期', { exact: true }).fill('2026-08-05')
  await page.getByLabel('本次有符号实额', { exact: true }).fill('-40')
  await page.getByLabel('实际发生与核对依据', { exact: true }).fill('负责人已实际退回40元')
  await page.getByLabel('签工负责人本次收付金额', { exact: true }).fill('-40')
  await page.getByLabel(`${adjustmentId}本次处理额`, { exact: true }).fill('-40')
  await page.getByRole('button', { name: '核对本次金额与剩余', exact: true }).click()
  await capture(page, info, 'refund-full-page', '#section-application')
  let originalCommand = ''
  await page.route('**/api/commands/payroll-adjustment', async (route) => {
    if (!originalCommand && route.request().postDataJSON()?.action.kind === 'confirm-actual-payment') {
      originalCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('failed')
    }
    else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: '确认真实收付', exact: true }).click()
  await dialog.getByRole('button', { name: '确认并保存记录', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
  await expect(page.getByRole('alert', { name: '工资提交核对', exact: true })).toBeFocused()
  await capture(page, info, 'refund-unknown-keeps-original')
  const replaying = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-adjustment'))
  await page.getByRole('button', { name: '核对原提交', exact: true }).click()
  expect((await replaying).postDataJSON().commandId).toBe(originalCommand)
  await expect(page.getByRole('button', { name: '下载确认记录', exact: true })).toBeVisible()
  expect((await f.repository.actualLedger(f.query, { projectId: f.projectId })).netAmount.value).toBe(960)
  await verifyOutput(page, info, 'refund', '负责人已实际退回40元', '有符号登记金额', -40)
  await capture(page, info, 'actual-refund-confirmation')
  const refundId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!)
  const laterId = await f.checked('2026-09')
  await page.goto(`/subcontract/payroll/${encodeURIComponent(laterId)}?origin=real`)
  // 后月处理控件在工资整页填写；真实实发仍在原发放确认中完成。
  const amount = page.getByLabel('2026-08更正本次处理差额', { exact: true })
  await amount.fill('-60')
  await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
  await dialog.getByLabel('实际发放总额', { exact: true }).fill('940')
  await dialog.getByLabel('签工负责人收款金额', { exact: true }).fill('940')
  await expect(dialog).toContainText('-60.00')
  await capture(page, info, 'later-release-940-with-60', '[role="dialog"]')
  await dialog.getByRole('button', { name: '确认实际发放', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await f.repository.actualLedger(f.query, { projectId: f.projectId })).netAmount.value).toBe(1900)
  expect((await f.repository.adjustmentDetail(f.query, adjustmentId)).balance.remainingDelta.value).toBe(0)
  expect((await f.repository.c2Output(f.query, f.statementId)).document).toEqual(originalOutput.document)
  const ledger = `/subcontract/payroll/payments?${new URLSearchParams({ origin: 'real', project: f.projectId, returnTo: sourcePath })}`
  await page.goto(ledger)
  await expect(page.getByRole('heading', { name: '工资实际收付', exact: true })).toBeVisible()
  await capture(page, info, 'net-1900-ledger')
  for (const [kind, id] of [['worker', f.workerId], ['crew', f.crewId], ['project', f.projectId]]) {
    await page.goto(`${kind === 'project' ? '/project' : `/base/${kind}`}/${encodeURIComponent(id!)}?origin=real`)
    await expect(page.getByTestId('payroll-host-net')).toContainText('1,900.00')
    await capture(page, info, `${kind}-same-actual`, '[data-testid="payroll-host-section"]')
  }
  await verifyPaymentAndReversal(page, info, f, refundId)
  await verifyBudgetReturn(page, info, f)
  expect(browserErrors.filter(error => error !== 'POST /api/commands/payroll-adjustment: net::ERR_FAILED' && !error.endsWith(': net::ERR_ABORTED'))).toEqual([])
  await writeFile(info.outputPath('verification.json'), JSON.stringify({ statementId: f.statementId, laterId, adjustmentId, originalCommand, projectId: f.projectId, originalSignature: 1000, refund: -40, laterActual: 940, net: 1900, remaining: 0, widths: [390, 768, 1024, 1280, 1440] }, null, 2))
})

async function verifyOutput(page: Page, info: TestInfo, name: string, note: string, amountLabel: string, amount: number) {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
  await page.reload()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载确认记录', exact: true }).click()
  const file = await download
  const filePath = info.outputPath(file.suggestedFilename())
  await file.saveAs(filePath)
  const book = XLSX.read(await readFile(filePath))
  expect(JSON.stringify(book.Sheets)).toContain(note)
  const factRows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]!]!, { header: 1 })
  expect(factRows).toContainEqual([amountLabel, amount])
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('[data-payroll-confirmation-print]').getByRole('row', { includeHidden: true }).filter({ hasText: amountLabel })).toContainText(String(amount))
  await page.screenshot({ path: info.outputPath(`${name}-print-preview.png`), fullPage: true })
  // 仅生成有界产品验收临时文件供逐页核查，不另交付指南 PDF。
  await page.pdf({ path: info.outputPath(`${name}-print.pdf`), format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } })
  await page.emulateMedia({ media: 'screen' })
}

async function verifyPaymentAndReversal(page: Page, info: TestInfo, f: Awaited<ReturnType<typeof payrollAdjustmentWorkspace>>, refundId: string) {
  const payment = `/finance/payment-management?${new URLSearchParams({ origin: 'real', payrollProject: f.projectId })}`
  await page.goto(payment)
  const wages = page.getByRole('region', { name: '工资收付独立来源', exact: true })
  await expect(wages).toContainText('1,900.00')
  await page.reload()
  await expect(wages).toContainText('1,900.00')
  await capture(page, info, 'payment-readonly-cold-project', '[aria-label="工资收付独立来源"]')
  await page.getByRole('link', { name: '打开工资实际收付', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工资实际收付', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '实际退款', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工资实际退款详情', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('link', { name: '返回来源', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工资实际收付', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回来源', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname + url.search === payment)
  await expect(wages).toContainText('1,900.00')
  await page.goto(`/subcontract/payroll/payments/${encodeURIComponent(refundId)}?origin=real`)
  for (const correcting of [false, true]) {
    await page.getByRole('link', { name: correcting ? '纠正这次错记冲销' : '核实错记冲销', exact: true }).click()
    await page.getByLabel('核实日期', { exact: true }).fill('2026-09-06')
    await page.getByLabel(correcting ? '纠正原冲销的核对依据' : '确认未发生的核对依据', { exact: true }).fill(correcting ? '复核原退款40实际发生，前次冲销误记，引用冲销追加纠错' : '依据财务核对暂认定原退款40未实际发生，保留原记录')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: '核对错记事实与处理关系', exact: true }).click()
    await capture(page, info, correcting ? 'reversal-correction-full-page' : 'recording-reversal-full-page', '#section-proof')
    const confirm = page.getByRole('button', { name: correcting ? '确认冲销纠错' : '确认错记冲销', exact: true })
    await confirm.click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(confirm).toBeFocused()
    await confirm.click()
    await page.getByRole('dialog').getByRole('button', { name: '确认并保存记录', exact: true }).click()
    await expect(page.getByRole('heading', { name: '工资错记冲销详情', exact: true })).toBeVisible()
    expect((await f.repository.actualLedger(f.query, { projectId: f.projectId })).netAmount.value).toBe(correcting ? 1900 : 1940)
    await capture(page, info, correcting ? 'reversal-corrected-confirmation' : 'reversal-confirmation')
  }
}

test('沿已确认原链核对纠正冲销的依据标题和项目冷回显', async ({ page }, info) => {
  const f = await payrollC2Workspace(page, '2026-09')
  const ledger = await f.repository.actualLedger({ origin: 'real' }, { projectId: f.project.id })
  expect(ledger.netAmount.value).toBe(1900)
  const reversal = ledger.rows.find(row => row.kind === 'recording-reversal')!
  expect(reversal.ref.kind).toBe('actual-event')
  if (reversal.ref.kind !== 'actual-event')
    throw new Error('需要已确认的原错记冲销')
  await page.goto(`/subcontract/payroll/payments/reversal/new?${new URLSearchParams({ origin: 'real', eventId: reversal.ref.eventId })}`)
  await expect(page.getByLabel('纠正原冲销的核对依据', { exact: true })).toBeVisible()
  await expect(page.getByLabel('确认未发生的核对依据', { exact: true })).toHaveCount(0)
  await expect(page.getByText('请记录纠正原冲销的具名核查依据', { exact: true })).toBeVisible()
  await expect(page.getByText('请记录为什么确认这笔原收付未真实发生的具名核查依据', { exact: true })).toHaveCount(0)
  await capture(page, info, 'reversal-correction-label-final', '#section-proof')
  await page.goto(`/subcontract/payroll/payments?${new URLSearchParams({ origin: 'real', project: f.project.id })}`)
  await expect(page.getByRole('combobox')).toHaveValue(f.project.name)
  await expect(page.getByRole('region', { name: '工资实际收付', exact: true })).toContainText('1,900.00')
  await capture(page, info, 'ledger-project-resolved-final')
})

async function verifyBudgetReturn(page: Page, info: TestInfo, f: Awaited<ReturnType<typeof payrollAdjustmentWorkspace>>) {
  const id = await f.createBudget()
  const path = `/project/target-cost/${encodeURIComponent(id)}?origin=real`
  await page.goto(path)
  await page.getByRole('tab', { name: '成本对比 (7)', exact: true }).click()
  await expect(page.getByLabel('工人工资 动态成本来源', { exact: true })).toContainText('1,900.00')
  await expect(page.getByLabel('工人工资 支付来源', { exact: true })).toContainText('1,900.00')
  await capture(page, info, 'budget-same-actual', '[aria-label="目标成本来源完整性对比"]')
  const actualLink = page.getByRole('link', { name: '查看工资实际收付', exact: true })
  const returnPath = new URL((await actualLink.getAttribute('href'))!, page.url()).searchParams.get('budgetReturnTo')
  expect(returnPath).toBeTruthy()
  await actualLink.click()
  await expect(page).toHaveURL(url => url.pathname === '/subcontract/payroll/payments' && url.searchParams.get('project') === f.projectId)
  await page.reload()
  await expect(page.getByRole('region', { name: '工资实际收付', exact: true })).toContainText('1,900.00')
  await page.getByRole('link', { name: '返回预算版本 · P4 工资同源预算', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname + url.search === returnPath)
}
