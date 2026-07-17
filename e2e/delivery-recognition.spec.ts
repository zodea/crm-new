import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const MARKDOWN = `
# 广州市大板东建材有限公司销售单
客户名称：广州市瑞航建筑工程有限公司
送货地址：合和新城项目部
单号：SH-E2E-20260717
日期：2026.07.17
<table>
  <tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
  <tr><td>1</td><td>普通硅酸盐水泥</td><td>P.O 42.5</td><td>袋</td><td>4</td><td>155.50</td><td>622.00</td></tr>
  <tr><td></td><td>合计</td><td></td><td></td><td></td><td></td><td>622.00</td></tr>
</table>
`

test('送货单闭环：上传识别、主数据匹配、人工核对并自动进入归档库', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/ocr/recognize', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
      jobId: 'job_delivery_e2e',
      pages: [{ pageIndex: 0, markdown: MARKDOWN, prunedResult: {}, layoutRegions: [] }],
      markdownPages: [MARKDOWN],
      dataInfo: { numPages: 1 },
    }),
  }))

  await page.goto('/material/delivery')
  await page.waitForLoadState('networkidle')

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传送货单', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: '合和新城-大板东-送货单.png', mimeType: 'image/png', buffer: PNG_1PX })

  const orderNumberInput = page.getByText('单号', { exact: true }).locator('..').locator('input')
  await expect(orderNumberInput).toHaveValue('SH-E2E-20260717')
  await expect(page.locator('input[placeholder="材料名称"]').first()).toHaveValue('普通硅酸盐水泥')
  const reviewPanel = page.locator('section').filter({
    has: page.getByText('识别结果校对', { exact: true }),
  })
  await expect(reviewPanel.locator('select').nth(0)).toHaveValue('proj_demo_001')
  await expect(reviewPanel.locator('select').nth(1)).toHaveValue('sup_demo_001')
  await expect(page.getByText('金额已勾稽', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '核对完成并归档', exact: true }).click()
  await expect(page.getByText('已完成核对并进入归档库', { exact: true })).toBeVisible()
  await expect(page.getByText('上传 PDF 或图片开始识别', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '归档库', exact: true }).click()
  await expect(page).toHaveURL(/\/material\/delivery\/archive$/)
  await expect(page.getByText('SH-E2E-20260717', { exact: true })).toBeVisible()
  await expect(page.getByText('普通硅酸盐水泥', { exact: false }).first()).toBeVisible()
  expect(pageErrors).toEqual([])
})
