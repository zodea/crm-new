import { expect, test } from '@playwright/test'
import { installProjectCentralFixture } from './helpers/project-central-fixture'
import { expectLocalHorizontalScroll, expectNoPageOverflow, tabUntilFocused } from './helpers/responsive'

// 旧经营汇总与只读来源穿透正向覆盖保留在 tests/project/detail-aggregate.test.ts、
// tests/project/finance-facts.test.ts、tests/components/ProjectMetrics.test.ts。
// 中央已接旅程由当前来源感知卡片进入；未接管领域不重建本地十页签。
test('中央项目的材采、商务、工资与收款使用同一项目身份且来源不混合', async ({ page }) => {
  const fixture = await installProjectCentralFixture(page)
  await fixture.open()
  const dto = await fixture.read()
  expect(dto.item.dataOrigin).toBe('real')
  expect(dto.item.project.id).toBe(fixture.id)
  expect(dto.item.budget.value).toBeNull()
  await expect(page.getByRole('region', { name: '材料采购合同', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: /^项目商务单据/ })).toBeVisible()
  await expect(page.getByRole('region', { name: '工资实际收付', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '项目收款', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '项目经营数据', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '施工合同管理', exact: true })).toHaveCount(0)
  await expect(page.getByText('测试数据仅供查看。', { exact: true })).toHaveCount(0)
  expect(fixture.errors).toEqual([])
})

const VIEWPORTS = [
  { label: '390px', width: 390, height: 844, requireLocalScroll: true },
  { label: '768px', width: 768, height: 900, requireLocalScroll: true },
  { label: '1024px', width: 1024, height: 900, requireLocalScroll: false },
  { label: '1280px', width: 1280, height: 900, requireLocalScroll: false },
  { label: '1440px', width: 1440, height: 1000, requireLocalScroll: false },
  { label: '1440px @ 200%', width: 720, height: 900, requireLocalScroll: true },
] as const

for (const viewport of VIEWPORTS) {
  test(`${viewport.label} 中央项目保持页面边界，工资密表局部滚动及导航键盘可达`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const fixture = await installProjectCentralFixture(page)
    await fixture.open()
    const table = page.getByRole('region', { name: '工资实际收付明细，可横向滚动', exact: true })
    await expect(table).toBeVisible()
    await expectNoPageOverflow(page, `${viewport.label} 中央项目详情`)
    if (viewport.requireLocalScroll) {
      await expectLocalHorizontalScroll(table, `${viewport.label} 工资实际收付`)
      await table.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      expect(await table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    }
    const receipts = page.getByRole('region', { name: '项目收款', exact: true }).getByRole('link', { name: '查看收款登记', exact: true })
    await tabUntilFocused(page, receipts)
    await expect(receipts).toBeInViewport()
    await expectNoPageOverflow(page, `${viewport.label} 键盘导航后`)
    expect(fixture.errors).toEqual([])
  })
}
