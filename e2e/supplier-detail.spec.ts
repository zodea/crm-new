import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
} from './helpers/responsive'

const SUPPLIER_NAME = '穗建五金机电经营部'
const CREDENTIAL_FILE = 'E2E银行账户资料.pdf'

test('分供方详情：6 Tab 实时汇总、证照软删除撤回与列表双页联动', async ({ page }) => {
  test.setTimeout(90_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const ocrMarkdownPages = [
    '营业执照\n名称：穗建五金机电经营部\n统一社会信用代码：91440104MA5JKL3456',
    '中华人民共和国居民身份证\n姓名：周伟\n有效期限：2024.01.01-2034.01.01',
    '基本存款账户信息\n开户行：农业银行广州海珠支行\n基本存款账户编号：6228 4800 5566 7788',
  ]
  let ocrRequestIndex = 0
  await page.route('**/api/ocr/recognize', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: (() => {
      const markdown = ocrMarkdownPages[ocrRequestIndex++]!
      return JSON.stringify({
        engine: 'paddleocr-official-api',
        model: 'PaddleOCR-VL-1.6',
        jobId: `e2e-supplier-credential-${ocrRequestIndex}`,
        pages: [{
          pageIndex: 0,
          markdown,
          prunedResult: {},
          layoutRegions: [],
        }],
        markdownPages: [markdown],
        dataInfo: {},
      })
    })(),
  }))

  async function uploadCredential(category: string, fileName: string) {
    await page.getByLabel('上传证照类别').selectOption(category)
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4\n%E2E synthetic ${category}\n`),
    })
    await expect(page.getByText('核对 OCR 识别结果', { exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '证照类别' }))
      .toContainText(`最终：${category}`)
    await page.getByRole('button', { name: '保存核对结果', exact: true }).click()
    await expect(page.getByText('核对 OCR 识别结果', { exact: true })).toBeHidden()
  }

  await page.goto('/base/supplier')
  await page.getByPlaceholder('搜索公司名、税号、简称…').fill(SUPPLIER_NAME)
  await page.getByRole('link', { name: SUPPLIER_NAME, exact: true }).click()
  await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004$/)

  const supplierHeader = page.locator('header.panel')
  const detailTabs = page.getByRole('navigation', { name: '分供方详情分类' })
  await expect(detailTabs.getByRole('tab')).toHaveCount(6)
  await expect(detailTabs.getByRole('tab', { name: '详细资料', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(supplierHeader).toContainText('138 **** 3456')
  await expect(page.getByText('9144 **** 3456').first()).toBeVisible()
  await expect(page.getByText('6228 **** 7788').first()).toBeVisible()
  await expect(page.getByText('91440104MA5JKL3456', { exact: true })).toHaveCount(0)
  await expect(page.getByText('6228 4800 5566 7788', { exact: true })).toHaveCount(0)

  const summary = page.getByTestId('supplier-summary')
  await expect(summary).toContainText('合作项目1 个')
  await expect(summary).toContainText('累计合同金额¥261,250.00')
  await expect(summary).toContainText('累计结算金额¥101,138.00')
  await expect(summary).toContainText('累计收票金额¥12,380.00')
  await expect(summary).toContainText('累计付款金额¥101,138.00')
  await expect(summary).toContainText('应付金额¥160,112.00')
  await expect(summary.getByRole('button', { name: '查看累计合同金额明细' })).toBeVisible()
  await expect(summary.getByRole('button', { name: '查看累计结算金额明细' })).toBeVisible()
  await expect(summary.getByRole('button', { name: '查看累计收票金额明细' })).toBeVisible()
  await expect(summary.getByRole('button', { name: '查看累计付款金额明细' })).toBeVisible()
  await expect(summary.getByRole('button', { name: '查看应付金额明细' })).toHaveCount(0)

  await summary.getByRole('button', { name: '查看累计合同金额明细' }).click()
  await expect(detailTabs.getByRole('tab', { name: '合同汇总 (3)', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004\?tab=contracts$/)
  await expect(page.getByRole('columnheader', { name: '累计结算' })).toBeVisible()
  await summary.getByRole('button', { name: '查看累计结算金额明细' }).click()
  await expect(detailTabs.getByRole('tab', { name: '合同汇总 (3)', exact: true })).toHaveAttribute('aria-selected', 'true')
  await summary.getByRole('button', { name: '查看累计收票金额明细' }).click()
  await expect(detailTabs.getByRole('tab', { name: '收票汇总 (1)', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004\?tab=invoices$/)
  await summary.getByRole('button', { name: '查看累计付款金额明细' }).click()
  await expect(detailTabs.getByRole('tab', { name: '请款/付款汇总 (2)', exact: true })).toHaveAttribute('aria-selected', 'true')

  await detailTabs.getByRole('tab', { name: '合作项目 (1)', exact: true }).click()
  await expect(page.getByRole('link', { name: '锦绣华庭', exact: true }))
    .toHaveAttribute('href', '/project/proj_demo_002/supplier/sup_demo_004')
  await expect(page.getByRole('cell', { name: '¥230,000.00', exact: true })).toBeVisible()
  await expect(page.getByText('按 ProjectSupplier 关系聚合 1 个合作项目；合同额来自合同台账，实际付款来自付款申请。', { exact: true })).toBeVisible()

  await detailTabs.getByRole('tab', { name: '合同汇总 (3)', exact: true }).click()
  await expect(page.getByRole('link', { name: '五金机电采购合同', exact: true })).toBeVisible()
  await expect(page.getByLabel('筛选合同类型')).toBeVisible()

  await detailTabs.getByRole('tab', { name: '请款/付款汇总 (2)', exact: true }).click()
  await expect(page.getByRole('cell', { name: '五金机电采购首期请款', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '实际付款', exact: true })).toBeVisible()
  await expect(page.getByText('来源：付款申请表实时汇总；点击申请编号可追溯源单。', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'FK-2026-CG-004', exact: true }))
    .toHaveAttribute('href', '/finance/payment/pa_demo_sup004_1/detail')

  await detailTabs.getByRole('tab', { name: '收票汇总 (1)', exact: true }).click()
  await expect(page.getByRole('link', { name: '09442026000058702', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '¥12,380.00', exact: true })).toBeVisible()

  await detailTabs.getByRole('tab', { name: '证照附件 (2)', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('缺失或已过期的需提供资料：营业执照、法人身份证、银行账户资料')
  await uploadCredential('营业执照', 'E2E营业执照.pdf')
  await uploadCredential('法人身份证', 'E2E法人身份证.pdf')
  await uploadCredential('银行账户资料', CREDENTIAL_FILE)
  await expect(supplierHeader.getByText('齐全待核验', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '人工核验通过', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '人工核验通过' })
  await dialog.getByRole('button', { name: '确认通过', exact: true }).click()
  await expect(supplierHeader.getByText('合格', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `预览 ${CREDENTIAL_FILE}`, exact: true })).toBeVisible()
  await expect(detailTabs.getByRole('tab', { name: '证照附件 (5)', exact: true })).toBeVisible()

  await page.getByRole('button', { name: `删除 ${CREDENTIAL_FILE}`, exact: true }).click()
  dialog = page.getByRole('dialog', { name: '删除证照' })
  await expect(dialog).toContainText(`确认删除「${CREDENTIAL_FILE}」`)
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(supplierHeader.getByText('资料缺失', { exact: true })).toBeVisible()
  await expect(detailTabs.getByRole('tab', { name: '证照附件 (4)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '撤回', exact: true }).click()
  await expect(supplierHeader.getByText('齐全待核验', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `预览 ${CREDENTIAL_FILE}`, exact: true })).toBeVisible()

  const editSupplier = supplierHeader.getByRole('button', { name: '编辑', exact: true })
  await editSupplier.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/base/supplier/form/sup_demo_004')
  await page.getByLabel('主要联系人 *', { exact: true }).fill('E2E周经理')
  await page.getByRole('group', { name: '表单操作' })
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await expect(page).toHaveURL('/base/supplier/sup_demo_004?tab=credential')
  await expect(detailTabs.getByRole('tab', { name: /证照附件/ })).toHaveAttribute('aria-selected', 'true')
  await expect(supplierHeader).toContainText('联系人 E2E周经理')

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  await tabBar.getByRole('button', { name: '分供方', exact: true }).click()
  await page.getByRole('button', { name: '编辑分供方', exact: true }).click()
  await expect(page.getByLabel('主要联系人 *', { exact: true })).toHaveValue('E2E周经理')
  await page.getByRole('button', { name: '返回分供方详情' }).click()

  expect(pageErrors, '分供方详情旅程不应产生客户端运行错误').toEqual([])
})

test('分供方详情：聚合页签深链刷新后可恢复', async ({ page }) => {
  await page.goto('/base/supplier/sup_demo_004?tab=invoices')
  const detailTabs = page.getByRole('navigation', { name: '分供方详情分类' })
  await expect(detailTabs.getByRole('tab', { name: '收票汇总 (1)', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('columnheader', { name: '发票号码' })).toBeVisible()
})

for (const width of [390, 768, 1024, 1280] as const) {
  test(`${width}px 分供方证照表只在自身区域横向滚动`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto('/base/supplier/sup_demo_004')
    const detailTabs = page.getByRole('navigation', { name: '分供方详情分类' })
    await detailTabs.getByRole('tab', { name: /证照附件/ }).click()

    const credentialTable = page.getByLabel('证照文件表，可横向滚动')
    await expect(credentialTable).toBeVisible()
    if (width <= 1024)
      await expectLocalHorizontalScroll(credentialTable, `${width}px 分供方证照表`)
    else
      await expect(credentialTable).toHaveCSS('overflow-x', 'auto')
    await expectNoPageOverflow(page, `${width}px 分供方证照页`)
  })
}
