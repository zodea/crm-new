import { expect, test } from '@playwright/test'

test('项目详情十页签：四个真实页签读取 SQLite，六个待建设页签显示统一占位卡', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project/proj_demo_001')
  await page.waitForLoadState('networkidle')
  const contentTabs = page.getByRole('main')

  await expect(page.getByRole('heading', { name: '基础信息' })).toBeVisible()
  await expect(page.getByText('HHXC-01', { exact: true })).toBeVisible()

  await contentTabs.getByRole('tab', { name: '施工合同管理', exact: true }).click()
  const construction = page.getByRole('region', { name: '施工合同' })
  await expect(construction.getByText('合和新城施工总承包合同', { exact: true })).toBeVisible()
  await expect(construction.getByText('¥32,388,422.00', { exact: true })).toBeVisible()
  await expect(construction.getByText('含税合同金额合计')).toContainText('¥32,388,422.00')
  await construction.getByRole('searchbox', { name: '搜索施工合同' }).fill('总承包')
  await expect(construction.getByText('施工合同（1）', { exact: true })).toBeVisible()
  await construction.getByRole('searchbox', { name: '搜索施工合同' }).fill('不存在的合同')
  await expect(construction.getByText('施工合同（0）', { exact: true })).toBeVisible()
  await expect(construction.getByText('¥0.00', { exact: true })).toBeVisible()
  await construction.getByRole('searchbox', { name: '搜索施工合同' }).fill('')
  await expect(page.getByRole('region', { name: '补充协议' }).getByText('¥320,000.00', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '甲方变洽签' }).getByText('¥120,000.00', { exact: true })).toBeVisible()

  await contentTabs.getByRole('tab', { name: '票税管理', exact: true }).click()
  const outgoing = page.getByRole('region', { name: '开票申请' })
  await expect(outgoing.getByText('2026年6月进度开票申请', { exact: true })).toBeVisible()
  await expect(outgoing.getByText('¥25,663,629.00', { exact: true })).toBeVisible()

  await contentTabs.getByRole('tab', { name: '资金管理', exact: true }).click()
  await expect(page.getByRole('region', { name: '收款登记' }).getByText('¥25,367,027.00', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('region', { name: '付款申请' }).getByText('¥4,200,000.00', { exact: true }).first()).toBeVisible()

  for (const tab of ['成本预算', '支出合同管理', '往来款', '支付明细', '物资管理', '竣工验收及保修']) {
    await contentTabs.getByRole('tab', { name: tab, exact: true }).click()
    await expect(page.getByRole('heading', { name: tab, exact: true })).toBeVisible()
    await expect(page.getByText('待建设', { exact: true })).toBeVisible()
  }

  expect(pageErrors, '子表页签旅程不应产生客户端运行错误').toEqual([])
})
