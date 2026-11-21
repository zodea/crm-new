import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test.describe('KitUI real-browser keyboard contracts', () => {
  test('uses arrow keys to move and activate SegTab', async ({ page }) => {
    await page.goto('/dev/kit-atoms')
    await expect(page.getByRole('heading', { name: 'KitAtoms 原子库演示' })).toBeVisible({
      timeout: 20_000,
    })

    const allTab = page.getByRole('tab', { name: '全部 34' })
    const pendingTab = page.getByRole('tab', { name: '待校对 5' })
    await allTab.focus()
    await page.keyboard.press('ArrowRight')

    await expect(pendingTab).toBeFocused()
    await expect(pendingTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('activeTab = pending', { exact: true })).toBeVisible()
  })

  test('opens and selects a SelectFilter option using only the keyboard', async ({ page }) => {
    await page.goto('/dev/kit-atoms')
    const stage = page.getByRole('combobox', { name: '阶段' })
    await expect(stage).toBeVisible({ timeout: 20_000 })

    await stage.focus()
    await page.keyboard.press('Space')
    const current = page.getByRole('option', { name: '全部阶段' })
    const next = page.getByRole('option', { name: '施工中' })
    await expect(current).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(next).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByText(/stage = progress/)).toBeVisible()
  })

  test('puts safe dialog focus on cancel and returns Escape as cancellation', async ({ page }) => {
    await page.goto('/dev/kit-ui')
    await expect(page.getByRole('button', { name: 'simple（归档后修改）' })).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole('button', { name: 'simple（归档后修改）' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()
    await expect(page.getByText('simple confirm 返回：false', { exact: true })).toBeVisible()
  })

  test('focuses the first form field and cancels the form with Escape', async ({ page }) => {
    await page.goto('/dev/kit-ui')
    const openForm = page.getByRole('button', { name: '打开表单弹窗' })
    await expect(openForm).toBeVisible({ timeout: 20_000 })

    await openForm.click()
    const name = page.getByRole('textbox', { name: /公司全称/ })
    await expect(name).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('formModal 已取消（返回 null）', { exact: true })).toBeVisible()
  })
})

test.describe('KitButton 三态原语', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/kit-ui')
    await expect(page.getByRole('button', { name: '模拟提交', exact: true })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('loading 立即禁用、保留原文并锁定宽度', async ({ page }) => {
    const button = page.getByRole('button', { name: '模拟提交', exact: true })
    const counter = page.getByText(/提交调用次数：/)
    const before = await button.boundingBox()

    await button.click()

    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toHaveAttribute('data-state', 'loading')
    await expect(button).toContainText('模拟提交')
    await expect(button.locator('[data-kit-button-spinner]')).toBeVisible()
    await button.click({ force: true })
    await expect(counter).toHaveText('提交调用次数：1')

    const during = await button.boundingBox()
    expect(during?.width).toBeCloseTo(before?.width ?? 0, 0)

    const geometry = await button.evaluate((element) => {
      const buttonRect = element.getBoundingClientRect()
      const spinnerRect = element.querySelector<HTMLElement>('[data-kit-button-spinner]')!.getBoundingClientRect()
      const labelRect = element.querySelector<HTMLElement>('[data-kit-button-label]')!.getBoundingClientRect()
      return {
        leftInset: spinnerRect.left - buttonRect.left,
        rightGap: labelRect.left - spinnerRect.right,
        labelRightInset: buttonRect.right - labelRect.right,
      }
    })
    expect(geometry.leftInset).toBeGreaterThanOrEqual(3.5)
    expect(geometry.rightGap).toBeGreaterThanOrEqual(3.5)
    expect(geometry.labelRightInset).toBeGreaterThanOrEqual(3.5)

    await expect(button).toBeEnabled({ timeout: 3_000 })
    await expect(button).toHaveAttribute('data-state', 'default')
  })

  test('显式 success 缩为勾后约一秒复位', async ({ page }) => {
    const button = page.getByRole('button', { name: '原地保存', exact: true })

    await button.click()
    await expect(button).toHaveAttribute('data-state', 'loading')
    await expect(button).toHaveAttribute('data-state', 'success', { timeout: 3_000 })
    await expect(button.locator('[data-kit-button-check]')).toBeVisible()
    await expect(button).toHaveAttribute('data-state', 'default', { timeout: 3_000 })
    await expect(button).toContainText('原地保存')
  })
})

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

interface WorkspaceGeometry {
  clientWidth: number
  contentLeft: number
}

async function readWorkspaceGeometry(page: import('@playwright/test').Page): Promise<WorkspaceGeometry> {
  return page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')!
    const content = workspace.querySelector<HTMLElement>('.max-w-3xl')!
    return {
      clientWidth: workspace.clientWidth,
      contentLeft: content.getBoundingClientRect().left,
    }
  })
}

test.describe('KitUI 浮层几何稳定性', () => {
  test('confirm 打开与关闭不改变工作区内容横向位置', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/dev/kit-ui')
    const trigger = page.getByRole('button', { name: 'simple（归档后修改）' })
    await expect(trigger).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-shell-workspace]')).toHaveCSS('scrollbar-gutter', 'stable')

    const before = await readWorkspaceGeometry(page)
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '修改已归档发票' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('[data-shell-workspace]')).toHaveCSS('overflow-y', 'hidden')

    const opened = await readWorkspaceGeometry(page)
    expect(Math.abs(opened.clientWidth - before.clientWidth)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(opened.contentLeft - before.contentLeft)).toBeLessThanOrEqual(0.5)

    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toBeHidden()
    const closed = await readWorkspaceGeometry(page)
    expect(Math.abs(closed.clientWidth - before.clientWidth)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(closed.contentLeft - before.contentLeft)).toBeLessThanOrEqual(0.5)
  })
})
