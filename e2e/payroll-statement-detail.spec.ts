import { expect, test } from '@playwright/test'

// 健康真实发放、零分配、原表与冻结值不同、删除历史及五档明细滚动，
// 统一由 payroll-central.spec.ts 的真实八表受控迁入旅程覆盖。
test.describe('工资历史详情的失效边界', () => {
  test('不存在的稳定工资ID明确报错，返回保原多状态且不切首项', async ({ page }) => {
    await page.goto('/subcontract/payroll/missing-payroll-record?origin=real&month=2026-08&status=%5B%22draft%22%2C%22checked%22%5D')
    await expect(page.getByRole('heading', { name: '工资历史详情', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.locator('[aria-label="工资金额与状态"]')).toHaveCount(0)
    const back = page.getByRole('link', { name: '返回工资台账', exact: true })
    await back.focus()
    await expect(back).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '工资台账', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '工资状态，已选 2 项', exact: true })).toBeVisible()
  })
  test('关系来源参数不完整时不降级到无归属的工资详情', async ({ page }) => {
    await page.goto('/subcontract/payroll/missing-payroll-record?origin=real&ownerKind=worker')
    await expect(page.getByRole('alert')).toContainText('工资来源身份不完整', { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '工资历史详情', exact: true })).toHaveCount(0)
  })
})
