import { expect, test } from '@playwright/test'

test('往来调拨与实际支付保持不同事实和来源入口', async ({ page }) => {
  await page.goto('/project/proj_demo_001')

  await page.getByRole('tab', { name: '往来款', exact: true }).click()
  const receipts = page.getByRole('region', { name: '往来收款', exact: true })
  await expect(receipts.getByRole('link', { name: 'WL-SK-001' })).toHaveAttribute(
    'href',
    '/finance/current/cr_mz0x1_0',
  )
  const currentPayments = page.getByRole('region', { name: '往来付款', exact: true })
  await expect(currentPayments.getByRole('link', { name: 'WL-FK-001' })).toHaveAttribute(
    'href',
    '/finance/current/cp_mz0x1_0',
  )

  await page.getByRole('tab', { name: '支付明细', exact: true }).click()
  const paymentRecords = page.getByRole('region', { name: '支付记录', exact: true })
  await expect(paymentRecords.getByRole('link', { name: 'ZF-2026-001' })).toHaveAttribute(
    'href',
    '/finance/records/payment_demo_proj001_1',
  )
  await expect(paymentRecords.getByText('confirmed', { exact: true })).toBeVisible()
  await expect(paymentRecords.getByLabel('筛选结果合计')).toContainText('¥4,200,000.00')
  await expect(page.getByText('待建设', { exact: true })).toHaveCount(0)
})
