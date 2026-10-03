import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

// 本地成本分类控制正向保留在 tests/project/cost-control.test.ts；
// 正式预算版本、科目保存及来源往返由 target-cost-central.spec.ts 验收。
for (const input of PROJECT_INPUTS) {
  test(`${input.label}中央预算尚未接管时保留未知，独立预算入口使用正式来源`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page, input)
    const dto = await fixture.read()
    expect(dto.item.budget.value).toBeNull()
    await fixture.open()
    await expect(page.getByRole('tab', { name: '成本预算', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '目标成本分类控制', exact: true })).toHaveCount(0)
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await sidebar.getByRole('searchbox', { name: '搜索菜单' }).fill('目标成本')
    const budgets = sidebar.getByRole('link', { name: '目标成本', exact: true })
    await expect(budgets).toHaveAttribute('href', '/project/target-cost')
    await budgets.click()
    await expect(page.getByRole('heading', { name: '目标成本列表', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '预算资料来源', exact: true })).toHaveValue('real')
    expect(fixture.errors).toEqual([])
  })
}
