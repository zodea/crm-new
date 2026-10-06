import { expect, test } from '@playwright/test'
import { installProjectCentralFixture } from './helpers/project-central-fixture'

// 旧发票归档与项目范围的正向覆盖保留在 tests/stores/invoice-archive.test.ts、
// tests/project/detail-aggregate.test.ts、tests/project/management-fee.test.ts 和 tests/components/ProjectDetailScreen.test.ts。
// 中央详情不把本地票面差额、缺失收款来源或未接管税款展示成真实税额。
const SOURCE_FAILURES = [
  { status: 'unavailable', reason: 'receipt-source:unavailable', label: '收款来源暂时不可用，请重新读取' },
  { status: 'forbidden', reason: 'receipt-source:forbidden', label: '当前无权读取收款事实' },
] as const

for (const failure of SOURCE_FAILURES) {
  test(`收款来源 ${failure.status}：未知金额不冒零，基础资料仍可查看`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page)
    const dto = await fixture.read()
    await page.route(`**/api/read/projects/${fixture.id}?*`, route => route.fulfill({
      json: { ...dto, item: { ...dto.item, income: { ...dto.item.income, value: null, status: 'undefined', missingSources: [failure.reason] } } },
    }))
    await fixture.open()

    const receipts = page.getByRole('region', { name: '项目收款', exact: true })
    await expect(receipts).toContainText(failure.label)
    await expect(receipts.getByText('有效收款 ¥0.00', { exact: true })).toHaveCount(0)
    await expect(receipts.getByRole('link', { name: '查看收款登记', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '票据信息', exact: true })).toHaveCount(0)
    await expect(page.getByRole('group', { name: '增值税', exact: true })).toHaveCount(0)
    await expect(page.getByRole('group', { name: '税负率', exact: true })).toHaveCount(0)
    expect(fixture.errors).toEqual([])
  })
}
