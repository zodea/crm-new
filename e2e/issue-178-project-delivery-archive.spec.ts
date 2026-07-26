import { expect, test } from '@playwright/test'

test('物资页签只展示当前项目已归档送货单及有效明细聚合', async ({ page }) => {
  await page.goto('/project/proj_demo_001')

  await page.getByRole('tab', { name: '物资管理', exact: true }).click()

  const archive = page.getByRole('region', { name: '项目到货归档', exact: true })
  await expect(archive.getByRole('link', { name: 'SH-2026-0712-001' })).toHaveAttribute(
    'href',
    '/material/delivery/archive/del_mdv001_0',
  )
  await expect(archive.getByText('¥16,430.00', { exact: true }).first()).toBeVisible()
  await expect(archive.getByText('待补分供方', { exact: true })).toBeVisible()
  await expect(archive.getByText('仅文件名', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('待建设', { exact: true })).toHaveCount(0)
})
