import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import initSqlJs from 'sql.js'
import { readProductionSnapshot, updateProductionSnapshot } from './helpers/browser-production-snapshot'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

const INVOICE_INPUTS = [
  { label: '人工补一分', number: '09442026001502493', projectA: '发票归属项目甲', projectB: '发票归属项目乙', fileName: 'controlled-linkage-a.png', total: '188138.13', corrected: '188138.14', net: '166493.92', tax: '21644.21', expectedNet: 166493.93 },
  { label: '人工减一分', number: '09442026001502494', projectA: '发票归属工程丙', projectB: '发票归属工程丁', fileName: 'controlled-linkage-b.png', total: '113.01', corrected: '113', net: '100.01', tax: '13.00', expectedNet: 100 },
] as const

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const SQL = initSqlJs({ locateFile: file => path.resolve('node_modules/sql.js/dist', file) })

async function savedInvoice(page: Page, number: string) {
  const database = new (await SQL).Database(new Uint8Array(await readProductionSnapshot(page)))
  try {
    return database.exec('SELECT seller, total_amount, amount, tax_amount, project_name FROM invoices WHERE invoice_number = ?', [number])[0]?.values[0]
  }
  finally {
    database.close()
  }
}

// 本地发票聚合正向保留在 invoice-archive/detail-summary/ProjectMetrics 测试；
// 当前中央项目详情不从未接管的本地发票推算税费或补出旧票税页签。
async function switchAppTab(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: '已打开页面' })
    .getByRole('button', { name, exact: true })
    .click()
}

async function expectCentralProjectBoundary(page: Page) {
  await expect(page.getByRole('status', { name: '中央项目只读详情', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '票据信息', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '票税管理', exact: true })).toHaveCount(0)
}

