import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

const LISTS = [
  { path: '/contract/company-expense', title: '公司支出合同', project: false, category: true },
  { path: '/contract/other-expense', title: '其他支出合同', project: true, category: true },
  { path: '/contract/other-settlement', title: '其他支出结算', project: true, category: false },
  { path: '/material/settlement', title: '材料采购结算', project: true, category: false },
] as const

test.describe('Issue #196：辅助合同与结算列表', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 四类列表使用领域筛选且宽表只在局部横滚`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })

      for (const list of LISTS) {
        await page.goto(list.path)
        const toolbar = page.locator('[data-ui="contract-aux-list-toolbar"]')
        await expect(toolbar.getByRole('heading', { name: list.title }))
          .toBeVisible({ timeout: 30_000 })
        await expect(toolbar.getByRole('combobox', { name: '状态' })).toBeVisible()
        await expect(toolbar.getByRole('searchbox')).toBeVisible()
        await expect(toolbar.getByRole('button', { name: `新建${list.title}` })).toBeVisible()
        await expect(toolbar.getByRole('combobox', { name: '项目' }))
          .toHaveCount(list.project ? 1 : 0)
        await expect(toolbar.getByRole('combobox', { name: '类别' }))
          .toHaveCount(list.category ? 1 : 0)
        await expectNoPageOverflow(page, `${list.title} @ ${width}px`)

        if (width <= 768) {
          await expectLocalHorizontalScroll(
            page.locator('[data-ui="contract-aux-table"] .vxe-table--body-inner-wrapper').first(),
            `${list.title}表格 @ ${width}px`,
          )
        }
      }
    })
  }

  test('来源 query 可见、可清除，搜索无结果可恢复', async ({ page }) => {
    await page.goto('/material/settlement?project=project-demo&contract=contract-demo&supplier=supplier-demo')
    const context = page.locator('[data-ui="contract-aux-route-context"]')
    await expect(context).toBeVisible({ timeout: 30_000 })
    await expect(context.getByRole('button')).toHaveCount(3)

    await context.getByRole('button', { name: /清除项目：/ }).click()
    await expect(page).not.toHaveURL(/project=/)
    await expect(page).toHaveURL(/contract=/)
    await expect(page).toHaveURL(/supplier=/)

    const companyName = `E2E筛选合同-${Date.now()}`
    await page.goto('/contract/company-expense/form')
    await page.getByTestId('company-contract-name').fill(companyName)
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/contract\/company-expense\/form\/[^/?]+$/)
    await page.goto('/contract/company-expense')
    const search = page.locator('[data-ui="contract-aux-list-toolbar"]').getByRole('searchbox')
    await search.fill('绝对不存在的公司合同')
    const filteredEmpty = page.getByRole('status', { name: '没有符合条件的公司支出合同' })
    await expect(filteredEmpty).toHaveCount(1)
    await expect(filteredEmpty).toBeVisible()
    await filteredEmpty.getByRole('button', { name: '清除筛选' }).click()
    await expect(search).toHaveValue('')
  })

  test('行操作菜单支持 Enter、Escape 和焦点回归', async ({ page }) => {
    const name = `E2E公司合同-${Date.now()}`
    await page.goto('/contract/company-expense/form')
    await page.getByTestId('company-contract-name').fill(name)
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/contract\/company-expense\/form\/[^/?]+$/)
    await page.goto('/contract/company-expense')

    const trigger = page.getByRole('button', { name: `${name}公司支出合同操作` })
    await expect(trigger).toBeVisible({ timeout: 30_000 })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: '编辑' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })
})
