import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

// 本地支出外键与补充协议正向保留在 tests/project/expenditure-relations.test.ts。
// 当前中央详情从已接材采、其他支出和商务入口进入各领域，不恢复本地页签。
for (const [index, journey] of [
  { label: '材料采购合同', path: '/contract/material', locator: 'material' },
  { label: '其他支出合同', path: '/contract/other-expense', locator: 'auxiliary' },
  { label: '分包变洽签', path: '/subcontract/change', locator: 'commercial' },
  { label: '分包结算', path: '/subcontract/settlement', locator: 'commercial' },
].entries()) {
  test(`中央项目支出来源与稳定导航：${journey.label}`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page, PROJECT_INPUTS[index % PROJECT_INPUTS.length])
    await fixture.open()
    const scope = journey.locator === 'material'
      ? page.getByRole('region', { name: '材料采购合同', exact: true })
      : journey.locator === 'auxiliary' ? page.getByTestId('auxiliary-journey') : page.getByRole('region', { name: /^项目商务单据/ })
    const link = scope.getByRole('link', { name: new RegExp(journey.label) })
    await expect(link).toBeVisible()
    const target = new URL((await link.getAttribute('href'))!, page.url())
    expect(target.pathname).toBe(journey.path)
    expect(target.searchParams.get('projectId')).toBe(fixture.id)
    expect(target.searchParams.get('origin')).toBe('real')
    expect(new URL(target.searchParams.get('returnTo')!, page.url()).pathname).toBe(`/project/${fixture.id}`)
    await expect(page.getByRole('tab', { name: '支出合同管理', exact: true })).toHaveCount(0)
    await link.click()
    await expect(page).toHaveURL(target.href)
    expect(fixture.errors).toEqual([])
  })
}
