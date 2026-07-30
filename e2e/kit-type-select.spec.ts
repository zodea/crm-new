import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test('KitUI typeSelect：8 类付款申请、键盘确定与取消返回值', async ({ page }) => {
  await page.goto('/dev/kit-ui')
  await page.getByRole('button', { name: '新建付款申请', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '新建付款申请' })
  const radios = dialog.getByRole('radio')
  await expect(dialog).toBeVisible()
  await expect(radios).toHaveCount(8)
  await expect(radios.first()).toBeChecked()
  await expect(radios.first()).toBeFocused()

  await radios.first().press('ArrowDown')
  const second = dialog.getByRole('radio', { name: '无合同（人材料分包）付款申请' })
  await expect(second).toBeChecked()
  await expect(second).toBeFocused()
  await second.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page.getByText(
    'typeSelect 确定返回：no-contract-labor-material',
    { exact: true },
  )).toBeVisible()

  await page.getByRole('button', { name: '新建付款申请', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByText(
    'typeSelect 已取消（返回 null）',
    { exact: true },
  )).toBeVisible()
})

test('390px typeSelect 保持视口内滚动且页面不横溢', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dev/kit-ui')
  await page.getByRole('button', { name: '新建付款申请', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '新建付款申请' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  await expectNoPageOverflow(page, '390px KitUI typeSelect')
})
