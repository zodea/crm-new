import { expect, test } from '@playwright/test'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

async function openResponsibilityDialog(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
  await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  await installQuantityProductionFixture(page)
  await page.getByRole('button', { name: '责任配置', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
  await expect(editor).toBeVisible()
  return editor
}

test.describe('Issue #170：Dialog 子浮层与嵌套确认', () => {
  test('嵌套确认遮罩覆盖父 Dialog，Esc 只关闭顶层并返回来源焦点', async ({ page }) => {
    const editor = await openResponsibilityDialog(page)
    const cancel = editor.getByRole('button', { name: '取消', exact: true })
    const parentBox = await editor.boundingBox()
    expect(parentBox).not.toBeNull()

    await editor.getByRole('checkbox', { name: '选择2层202户' }).check()
    await cancel.click()

    const discard = page.getByRole('dialog', { name: '放弃未保存配置' })
    await expect(discard).toBeVisible()
    const parentSurface = page.locator('[role="dialog"]').filter({ hasText: '户 × 工种责任配置' }).first()

    const nestedBackdrop = page.locator('[data-overlay-backdrop][data-state="open"][style*="--overlay-layer-offset: 10"]')
    await expect(nestedBackdrop).toHaveCSS('z-index', '9010')
    await expect(parentSurface).toHaveCSS('z-index', '9000')
    const backdropOwnsParentCorner = await nestedBackdrop.evaluate((backdrop, point) => {
      const top = document.elementFromPoint(point.x, point.y)
      return top === backdrop || (top != null && backdrop.contains(top))
    }, {
      x: (parentBox?.x ?? 0) + 20,
      y: (parentBox?.y ?? 0) + 20,
    })
    expect(backdropOwnsParentCorner).toBe(true)

    await page.keyboard.press('Escape')
    await expect(discard).toBeHidden()
    await expect(editor).toBeVisible()
    await expect(cancel).toBeFocused()
  })

  test('Dialog 内 Select 位于所属内容上方，Esc 后焦点返回触发器', async ({ page }) => {
    const editor = await openResponsibilityDialog(page)
    const tradeSelect = editor.getByRole('combobox', { name: '工种' })
    await tradeSelect.focus()
    await tradeSelect.press('ArrowDown')

    const option = page.getByRole('option', { name: '水暖工', exact: true })
    await expect(option).toBeVisible()
    const ownedLayer = page.locator('[data-overlay-owned][data-state="open"]').last()
    const editorSurface = page.locator('[data-overlay-surface][data-state="open"]').last()
    await expect(ownedLayer).toHaveCount(1, { timeout: 1000 })
    await expect(ownedLayer).toHaveCSS('z-index', '9000')
    await expect(editorSurface).toHaveCSS('z-index', '9000')

    const optionBox = await option.boundingBox()
    expect(optionBox).not.toBeNull()
    const optionIsTopmost = await option.evaluate((element, point) => {
      const top = document.elementFromPoint(point.x, point.y)
      return top === element || (top != null && element.contains(top))
    }, {
      x: (optionBox?.x ?? 0) + 4,
      y: (optionBox?.y ?? 0) + 4,
    })
    expect(optionIsTopmost).toBe(true)

    await page.keyboard.press('Escape')
    await expect(option).toBeHidden()
    await expect(editor).toBeVisible()
    await expect(tradeSelect).toBeFocused()
  })
})
