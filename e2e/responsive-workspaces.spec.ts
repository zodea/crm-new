import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const DELIVERY_MARKDOWN = `
# 广州市大板东建材有限公司销售单
送货地址：合和新城项目部
单号：SH-R2-STATE
日期：2026.07.19
<table>
  <tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>
  <tr><td>1</td><td>响应式测试材料</td><td>R2</td><td>件</td><td>1</td><td>10</td><td>10</td></tr>
</table>
`

const MATRIX = [
  { width: 390, height: 844, compact: true },
  { width: 768, height: 900, compact: true },
  { width: 1024, height: 900, compact: true },
  { width: 1440, height: 1000, compact: false },
] as const

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

async function expectWorkbenchMode(
  page: import('@playwright/test').Page,
  compact: boolean,
  labels: readonly string[],
) {
  const tabs = page.locator('[data-workbench-tabs]')
  if (!compact) {
    await expect(tabs).toBeHidden()
    for (const label of labels)
      await expect(page.locator(`section[aria-label="${label}"]`)).toBeVisible()
    return
  }

  await expect(tabs).toBeVisible()
  for (const label of labels) {
    await page.getByRole('tab', { name: label, exact: true }).click()
    await expect(page.locator(`section[aria-label="${label}"]`)).toBeVisible()
  }
}

