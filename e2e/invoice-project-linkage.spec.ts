import type { Locator, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const PROJECT_A = '合和新城'
const PROJECT_B = '锦绣华庭'
const FILE_NAME = 'issue-72-linkage-journey-20260716.png'
const INVOICE_NUMBER = '09442026001502493'
const INVOICE_TAIL = '01502493'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const OCR_MARKDOWN = `
# 电子发票（增值税专用发票）
发票号码：${INVOICE_NUMBER}
开票日期：2026年07月16日
购买方名称：广州市瑞航建筑工程有限公司
统一社会信用代码：91440101MA9RH00001
销售方名称：广州市大板东建材有限公司
统一社会信用代码：91440101MA5CBX1234
<table>
  <tr><td>项目名称</td><td>规格型号</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td><td>税率</td><td>税额</td></tr>
  <tr><td>*建筑材料*水泥</td><td>国标</td><td>批</td><td>1</td><td>166493.92</td><td>166493.92</td><td>13%</td><td>21644.21</td></tr>
</table>
合计 ¥166493.92 ¥21644.21
价税合计（小写）¥188138.13
`

interface ExpectedProjectInvoiceState {
  archivedCount: number
  inputAmount: string
  inputTax: string
  vat: string
  taxBurden: string
  containsJourneyInvoice: boolean
}

const PROJECT_A_BASELINE: ExpectedProjectInvoiceState = {
  archivedCount: 0,
  inputAmount: '¥0.00',
  inputTax: '¥0.00',
  vat: '¥2,119,015.00',
  taxBurden: '8.26%',
  containsJourneyInvoice: false,
}

const PROJECT_B_BASELINE: ExpectedProjectInvoiceState = {
  archivedCount: 1,
  inputAmount: '¥10,956.11',
  inputTax: '¥1,423.89',
  vat: '¥-1,423.89',
  taxBurden: '0.00%',
  containsJourneyInvoice: false,
}

function invoicePanel(page: Page): Locator {
  return page.locator('section[aria-labelledby="project-invoice-title"]')
}

function metric(panel: Locator, label: string): Locator {
  return panel.getByRole('group', { name: label, exact: true })
}

async function switchAppTab(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: '已打开页面' })
    .getByRole('button', { name, exact: true })
    .click()
}

async function expectProjectInvoiceState(
  page: Page,
  expected: ExpectedProjectInvoiceState,
) {
  const panel = invoicePanel(page)
  await expect(panel.getByText(`${expected.archivedCount} 张归档票`, { exact: true })).toBeVisible()
  await expect(metric(panel, '进项票额')).toContainText(expected.inputAmount)
  await expect(metric(panel, '进项税额')).toContainText(expected.inputTax)
  await expect(metric(panel, '增值税')).toContainText(expected.vat)
  await expect(metric(panel, '税负率')).toContainText(expected.taxBurden)

  await page.getByRole('tab', { name: '票税管理', exact: true }).click()
  const receivedInvoices = page.getByRole('region', { name: '收票登记' })
  if (expected.containsJourneyInvoice) {
    await expect(receivedInvoices.getByText(INVOICE_NUMBER, { exact: true })).toBeVisible()
    await expect(receivedInvoices.getByText('¥188,138.14', { exact: true })).toBeVisible()
  }
  else {
    await expect(receivedInvoices.getByText(INVOICE_NUMBER, { exact: true })).toHaveCount(0)
  }
}

