import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

// 到货归档的有效明细、项目隔离、原件及中央来源正向覆盖：
// tests/project/delivery-archive.test.ts、e2e/delivery-central.spec.ts。
// 材采入口与到货归档是不同事实；尚未接管的本地送货单不会拼入中央项目。
for (const input of PROJECT_INPUTS) {
  test(`${input.label}：真实零材采关系仍可导航，不伪装成本地到货归档`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page, input)
    await fixture.open()
    const materials = page.getByRole('region', { name: '材料采购合同', exact: true })
    const link = materials.getByRole('link', { name: '查看材料采购合同（0）', exact: true })
    await expect(link).toBeVisible()
    const target = new URL((await link.getAttribute('href'))!, page.url())
    expect(target.pathname).toBe('/contract/material')
    expect(target.searchParams.get('projectId')).toBe(fixture.id)
    expect(target.searchParams.get('origin')).toBe('real')
    await expect(page.getByRole('region', { name: '项目到货归档', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '物资管理', exact: true })).toHaveCount(0)

    await link.click()
    await expect(page).toHaveURL(target.href)
    expect(fixture.errors).toEqual([])
  })
}