for (const input of INVOICE_INPUTS) {
  test(`发票识别、人工校正、两项目归属迁移及个人开支隔离：${input.label}`, async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await installProjectCentralFixture(page, { ...PROJECT_INPUTS[0], name: input.projectA })
    const sessionResponse = await page.request.get('/api/read/business-session')
    expect(sessionResponse.ok()).toBe(true)
    const session = await sessionResponse.json()
    const created = await page.request.post('/api/commands/projects', { data: { ...session, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: input.projectB, manager: '合成发票经办人', status: '筹备中' }, attachments: {} } })
    expect(created.ok(), await created.text()).toBe(true)
    const secondId = (await created.json()).id as string
    expect(secondId).toBeTruthy()
    const pageErrors = fixture.errors
    const OCR_MARKDOWN = `电子发票（增值税专用发票）
发票号码：${input.number}
开票日期：2026年07月16日
购买方名称：合成购买方公司
销售方名称：合成建材供方
合计 ¥${input.net} ¥${input.tax}
价税合计（小写）¥${input.total}`
    const readIncome = async () => {
      const { asOf, ...facts } = (await fixture.read()).item.income
      expect(Date.parse(asOf)).not.toBeNaN()
      return facts
    }
    const baseline = await readIncome()
    await page.route('**/api/ocr/recognize', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        engine: 'paddleocr-official-api',
        model: 'PaddleOCR-VL-1.6',
        jobId: 'job_invoice_linkage_e2e',
        pages: [{ pageIndex: 0, markdown: OCR_MARKDOWN, prunedResult: {}, layoutRegions: [] }],
        markdownPages: [OCR_MARKDOWN],
        dataInfo: { numPages: 1 },
      }),
    }))

    // 先打开两个项目详情页签作为观察点；后续只切应用页签，不刷新页面。
    await fixture.open()
    await expectCentralProjectBoundary(page)
    await expect(page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: input.projectA, exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回项目列表', exact: true }).click()
    await page.getByRole('link', { name: input.projectB, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/project/${secondId}\\?origin=real(?:&|$)`))
    await expect(page.getByRole('heading', { name: input.projectB, exact: true })).toBeVisible()
    await expectCentralProjectBoundary(page)

    // 上传测试图片后走同源 OCR 响应；确认低置信字段、补齐归属，再走人工“批量通过”。
    await page.getByRole('button', { name: '资金管理', exact: true }).click()
    await page.getByRole('link', { name: '发票识别', exact: true }).click()
    await expect(page.getByRole('button', { name: '上传发票', exact: true })).toBeVisible()
    // 发票仍读取本地正式仓库，镜像中央命令产生的身份，不引入演示可写数据。
    await updateProductionSnapshot(page, (database) => {
      database.run('DELETE FROM invoices')
      for (const project of [{ id: fixture.id, name: input.projectA }, { id: secondId, name: input.projectB }])
        database.run('INSERT INTO projects (id, name, status, source) VALUES (?, ?, ?, ?)', [project.id, project.name, '筹备中', 'e2e-production-fixture'])
    })
    await page.reload()
    await expect(page.getByRole('button', { name: '上传发票', exact: true })).toBeVisible()
    // 冷恢复的非活动详情页签先用规范标题；实际激活回读后才呈现业务名称。
    await switchAppTab(page, '项目列表')
    await page.getByRole('link', { name: input.projectA, exact: true }).click()
    await expect(page.getByRole('heading', { name: input.projectA, exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回项目列表', exact: true }).click()
    await page.getByRole('link', { name: input.projectB, exact: true }).click()
    await expect(page.getByRole('heading', { name: input.projectB, exact: true })).toBeVisible()
    await switchAppTab(page, '发票识别')
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上传发票', exact: true }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({ name: input.fileName, mimeType: 'image/png', buffer: PNG_1PX })

    const numberField = page.getByLabel('单据编号', { exact: true })
    await expect(numberField).toHaveValue(input.number)

    // 独立金额样例验证人工校正后，发票记录保留修正金额和税额。
    const totalAmountField = page.getByLabel('价税合计', { exact: true })
    await expect(totalAmountField).toHaveValue(input.total)
    await totalAmountField.fill(input.corrected)
    await totalAmountField.press('Tab')
    await expect(totalAmountField).toHaveValue(input.corrected)
    await expect.poll(async () => (await savedInvoice(page, input.number))?.[1]).toBe(Number(input.corrected))
    await page.getByLabel('供应商', { exact: true }).fill('合成建材供方')
    await page.getByLabel('供应商', { exact: true }).press('Tab')
    await expect.poll(async () => (await savedInvoice(page, input.number))?.[0]).toBe('合成建材供方')

    const lowConfidenceFields = page.locator('button[title^="人工确认"]')
    while (await lowConfidenceFields.count()) {
      const before = await lowConfidenceFields.count()
      await lowConfidenceFields.first().click()
      await expect(lowConfidenceFields).toHaveCount(before - 1)
    }

    const projectField = page.getByLabel('对应项目', { exact: true })
    await projectField.fill(input.projectA)
    await projectField.press('Tab')
    await expect.poll(async () => (await savedInvoice(page, input.number))?.[4]).toBe(input.projectA)

    await page.getByRole('button', { name: /批量通过/ }).click()
    await expect(page.getByText('已通过并归档 1 张', { exact: true })).toBeVisible()
    expect((await savedInvoice(page, input.number))?.slice(1, 4)).toEqual([Number(input.corrected), input.expectedNet, Number(input.tax)])
    const excludedDialog = page.getByRole('dialog', { name: /已排除 \d+ 张/ })
    if (await excludedDialog.isVisible())
      await excludedDialog.getByRole('button', { name: '知道了', exact: true }).click()

    // 台账项目节点新增，中央详情保持同一事实来源的指标。
    await page.getByRole('main').getByRole('link', { name: '发票台账', exact: true }).click()
    const projectANode = page.getByRole('button', { name: new RegExp(`^${input.projectA}\\s*1$`) })
    await expect(projectANode).toBeVisible()
    await projectANode.click()
    await expect(page.getByRole('button', { name: input.number.slice(-8), exact: true })).toBeVisible()

    await switchAppTab(page, input.projectA)
    await expectCentralProjectBoundary(page)
    expect(await readIncome()).toEqual(baseline)
    await switchAppTab(page, input.projectB)
    await expectCentralProjectBoundary(page)

    // 从编辑页签把归属 A→B；台账树与两个已打开的项目详情页签应同步迁移。
    await switchAppTab(page, '发票台账')
    await projectANode.click()
    await page.getByRole('button', { name: input.number.slice(-8), exact: true }).click()
    await page.getByPlaceholder('从项目主数据选择…').fill(input.projectB)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page
      .getByRole('dialog', { name: '修改已归档发票' })
      .getByRole('button', { name: '确认修改', exact: true })
      .click()
    await expect(page).toHaveURL(/\/finance\/ledger$/)

    await expect(page.getByRole('button', { name: new RegExp(`^${input.projectA}\\s`) })).toHaveCount(0)
    const projectBNode = page.getByRole('button', { name: new RegExp(`^${input.projectB}\\s*1$`) })
    await expect(projectBNode).toBeVisible()

    await switchAppTab(page, input.projectA)
    await expectCentralProjectBoundary(page)
    expect(await readIncome()).toEqual(baseline)
    await switchAppTab(page, input.projectB)
    await expectCentralProjectBoundary(page)

    // 再改为个人开支：只留在台账个人开支节点，两个项目统计都恢复基线。
    await switchAppTab(page, '发票台账')
    await projectBNode.click()
    await page.getByRole('button', { name: input.number.slice(-8), exact: true }).click()
    await page.getByRole('button', { name: '个人开支', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page
      .getByRole('dialog', { name: '修改已归档发票' })
      .getByRole('button', { name: '确认修改', exact: true })
      .click()
    await expect(page).toHaveURL(/\/finance\/ledger$/)

    await expect(page.getByRole('button', { name: new RegExp(`^${input.projectB}\\s`) })).toHaveCount(0)
    const personalNode = page.getByRole('button', { name: /^个人开支\s*1$/ })
    await expect(personalNode).toBeVisible()
    await personalNode.click()
    await expect(page.getByRole('button', { name: input.number.slice(-8), exact: true })).toBeVisible()

    await switchAppTab(page, input.projectA)
    await expectCentralProjectBoundary(page)
    expect(await readIncome()).toEqual(baseline)
    await switchAppTab(page, input.projectB)
    await expectCentralProjectBoundary(page)

    expect(pageErrors, '全旅程不应产生客户端运行错误').toEqual([])
  })
}
