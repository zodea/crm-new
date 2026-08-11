import type { Page } from '@playwright/test'
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

async function chooseLookup(page: Page, label: string, keyword: string, optionText: string) {
  const input = page.getByLabel(label)
  await input.fill(keyword)
  await page.getByRole('option').filter({ hasText: optionText }).first().click()
}

test('送货单闭环：上传识别、主数据匹配、人工核对并自动进入归档库', async ({ page }) => {
  test.setTimeout(90_000)
  const pageErrors: string[] = []
  let uploadedDerivedImage = false
  let disabledSecondOrientationPass = false
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/ocr/recognize', (route) => {
    const multipart = route.request().postDataBuffer()?.toString('latin1') ?? ''
    uploadedDerivedImage = multipart.includes('.ocr.png')
    disabledSecondOrientationPass = multipart.includes('useDocOrientationClassify')
      && multipart.includes('false')
    return route.fulfill({
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
    })
  })

  await page.goto('/material/delivery')
  await expect(page.getByRole('button', { name: '上传送货单', exact: true })).toBeVisible({ timeout: 60_000 })

  const syntheticScan = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 900
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = '#222'
    context.lineWidth = 3
    context.beginPath()
    context.moveTo(0, 1)
    context.lineTo(canvas.width, 1)
    context.stroke()
    context.strokeStyle = '#d33'
    context.strokeRect(185, 160, 230, 620)
    for (let y = 220; y < 780; y += 70) {
      context.beginPath()
      context.moveTo(185, y)
      context.lineTo(415, y)
      context.stroke()
    }
    return canvas.toDataURL('image/png').split(',')[1]!
  })

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传送货单', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: '合和新城-大板东-送货单.png',
    mimeType: 'image/png',
    buffer: Buffer.from(syntheticScan, 'base64'),
  })

  const orderNumberInput = page.getByText('单号', { exact: true }).locator('..').locator('input')
  await expect(orderNumberInput).toHaveValue('SH-E2E-20260717')
  await expect(page.locator('input[placeholder="材料名称"]').first()).toHaveValue('普通硅酸盐水泥')
  const reviewPanel = page.locator('section').filter({
    has: page.getByText('人工复核与归档', { exact: true }),
  })
  await expect(reviewPanel.locator('select').nth(0)).toHaveValue('proj_demo_001')
  await expect(reviewPanel.locator('input[placeholder="搜索分供方名称"]'))
    .toHaveValue('广州市大板东建材有限公司')
  await expect(page.getByText('金额已勾稽', { exact: true })).toBeVisible()
  expect(uploadedDerivedImage).toBe(true)
  expect(disabledSecondOrientationPass).toBe(true)

  const itemRow = reviewPanel.locator('tbody tr').first()
  const [qtyInput, amountInput] = [itemRow.locator('input[type="number"]').nth(0), itemRow.locator('input[type="number"]').nth(2)]
  await amountInput.fill('600')
  await expect(page.getByText('1 行金额不平', { exact: true }).first()).toBeVisible()
  await qtyInput.fill('5')
  await expect(amountInput).toHaveValue('600')
  await qtyInput.fill('4')
  await amountInput.fill('622')
  await expect(page.getByText('金额已勾稽', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '确认人工归档', exact: true }).click()
  const archiveDialog = page.getByRole('dialog').filter({ hasText: '请确认已查看原件' })
  await archiveDialog.getByRole('button', { name: '确认人工归档', exact: true }).click()
  await expect(page.getByText('已入库 · 待打印', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '登记已打印', exact: true }).first()).toBeVisible()

  await page.reload()
  await expect(page.getByText('已入库 · 待打印', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '登记已打印', exact: true }).first().click()
  const printReceiptDialog = page.getByRole('dialog', { name: '登记实际打印回执' })
  await expect(printReceiptDialog).toContainText(/只打开过预览或取消打印时不要确认/)
  await printReceiptDialog.getByRole('button', { name: '确认已实际打印', exact: true }).click()
  await expect(page.getByText('已登记打印成功，文件已移出待打印范围', { exact: true })).toBeVisible()
  await expect(page.getByText('上传 PDF 或图片开始识别', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '归档库', exact: true }).click()
  await expect(page).toHaveURL(/\/material\/delivery\/archive$/)
  await expect(page.getByText('SH-E2E-20260717', { exact: true })).toBeVisible()
  await expect(page.getByText('普通硅酸盐水泥', { exact: false }).first()).toBeVisible()
  const archivedLink = page.getByRole('link', { name: 'SH-E2E-20260717', exact: true })
  await expect(page.getByText('可核对', { exact: true }).first()).toBeVisible()

  await archivedLink.click()
  await expect(page).toHaveURL(/\/material\/delivery\/archive\/[^/]+$/)
  const detailSourceImage = page.getByTestId('delivery-source-image')
  await expect(detailSourceImage).toBeVisible()
  await expect(detailSourceImage).toHaveAttribute('src', /^blob:/)

  await page.getByRole('link', { name: '编辑', exact: true }).click()
  await expect(page).toHaveURL(/\/material\/delivery\/archive\/form\/[^/]+$/)
  const editPanel = page.getByTestId('delivery-source-panel')
  await expect(editPanel.getByTestId('delivery-source-image')).toBeVisible()
  await expect(editPanel.getByRole('button', { name: '替换原件', exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('旧送货单未保存原件时，详情和编辑都提供明确的补传入口', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/material/delivery/archive')
  await expect(page.getByRole('link', { name: '新增送货单', exact: true })).toBeVisible({ timeout: 60_000 })

  await page.getByRole('link', { name: '新增送货单', exact: true }).click()
  await expect(page).toHaveURL('/material/delivery/archive/form')
  await expect(page.getByRole('heading', { name: '新建 · 送货单归档' })).toBeVisible()
  await chooseLookup(page, '检索项目', '合和新城', '合和新城')
  await page.getByLabel('送货单号').fill('SH-E2E-NO-SOURCE')
  await page.getByLabel('材料名称').fill('手工补录材料')
  await page.getByRole('button', { name: '保存送货单', exact: true }).click()
  await expect(page.getByText('送货单归档已新增', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/material\/delivery\/archive\/[^/]+$/)
  await page.getByTitle('返回归档库').click()

  const manualLink = page.getByRole('link', { name: 'SH-E2E-NO-SOURCE', exact: true })
  await expect(page.getByText('缺原件', { exact: true }).first()).toBeVisible()
  await manualLink.click()

  const detailPanel = page.getByTestId('delivery-source-panel')
  await expect(detailPanel.getByText('历史记录未保存原件', { exact: true })).toBeVisible()
  await expect(detailPanel.getByRole('button', { name: '补传原件', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '编辑', exact: true }).click()
  await expect(page).toHaveURL(/\/material\/delivery\/archive\/form\/[^/]+$/)
  const editPanel = page.getByTestId('delivery-source-panel')
  await expect(editPanel.getByText('历史记录未保存原件', { exact: true })).toBeVisible()
  const chooserPromise = page.waitForEvent('filechooser')
  await editPanel.getByRole('button', { name: '补传原件', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: '手工补传原件.png', mimeType: 'image/png', buffer: PNG_1PX })
  await expect(editPanel.getByTestId('delivery-source-image')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/material\/delivery\/archive\/[^/]+$/)
  const refreshedDetailImage = page.getByTestId('delivery-source-image')
  await expect(refreshedDetailImage).toBeVisible()
  await expect(refreshedDetailImage).toHaveAttribute('src', /^blob:/)

  await page.getByRole('link', { name: '编辑', exact: true }).click()
  await expect(page.getByTestId('delivery-source-image')).toBeVisible()
})

test('模糊分供方只给建议，不会在人工采用前直接绑定', async ({ page }) => {
  const fuzzyMarkdown = MARKDOWN.replace('广州市大板东建材有限公司', '广州市大板东建材有限公可')
  await page.route('**/api/ocr/recognize', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
      jobId: 'job_delivery_fuzzy',
      pages: [{ pageIndex: 0, markdown: fuzzyMarkdown, prunedResult: {}, layoutRegions: [] }],
      markdownPages: [fuzzyMarkdown],
      dataInfo: { numPages: 1 },
    }),
  }))

  await page.goto('/material/delivery')
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传送货单', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({ name: '合和新城-模糊分供方.png', mimeType: 'image/png', buffer: PNG_1PX })

  const reviewPanel = page.locator('section').filter({
    has: page.getByText('人工复核与归档', { exact: true }),
  })
  await expect(reviewPanel.locator('input[placeholder="搜索分供方名称"]')).toHaveValue('')
  await expect(page.getByRole('button', { name: '采用并记为别名', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '采用并记为别名', exact: true }).click()
  await expect(reviewPanel.locator('input[placeholder="搜索分供方名称"]')).not.toHaveValue('')
})
