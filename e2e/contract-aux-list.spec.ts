import { randomUUID } from 'node:crypto'
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
  { path: '/contract/company-expense', title: '公司支出合同', root: '[data-testid="auxiliary-list"]', create: '新建合同', project: false, category: true },
  { path: '/contract/other-expense', title: '其他支出合同', root: '[data-testid="auxiliary-list"]', create: '新建合同', project: true, category: true },
  { path: '/contract/other-settlement', title: '其他支出结算', root: '[data-testid="other-settlement-list"]', create: '新建结算', project: true, category: false },
  { path: '/material/settlement', title: '材料采购结算', root: '[data-ui="contract-aux-list-toolbar"]', create: '新建材料采购结算', project: true, category: false },
] as const

test.describe('Issue #196：辅助合同与结算列表', () => {
  test.beforeEach(async ({ page }) => {
    const session = `contract-aux-${randomUUID()}`
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
    for (const domain of ['projects', 'suppliers', 'auxiliary-contracts', 'other-settlements']) {
      const response = await page.request.post(`/api/testing/${domain}/reset`, {
        headers: { 'x-ruihang-test-reset': '1' },
        data: { scenario: 'ready' },
      })
      expect(response.ok(), await response.text()).toBe(true)
    }
  })

  test('四类列表使用领域筛选，各宽度宽表只在局部横滚', async ({ page }) => {
    test.setTimeout(120_000)

    for (const list of LISTS) {
      await page.goto(list.path)
      const root = page.locator(list.root)
      await expect(root.getByRole('heading', { name: list.title }))
        .toBeVisible({ timeout: 30_000 })
      const status = root.getByRole('button', { name: /^状态，已选 0 项$/ })
      const project = list.path === '/material/settlement'
        ? root.getByRole('button', { name: /^项目，已选 0 项$/ })
        : root.getByRole('combobox', { name: '筛选项目', exact: true })

      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
        await expect(status).toBeVisible()
        await expect(root.locator('input[placeholder^="搜索"]')).toBeVisible()
        await expect(root.getByRole('button', { name: list.create, exact: true })).toBeVisible()
        if (list.project)
          await expect(project).toBeVisible()
        else
          await expect(project).toHaveCount(0)
        if (list.category) {
          if (width >= 1024)
            await expect(root.getByRole('complementary', { name: '合同类别' })).toBeVisible()
          else
            await expect(root.getByRole('button', { name: /^类别，已选 0 项$/ })).toBeVisible()
        }
        else {
          await expect(root.getByRole('button', { name: /^类别，已选/ })).toHaveCount(0)
        }
        await expectNoPageOverflow(page, `${list.title} @ ${width}px`)

        if (width <= 768) {
          await expectLocalHorizontalScroll(
            page.locator(list.path === '/material/settlement' ? '[data-ui="contract-aux-table"] .vxe-table--body-inner-wrapper' : `${list.root} .vxe-table--body-inner-wrapper`).first(),
            `${list.title}表格 @ ${width}px`,
          )
        }
      }
    }
  })

  test('来源 query 可见、可清除，搜索无结果可恢复', async ({ page }) => {
    await page.goto('/material/settlement?project=project-demo&contract=contract-demo&supplier=supplier-demo')
    const context = page.locator('[data-ui="contract-aux-route-context"]')
    await expect(context).toBeVisible({ timeout: 30_000 })
    await expect(context.getByRole('button')).toHaveCount(3)

    await context.getByRole('button', { name: /清除项目：/ }).click()
    await expect(page).not.toHaveURL(/project=/)
    await expect(page).toHaveURL(/contract=/)
    await expect(page).toHaveURL(/supplier=/)

    const companyName = 'E2E筛选合同'
    await page.goto('/contract/company-expense/form')
    await page.getByLabel('合同名称 *', { exact: true }).fill(companyName)
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/contract\/company-expense\/form\/[^/?]+(?:\?|$)/)
    await page.goto('/contract/company-expense')
    const search = page.getByPlaceholder('搜索合同名称 / 编号 / 对方单位')
    await search.fill('绝对不存在的公司合同')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    const filteredEmpty = page.getByRole('status', { name: '没有符合条件的合同' })
    await expect(filteredEmpty).toHaveCount(1)
    await expect(filteredEmpty).toBeVisible()
    await filteredEmpty.getByRole('button', { name: '清除筛选' }).click()
    await expect(search).toHaveValue('')
  })

  test('行操作菜单支持 Enter、Escape 和焦点回归', async ({ page }) => {
    const name = 'E2E公司合同'
    await page.goto('/contract/company-expense/form')
    await page.getByLabel('合同名称 *', { exact: true }).fill(name)
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/contract\/company-expense\/form\/[^/?]+(?:\?|$)/)
    await page.goto('/contract/company-expense')

    const trigger = page.getByRole('button', { name: `${name}操作`, exact: true })
    await expect(trigger).toBeVisible({ timeout: 30_000 })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: '查看详情' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })
})
