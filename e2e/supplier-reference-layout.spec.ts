import { expect, test } from '@playwright/test'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

test.describe('Issue #193/#206：分供方直接参考布局', () => {
  test('列表使用单行工具栏、紧凑局部滚动表格和底部分页', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/base/supplier')

    const toolbar = page.locator('[data-ui="supplier-list-toolbar"]')
    await expect(toolbar).toBeVisible()
    await expect(toolbar).toHaveCSS('overflow-x', 'visible')
    await expect(toolbar.locator('[data-ui="supplier-list-toolbar-row"]')).toHaveCSS('flex-wrap', 'nowrap')
    await expect(toolbar.getByRole('searchbox', { name: /搜索公司名/ })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '刷新' })).toBeVisible()
    await expect(toolbar.getByRole('combobox', { name: '排序' })).toBeVisible()
    await expect(toolbar.getByRole('combobox', { name: '类别' })).toBeVisible()
    await expect(toolbar.getByRole('combobox', { name: '资料' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '列设置' })).toBeVisible()
    const importButton = toolbar.getByRole('button', { name: /导入分供方/ })
    await importButton.scrollIntoViewIfNeeded()
    await expect(importButton).toBeVisible()
    const createButton = toolbar.getByRole('button', { name: '新增分供方' })
    await expect(createButton).toBeVisible()

    const table = page.locator('[data-ui="supplier-list-table"]')
    await expect(table).toBeVisible()
    await expect(table.locator('.vxe-header--column').first()).toHaveCSS('height', '36px')
    await expect(table.locator('.vxe-body--column').first()).toHaveCSS('height', '36px')
    await expectLocalHorizontalScroll(
      table.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper'),
      '1024px 分供方表格',
    )
    await expect(table.getByText(/共 \d+ 条/)).toBeVisible()
    await expectNoPageOverflow(page, '1024px 分供方列表')
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

  for (const width of RESPONSIVE_WIDTHS) {
    test(`短表单在 ${width}px 保持内容滚动、字段可读与底部操作可达`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : 900,
      })
      await page.goto('/base/supplier/form?category=材料供应商')

      const shell = page.locator('[data-ui="entity-form-shell"]')
      const content = shell.locator('[data-ui="supplier-form-scroll"]')
      const footer = shell.getByRole('group', { name: '表单操作' })
      await expect(shell.getByRole('navigation', { name: '表单分区' })).toHaveCount(0)
      await expect(content).toHaveCSS('overflow-y', 'auto')
      await expect(footer).toHaveCSS('position', 'sticky')
      await expect(footer).toBeInViewport()

      const company = page.getByLabel('公司全称 *')
      const alias = page.getByLabel('简称/别名')
      const positions = await Promise.all([company, alias].map(field =>
        field.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, top: rect.top }
        }),
      ))
      if (width >= 768) {
        expect(positions[0]!.top).toBe(positions[1]!.top)
        expect(positions[0]!.left).toBeLessThan(positions[1]!.left)
      }
      else {
        expect(positions[0]!.top).toBeLessThan(positions[1]!.top)
      }
      await expectNoPageOverflow(page, `${width}px 分供方短表单`)
    })
  }

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