test('发票全旅程：识别归档后三处联动，改项目后迁移，再转个人开支隔离', async ({ page }) => {
  test.setTimeout(120_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
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
  await page.goto('/project')
  await page.waitForLoadState('networkidle')
  await page.getByRole('link', { name: PROJECT_A, exact: true }).click()
  await expectProjectInvoiceState(page, PROJECT_A_BASELINE)

  await switchAppTab(page, '项目列表')
  await page.getByRole('link', { name: PROJECT_B, exact: true }).click()
  await expectProjectInvoiceState(page, PROJECT_B_BASELINE)

  // 上传测试图片后走同源 OCR 响应；确认低置信字段、补齐归属，再走人工“批量通过”。
  await page.getByRole('link', { name: '发票识别', exact: true }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传发票', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: FILE_NAME, mimeType: 'image/png', buffer: PNG_1PX })

  const numberField = page.getByLabel('单据编号', { exact: true })
  await expect(numberField).toHaveValue(INVOICE_NUMBER)

  // OCR 响应故意少 0.01 元：人工修正价税合计后，store 应同步派生不含税金额并进入 §4.2 聚合。
  const totalAmountField = page.getByLabel('价税合计', { exact: true })
  await expect(totalAmountField).toHaveValue('188138.13')
  await totalAmountField.fill('188138.14')
  await totalAmountField.press('Tab')
  await expect(totalAmountField).toHaveValue('188138.14')

  const lowConfidenceFields = page.locator('button[title^="人工确认"]')
  while (await lowConfidenceFields.count()) {
    const before = await lowConfidenceFields.count()
    await lowConfidenceFields.first().click()
    await expect(lowConfidenceFields).toHaveCount(before - 1)
  }

  const projectField = page.getByLabel('对应项目', { exact: true })
  await projectField.fill(PROJECT_A)
  await projectField.press('Tab')

  await page.getByRole('button', { name: /批量通过/ }).click()
  await expect(page.getByText('已通过并归档 1 张', { exact: true })).toBeVisible()
  const excludedDialog = page.getByRole('dialog', { name: /已排除 \d+ 张/ })
  if (await excludedDialog.isVisible())
    await excludedDialog.getByRole('button', { name: '知道了', exact: true }).click()

  // 台账项目节点新增，项目 A 指标与收票登记在既有页签内同步出现。
  await page.getByRole('main').getByRole('link', { name: '发票台账', exact: true }).click()
  const projectANode = page.getByRole('button', { name: new RegExp(`^${PROJECT_A}\\s*1$`) })
  await expect(projectANode).toBeVisible()
  await projectANode.click()
  await expect(page.getByRole('button', { name: INVOICE_TAIL, exact: true })).toBeVisible()

  await switchAppTab(page, PROJECT_A)
  await expectProjectInvoiceState(page, {
    archivedCount: 1,
    inputAmount: '¥166,493.93',
    inputTax: '¥21,644.21',
    vat: '¥2,097,370.79',
    taxBurden: '8.17%',
    containsJourneyInvoice: true,
  })
  await switchAppTab(page, PROJECT_B)
  await expectProjectInvoiceState(page, PROJECT_B_BASELINE)

  // 从编辑页签把归属 A→B；台账树与两个已打开的项目详情页签应同步迁移。
  await switchAppTab(page, '发票台账')
  await projectANode.click()
  await page.getByRole('button', { name: INVOICE_TAIL, exact: true }).click()
  await page.getByPlaceholder('从项目主数据选择…').fill(PROJECT_B)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page
    .getByRole('dialog', { name: '修改已归档发票' })
    .getByRole('button', { name: '确认修改', exact: true })
    .click()
  await expect(page).toHaveURL(/\/finance\/ledger$/)

  await expect(page.getByRole('button', { name: new RegExp(`^${PROJECT_A}\\s`) })).toHaveCount(0)
  const projectBNode = page.getByRole('button', { name: new RegExp(`^${PROJECT_B}\\s*2$`) })
  await expect(projectBNode).toBeVisible()

  await switchAppTab(page, PROJECT_A)
  await expectProjectInvoiceState(page, PROJECT_A_BASELINE)
  await switchAppTab(page, PROJECT_B)
  await expectProjectInvoiceState(page, {
    archivedCount: 2,
    inputAmount: '¥177,450.04',
    inputTax: '¥23,068.10',
    vat: '¥-23,068.10',
    taxBurden: '0.00%',
    containsJourneyInvoice: true,
  })

  // 再改为个人开支：只留在台账个人开支节点，两个项目统计都恢复基线。
  await switchAppTab(page, '发票台账')
  await projectBNode.click()
  await page.getByRole('button', { name: INVOICE_TAIL, exact: true }).click()
  await page.getByRole('button', { name: '个人开支', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page
    .getByRole('dialog', { name: '修改已归档发票' })
    .getByRole('button', { name: '确认修改', exact: true })
    .click()
  await expect(page).toHaveURL(/\/finance\/ledger$/)

  await expect(page.getByRole('button', { name: new RegExp(`^${PROJECT_B}\\s*1$`) })).toBeVisible()
  const personalNode = page.getByRole('button', { name: /^个人开支\s*1$/ })
  await expect(personalNode).toBeVisible()
  await personalNode.click()
  await expect(page.getByRole('button', { name: INVOICE_TAIL, exact: true })).toBeVisible()

  await switchAppTab(page, PROJECT_A)
  await expectProjectInvoiceState(page, PROJECT_A_BASELINE)
  await switchAppTab(page, PROJECT_B)
  await expectProjectInvoiceState(page, PROJECT_B_BASELINE)

  expect(pageErrors, '全旅程不应产生客户端运行错误').toEqual([])
})
