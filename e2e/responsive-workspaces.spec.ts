import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { updateProductionSnapshot } from './helpers/browser-production-snapshot'
import { installMaterialProductionFixture } from './helpers/material-production-fixture'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const DELIVERY_INPUTS = [
  { label: '整数', width: 390, no: 'SH-R2-STATE-A', draftNo: 'SH-R2-DRAFT-A', file: 'R2-state-a.png', date: '2026.07.19', qty: '1', price: '10', amount: '10' },
  { label: '小数与闰日', width: 768, no: 'SH-R2-STATE-B', draftNo: 'SH-R2-DRAFT-B', file: 'R2-state-b.png', date: '2028.02.29', qty: '0.5', price: '12.5', amount: '6.25' },
] as const
const fixtures = new WeakMap<Page, Awaited<ReturnType<typeof installMaterialProductionFixture>>>()

const MATRIX = [
  { width: 390, height: 844, compact: true, amount: '1003.9' },
  { width: 768, height: 900, compact: true, amount: '1007.68' },
  { width: 1024, height: 900, compact: true, amount: '1010.24' },
  { width: 1280, height: 900, compact: false, amount: '1012.8' },
  { width: 1440, height: 1000, compact: false, amount: '1014.4' },
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
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000)
    fixtures.set(page, await installMaterialProductionFixture(page))
    await page.clock.install({ time: new Date('2026-09-11T04:00:00Z') })
  })
  for (const viewport of MATRIX) {
    test(`${viewport.width}px 识别工作区保持全部分区可达且不丢本地状态`, async ({ page }) => {
      await page.setViewportSize(viewport)

      await page.goto('/material/delivery')
      await page.waitForLoadState('networkidle')
      await expectWorkbenchMode(page, viewport.compact, ['队列', '原件', '校对'])
      await documentDoesNotOverflow(page)

      await page.goto('/finance/ledger')
      await expect(page.getByRole('button', { name: '打印 PDF', exact: true })).toBeVisible()
      await updateProductionSnapshot(page, (database) => {
        database.run('INSERT INTO invoices (id, invoice_number, invoice_date, file_name, seller, total_amount, owner_kind, account_status, review_status, ocr_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [`responsive-${viewport.width}`, `CONTROLLED-${viewport.width}`, '2026-09-11', `responsive-${viewport.width}.png`, '合成响应供方', 113, 'personal', 'none', 'reviewed', 'done', 'scan'])
      })
      await page.goto('/finance/invoice')
      await page.reload()
      await page.waitForLoadState('networkidle')
      const search = page.getByPlaceholder('搜索票号、文件、公司…')
      await search.fill('合成响应供方')
      await expectWorkbenchMode(page, viewport.compact, ['队列', '原件', '校对'])
      if (viewport.compact) {
        const totalAmount = page.getByLabel('价税合计', { exact: true })
        const editedAmount = viewport.amount
        await totalAmount.fill(editedAmount)
        await totalAmount.press('Tab')

        await page.getByRole('tab', { name: '队列', exact: true }).click()
        await expect(search).toHaveValue('合成响应供方')
        await page.getByRole('tab', { name: '原件', exact: true }).click()
        await page.getByRole('tab', { name: '校对', exact: true }).click()
        await expect(totalAmount).toHaveValue(editedAmount)
      }
      else {
        await expect(search).toHaveValue('合成响应供方')
      }
      await documentDoesNotOverflow(page)
    })
  }

  for (const input of DELIVERY_INPUTS) {
    test(`${input.width}px ${input.label} 送货识别切换分区后保留选中项、校对草稿和队列状态`, async ({ page }) => {
      const fixture = fixtures.get(page)!
      const content = `# ${fixture.supplierName}销售单\n送货地址：${fixture.projectName}\n单号：${input.no}\n日期：${input.date}\n<table><tr><td>序号</td><td>商品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr><tr><td>1</td><td>响应式测试材料</td><td>R2</td><td>件</td><td>${input.qty}</td><td>${input.price}</td><td>${input.amount}</td></tr></table>`
      await page.setViewportSize({ width: input.width, height: 844 })
      await page.route('**/api/ocr/recognize', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          engine: 'paddleocr-official-api',
          model: 'PaddleOCR-VL-1.6',
          jobId: 'job_delivery_r2_state',
          pages: [{ pageIndex: 0, markdown: content, prunedResult: {}, layoutRegions: [] }],
          markdownPages: [content],
          dataInfo: { numPages: 1 },
        }),
      }))

      await page.goto('/material/delivery')
      await page.waitForLoadState('networkidle')
      const chooserPromise = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '上传送货单', exact: true }).click()
      const chooser = await chooserPromise
      await chooser.setFiles({
        name: input.file,
        mimeType: 'image/png',
        buffer: PNG_1PX,
      })

      const selectedQueueItem = page.locator('aside [role="button"][aria-pressed="true"]')
      await expect(selectedQueueItem).toContainText(input.file)
      await expect(selectedQueueItem).toContainText('待人工归档')

      await page.getByRole('tab', { name: '校对', exact: true }).click()
      const orderNumber = page.locator('.delivery-review-panel').getByText('单号', { exact: true }).locator('..').locator('input')
      await orderNumber.fill(input.draftNo)
      await page.getByRole('tab', { name: '原件', exact: true }).click()
      await page.getByRole('tab', { name: '队列', exact: true }).click()
      await expect(selectedQueueItem).toHaveAttribute('aria-pressed', 'true')
      await expect(selectedQueueItem).toContainText('待人工归档')

      await page.getByRole('tab', { name: '校对', exact: true }).click()
      await expect(orderNumber).toHaveValue(input.draftNo)
      await documentDoesNotOverflow(page)
    })
  }

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

  for (const width of [390, 768]) {
    test(`${width}px 归档 Sheet 逐级选择项目与分供方，并与表格共享筛选状态`, async ({ page }) => {
      const fixture = fixtures.get(page)!
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/material/delivery/archive')
      await page.waitForLoadState('networkidle')

      const scopeTrigger = page.getByRole('button', { name: '选择归档范围' })
      await scopeTrigger.press('Enter')
      let sheet = page.getByTestId('archive-scope-sheet')
      await sheet.getByRole('button', { name: new RegExp(fixture.projectName) }).click()
      await expect(sheet.getByRole('heading', { name: fixture.projectName })).toBeVisible()
      await sheet.getByRole('button', { name: new RegExp(fixture.supplierName) }).click()

      await expect(scopeTrigger).toContainText(`${fixture.projectName} · ${fixture.supplierName}`)
      await expect(page.getByRole('link', { name: fixture.deliveryOrderNo, exact: true })).toBeVisible()

      await scopeTrigger.press('Enter')
      sheet = page.getByTestId('archive-scope-sheet')
      await sheet.getByRole('button', { name: new RegExp(fixture.projectName) }).click()
      await expect(sheet.getByRole('button', { name: new RegExp(fixture.supplierName) })).toHaveAttribute('aria-pressed', 'true')
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
  }

  for (const viewport of [
    { width: 390, height: 844, columns: 1 },
    { width: 768, height: 900, columns: 2 },
    { width: 1024, height: 900, columns: 2 },
    { width: 1280, height: 900, columns: 2 },
    { width: 1440, height: 1000, columns: 2 },
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