test.describe('Issue #112 R2：高风险业务工作区', () => {
  for (const viewport of MATRIX) {
    test(`${viewport.width}px 识别工作区保持全部分区可达且不丢本地状态`, async ({ page }) => {
      await page.setViewportSize(viewport)

      await page.goto('/material/delivery')
      await page.waitForLoadState('networkidle')
      await expectWorkbenchMode(page, viewport.compact, ['队列', '原件', '校对'])
      await documentDoesNotOverflow(page)

      await page.goto('/finance/invoice')
      await page.waitForLoadState('networkidle')
      const search = page.getByPlaceholder('搜索票号、文件、公司…')
      await search.fill('广州市')
      await expectWorkbenchMode(page, viewport.compact, ['队列', '原件', '校对'])
      if (viewport.compact) {
        const totalAmount = page.getByLabel('价税合计', { exact: true })
        const editedAmount = `${1000 + viewport.width / 100}`
        await totalAmount.fill(editedAmount)
        await totalAmount.press('Tab')

        await page.getByRole('tab', { name: '队列', exact: true }).click()
        await expect(search).toHaveValue('广州市')
        await page.getByRole('tab', { name: '原件', exact: true }).click()
        await page.getByRole('tab', { name: '校对', exact: true }).click()
        await expect(totalAmount).toHaveValue(editedAmount)
      }
      else {
        await expect(search).toHaveValue('广州市')
      }
      await documentDoesNotOverflow(page)
    })
  }

  test('390px 送货识别切换分区后保留选中项、校对草稿和队列状态', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/ocr/recognize', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        engine: 'paddleocr-official-api',
        model: 'PaddleOCR-VL-1.6',
        jobId: 'job_delivery_r2_state',
        pages: [{ pageIndex: 0, markdown: DELIVERY_MARKDOWN, prunedResult: {}, layoutRegions: [] }],
        markdownPages: [DELIVERY_MARKDOWN],
        dataInfo: { numPages: 1 },
      }),
    }))

    await page.goto('/material/delivery')
    await page.waitForLoadState('networkidle')
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上传送货单', exact: true }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: 'R2-state-preservation.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    })

    const selectedQueueItem = page.locator('aside [role="button"][aria-pressed="true"]')
    await expect(selectedQueueItem).toContainText('R2-state-preservation.png')
    await expect(selectedQueueItem).toContainText('待核对')

    await page.getByRole('tab', { name: '校对', exact: true }).click()
    const orderNumber = page.getByPlaceholder('未识别时可手工填写')
    await orderNumber.fill('SH-R2-DRAFT-KEEP')
    await page.getByRole('tab', { name: '原件', exact: true }).click()
    await page.getByRole('tab', { name: '队列', exact: true }).click()
    await expect(selectedQueueItem).toHaveAttribute('aria-pressed', 'true')
    await expect(selectedQueueItem).toContainText('待核对')

    await page.getByRole('tab', { name: '校对', exact: true }).click()
    await expect(orderNumber).toHaveValue('SH-R2-DRAFT-KEEP')
    await documentDoesNotOverflow(page)
  })

  for (const viewport of MATRIX) {
    test(`${viewport.width}px 归档范围入口按容器切换且页面不横滚`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/material/delivery/archive')
      await page.waitForLoadState('networkidle')

      const scopeTrigger = page.getByRole('button', { name: '选择归档范围' })
      const desktopTreeTitle = page.getByText('归档库 · 项目 → 分供方', { exact: true })
      if (viewport.compact) {
        await expect(scopeTrigger).toBeVisible()
        await expect(desktopTreeTitle).toBeHidden()
        await scopeTrigger.focus()
        await scopeTrigger.press('Enter')
        await expect(page.getByRole('dialog', { name: '选择项目' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(scopeTrigger).toBeFocused()
      }
      else {
        await expect(scopeTrigger).toBeHidden()
        await expect(desktopTreeTitle).toBeVisible()
      }

      await documentDoesNotOverflow(page)
    })
  }

  test('390px 归档 Sheet 逐级选择项目与分供方，并与表格共享筛选状态', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/material/delivery/archive')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: '新增送货单', exact: true }).click()
    const form = page.getByRole('dialog', { name: '新增送货单' })
    await form.locator('select').nth(0).selectOption('proj_demo_001')
    await form.locator('input[placeholder="例如 SH-2026-0715-001"]').fill('SH-R2-390')
    await form.locator('input[placeholder="材料名称"]').fill('R2 响应式材料')
    await form.getByRole('button', { name: '保存送货单', exact: true }).click()
    await expect(page.getByText('送货单已新增', { exact: true })).toBeVisible()

    const scopeTrigger = page.getByRole('button', { name: '选择归档范围' })
    await scopeTrigger.press('Enter')
    let sheet = page.getByTestId('archive-scope-sheet')
    await sheet.getByRole('button', { name: /合和新城/ }).click()
    await expect(sheet.getByRole('heading', { name: '合和新城' })).toBeVisible()
    await sheet.getByRole('button', { name: /未区分分供方/ }).click()

    await expect(scopeTrigger).toContainText('合和新城 · 未区分分供方')
    await expect(page.getByRole('link', { name: 'SH-R2-390', exact: true })).toBeVisible()

    await scopeTrigger.press('Enter')
    sheet = page.getByTestId('archive-scope-sheet')
    await sheet.getByRole('button', { name: /合和新城/ }).click()
    await expect(sheet.getByRole('button', { name: /未区分分供方/ })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(scopeTrigger).toBeFocused()

    const hasLocalHorizontalScroller = await page.getByTestId('delivery-archive-table').evaluate(root =>
      Array.from(root.querySelectorAll<HTMLElement>('*')).some((element) => {
        const style = getComputedStyle(element)
        return element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(style.overflowX)
      }),
    )
    expect(hasLocalHorizontalScroller).toBe(true)
    await documentDoesNotOverflow(page)
  })

  for (const viewport of [
    { width: 390, height: 844, columns: 1 },
    { width: 768, height: 900, columns: 2 },
  ] as const) {
    test(`${viewport.width}px 手动发票录入使用 ${viewport.columns} 列且主动作可达`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/finance/invoice')
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: '手动录入', exact: true }).click()

      const dialog = page.getByRole('dialog', { name: '手动录入发票' })
      const grid = dialog.locator('.grid-cols-2')
      const columns = await grid.evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      )
      expect(columns).toBe(viewport.columns)
      await expect(dialog.getByRole('button', { name: '添加', exact: true })).toBeVisible()
      await documentDoesNotOverflow(page)
    })
  }
})
