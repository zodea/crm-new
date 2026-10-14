import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const SUPPLIER_INPUTS = [
  { name: '受控参考材料供方', category: '材料供应商', phone: '13800131234', taxNo: '91440101MA5CBX1234', maskedPhone: '138 **** 1234', maskedTax: '9144 **** 1234' },
  { name: '受控参考劳务供方', category: '劳务分包商', phone: '13900135678', taxNo: '91440101MA5CBX5678', maskedPhone: '139 **** 5678', maskedTax: '9144 **** 5678' },
] as const

test.describe('Issue #193/#206：分供方直接参考布局', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `supplier-layout-${randomUUID()}` })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
    const reset = await page.request.post('/api/testing/suppliers/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
    expect(reset.ok(), await reset.text()).toBe(true)
    const session = await (await page.request.get('/api/read/business-session')).json()
    for (const input of SUPPLIER_INPUTS) {
      const created = await page.request.post('/api/commands/suppliers', { data: {
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        requiredCapability: 'supplier:write',
        commandId: randomUUID(),
        baseVersion: null,
        action: 'draft',
        draft: { name: input.name, supplierCategory: input.category, contact: '合成联系人', contactPhone: input.phone, taxNo: input.taxNo },
        attachments: {},
      } })
      expect(created.ok(), await created.text()).toBe(true)
    }
  })

  test('列表在各宽度使用单行工具栏、紧凑局部滚动表格和底部分页', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/supplier')

    const toolbar = page.locator('[data-ui="supplier-list-toolbar"]')
    await expect(toolbar).toBeVisible({ timeout: 15_000 })
    await expect(toolbar).toHaveCSS('overflow-x', 'visible')
    const table = page.locator('[data-ui="supplier-list-table"]')
    await expect(table).toBeVisible()
    for (const input of SUPPLIER_INPUTS) {
      await expect(table.getByText(input.maskedTax, { exact: true })).toBeVisible()
      await expect(table.getByText(input.maskedPhone, { exact: true })).toBeVisible()
    }
    for (const input of SUPPLIER_INPUTS)
      await expect(table.getByRole('link', { name: input.name, exact: true })).toBeVisible()
    await expect(table.getByText(/共 \d+ 条/)).toBeVisible()

    const importButton = toolbar.getByRole('button', { name: /导入分供方/ })
    for (const width of [...RESPONSIVE_WIDTHS, 1280]) {
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : 900,
      })
      await expect(toolbar.locator('[data-ui="supplier-list-toolbar-row"]')).toHaveCSS('flex-wrap', width < 768 ? 'wrap' : 'nowrap')
      await expect(toolbar.getByRole('searchbox', { name: '搜索关键词…' })).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '刷新' })).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '排序', exact: true })).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '筛选', exact: true })).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '列设置' })).toBeVisible()
      await importButton.scrollIntoViewIfNeeded()
      await expect(importButton).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '新增分供方' })).toBeVisible()
      const headerHeight = await table.locator('.vxe-header--column').first().evaluate(element => element.getBoundingClientRect().height)
      expect(headerHeight).toBeGreaterThanOrEqual(32)
      expect(headerHeight).toBeLessThanOrEqual(44)
      await expect(table.locator('.vxe-body--column').first()).toHaveCSS('height', '32px')
      await expectLocalHorizontalScroll(
        table.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper'),
        `${width}px 分供方表格`,
      )
      await expectNoPageOverflow(page, `${width}px 分供方列表`)
    }
  })

  test('新建先选七类，取消留在列表，确认后进入带默认类别的整页表单', async ({ page }) => {
    await page.goto('/base/supplier')

    const trigger = page.getByRole('button', { name: '新增分供方' })
    await trigger.click()
    let dialog = page.getByRole('dialog', { name: '选择分供方类别' })
    await expect(dialog.getByRole('radio')).toHaveCount(7)
    await expect(dialog.getByRole('radio', { name: '材料供应商' })).toBeChecked()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL('/base/supplier')
    await expect(trigger).toBeFocused()

    await trigger.click()
    dialog = page.getByRole('dialog', { name: '选择分供方类别' })
    await dialog.getByRole('radio', { name: '专业分包商' }).check()
    await dialog.getByRole('button', { name: '进入新建表单' }).click()

    await expect(page).toHaveURL(/\/base\/supplier\/form\?category=/)
    await expect(page.getByRole('heading', { name: '新建 · 分供方' })).toBeVisible()
    await expect(page.getByLabel('分供方类别 *')).toHaveValue('专业分包商')
    await expect(page.getByRole('navigation', { name: '表单分区' })).toHaveCount(0)
  })

  for (const input of SUPPLIER_INPUTS) {
    test(`${input.category} 受控主档筛选、可读事实和独立证照入口`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 900 })
      await page.goto('/base/supplier')
      const toolbar = page.locator('[data-ui="supplier-list-toolbar"]')
      await toolbar.getByRole('searchbox', { name: '搜索关键词…', exact: true }).fill(input.name)
      const table = page.locator('[data-ui="supplier-list-table"]')
      const rowId = await table.getByRole('link', { name: input.name, exact: true }).locator('xpath=ancestor::tr').getAttribute('rowid')
      expect(rowId).toBeTruthy()
      const row = table.locator(`.vxe-table--main-wrapper tr[rowid="${rowId}"]`)
      await expect(row).toContainText(input.category)
      // ready 隔离实例接通事实源；生产源未接通时的未知金额另由服务测试覆盖。
      await expect(page.getByRole('status').filter({ hasText: '关联项目、合同' })).toHaveCount(0)
      await expect(row.getByRole('link', { name: '缺少原件', exact: true })).toHaveAttribute('href', /\/base\/supplier\/credential\/[^?]+\?origin=real&returnTo=/)
      await toolbar.getByRole('button', { name: '排序', exact: true }).click()
      const sort = page.getByRole('combobox', { name: '排序方式', exact: true })
      await expect(sort.locator('option[value="paymentAmount-asc"]')).toBeEnabled()
      await page.keyboard.press('Escape')
      await row.getByRole('link', { name: '缺少原件', exact: true }).click()
      await expect(page.getByRole('heading', { name: `${input.name} · 证照附件`, exact: true })).toBeVisible()
      await expectNoPageOverflow(page, '1024px 分供方证照来源')
    })
  }

  test('复用新建页签时按新选择类别重建空白草稿', async ({ page }) => {
    await page.goto('/base/supplier/form?category=材料供应商')
    await page.getByLabel('公司全称 *').fill('未保存的旧类别草稿')
    await page.goto('/base/supplier')

    await page.getByRole('button', { name: '新增分供方' }).click()
    const dialog = page.getByRole('dialog', { name: '选择分供方类别' })
    await dialog.getByRole('radio', { name: '劳务分包商' }).check()
    await dialog.getByRole('button', { name: '进入新建表单' }).click()

    await expect(page.getByLabel('分供方类别 *')).toHaveValue('劳务分包商')
    await expect(page.getByLabel('公司全称 *')).toHaveValue('')
  })

  test('主数据表单不伪装证照附件，保存后进入真实证照流程并承载长企业名称', async ({ page }) => {
    const longName = '广东省粤港澳大湾区超长企业名称建筑材料设备检测专业供应有限公司'
    await page.goto('/base/supplier/form?category=检测供应商')

    await expect(page.getByText('draft', { exact: true })).toHaveCount(0)
    const guidance = page.locator('[data-ui="supplier-credential-guidance"]')
    await expect(guidance).toContainText('保存分供方后可维护证照资料。')
    await expect(page.getByText('选择附件')).toHaveCount(0)
    await page.getByLabel('公司全称 *').fill(longName)
    await page.getByLabel('主要联系人 *').fill('长名称验收联系人')
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存', exact: true })
      .click()

    await expect(page).toHaveURL(/\/base\/supplier\/[^/?]+\?origin=real/)
    await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '证照附件', exact: true })).toHaveAttribute('href', /\/base\/supplier\/credential\/[^?]+\?origin=real/)

    for (const width of [...RESPONSIVE_WIDTHS, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible()
      await expectNoPageOverflow(page, `${width}px 长分供方名称详情`)
    }
  })

  test('短表单在各宽度保持内容滚动、字段可读与底部操作可达', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/supplier/form?category=材料供应商')

    const shell = page.locator('[data-ui="entity-form-shell"]')
    const content = shell.locator('[data-ui="supplier-form-scroll"]')
    const footer = shell.getByRole('group', { name: '表单操作' })
    const company = page.getByLabel('公司全称 *')
    const alias = page.getByLabel('简称/别名')
    for (const width of [...RESPONSIVE_WIDTHS, 1280]) {
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : 900,
      })
      await expect(shell.getByRole('navigation', { name: '表单分区' })).toHaveCount(0)
      await expect(content).toHaveCSS('overflow-y', 'auto')
      await expect(footer).toHaveCSS('position', 'sticky')
      await expect(footer).toBeInViewport()

      const positions = await Promise.all([company, alias].map(field =>
        field.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, top: rect.top }
        }),
      ))
      if (width >= 768) {
        expect(positions[0]!.top, `${width}px 公司全称与别名同行`).toBe(positions[1]!.top)
        expect(positions[0]!.left).toBeLessThan(positions[1]!.left)
      }
      else {
        expect(positions[0]!.top, `${width}px 公司全称与别名分行`).toBeLessThan(positions[1]!.top)
      }
      await expectNoPageOverflow(page, `${width}px 分供方短表单`)
    }
  })

  test('200% 等效宽度仍为单列表单且底部操作可达', async ({ page }) => {
    await page.setViewportSize(EQUIVALENT_200_PERCENT_VIEWPORT)
    await page.goto('/base/supplier/form?category=个人')

    const shell = page.locator('[data-ui="entity-form-shell"]')
    await expect(shell.getByRole('navigation', { name: '表单分区' })).toHaveCount(0)
    await expect(shell.getByRole('group', { name: '表单操作' })).toBeInViewport()
    await expect(page.getByLabel('分供方类别 *')).toHaveValue('个人')
    await expectNoPageOverflow(page, '200% 等效宽度分供方短表单')
  })
})
