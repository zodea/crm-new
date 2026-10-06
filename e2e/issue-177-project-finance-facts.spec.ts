import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

// 往来调拨、付款申请及确认支付的独立金额和来源正向覆盖：
// tests/production/finance-storage.test.ts、tests/finance/payment-detail.test.ts。
// 中央详情当前只穿透已接管的收款，不读本地往来和支付明细。
for (const input of PROJECT_INPUTS) {
  test(`${input.label}：收款中央入口保持项目身份，不混入本地往来与确认支付`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page, input)
    await fixture.open()
    const receipts = page.getByRole('region', { name: '项目收款', exact: true })
    const link = receipts.getByRole('link', { name: '查看收款登记', exact: true })
    const target = new URL((await link.getAttribute('href'))!, page.url())
    expect(target.pathname).toBe('/finance/receipt')
    expect(target.searchParams.get('projectId')).toBe(fixture.id)
    expect(target.searchParams.get('origin')).toBe('real')
    const returnTo = new URL(target.searchParams.get('returnTo')!, page.url())
    expect(returnTo.pathname).toBe(`/project/${fixture.id}`)
    expect(returnTo.hash).toBe('#project-receipt-link')
    for (const name of ['往来收款', '往来付款', '支付记录'])
      await expect(page.getByRole('region', { name, exact: true })).toHaveCount(0)

    await link.click()
    await expect(page).toHaveURL(target.href)
    expect(fixture.errors).toEqual([])
  })
}
