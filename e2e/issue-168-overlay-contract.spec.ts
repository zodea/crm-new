import { expect, test } from '@playwright/test'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

test.describe('Issue #168：浮层组合契约扩展底座', () => {
  test('模态期间锁定应用工作区，嵌套关闭后不提前解锁', async ({ page }) => {
    await page.setViewportSize({ width: 1740, height: 974 })
    await installQuantityProductionFixture(page)

    const trigger = page.getByRole('button', { name: '责任配置', exact: true })
    const workspace = page.locator('[data-shell-workspace]')
    await trigger.click()

    const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    await expect(editor).toBeVisible()
    await expect.poll(() => workspace.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden')

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        plane: style.getPropertyValue('--z-overlay-plane').trim(),
        backdrop: style.getPropertyValue('--z-overlay-backdrop').trim(),
        surface: style.getPropertyValue('--z-overlay-surface').trim(),
        owned: style.getPropertyValue('--z-overlay-owned').trim(),
        toast: style.getPropertyValue('--z-toast').trim(),
        fullscreen: style.getPropertyValue('--z-page-fullscreen').trim(),
      }
    })
    expect(tokens).toEqual({
      plane: '9000',
      backdrop: '9000',
      surface: '9000',
      owned: '9000',
      toast: '9100',
      fullscreen: '100',
    })

    await editor.getByRole('checkbox', { name: '选择2层202户' }).check()
    await editor.getByRole('button', { name: '取消', exact: true }).click()

    const discard = page.getByRole('dialog', { name: '放弃未保存配置' })
    await expect(discard).toBeVisible()
    await discard.getByRole('button', { name: '取消', exact: true }).click()
    await expect(discard).toBeHidden()
    await expect(editor).toBeVisible()
    await expect.poll(() => workspace.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden')

    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog', { name: '放弃未保存配置' })
      .getByRole('button', { name: '放弃配置', exact: true })
      .click()

    await expect(editor).toBeHidden()
    await expect.poll(() => workspace.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto')
    await expect(trigger).toBeFocused()
  })
})

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

async function openHome(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: width <= 768 ? 844 : 900 })
  await page.addInitScript(() => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
    localStorage.removeItem('ruihang-sidebar-pinned')
    localStorage.removeItem('ruihang-sidebar-groups')
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

async function expectWorkspaceLocked(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-shell-workspace]')).toHaveCSS('overflow', 'hidden')
}

test.describe('Issue #171：Sheet、通知抽屉与项目切换器', () => {
  test('通知抽屉锁定工作区，子 Select 逐层关闭并恢复焦点', async ({ page }) => {
    await openHome(page, 1440)
    const trigger = page.getByRole('button', { name: /^打开通知中心/ })
    await trigger.click()

    const drawer = page.getByRole('dialog', { name: '消息中心' })
    await expect(drawer).toBeVisible()
    await expectWorkspaceLocked(page)
    await expect(drawer).toHaveAttribute('data-overlay-surface', '')
    await expect(drawer).toHaveCSS('z-index', '9000')

    const typeSelect = drawer.getByRole('button', { name: /^消息类型，已选/ })
    await typeSelect.click()
    const ownedLayer = page.locator('[data-overlay-owned][data-state="open"]').last()
    await expect(ownedLayer).toBeVisible()
    await expect(ownedLayer.getByRole('checkbox', { name: '付款审批', exact: true })).toBeVisible()
    await expect(ownedLayer).toHaveCSS('z-index', '9000')

    await page.keyboard.press('Escape')
    await expect(ownedLayer).toBeHidden()
    await expect(drawer).toBeVisible()
    await expect(typeSelect).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('390/768px 移动侧栏使用语义层级、滚动锁与焦点返回', async ({ page }) => {
    await openHome(page, 390)
    const trigger = page.getByRole('button', { name: '切换侧边栏' })
    const sheet = page.getByRole('dialog', { name: '导航菜单' })
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 })
      await trigger.click()

      await expect(sheet).toBeVisible()
      await expectWorkspaceLocked(page)
      await expect(sheet).toHaveAttribute('data-overlay-surface', '')
      await expect(sheet).toHaveCSS('z-index', '9000')

      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await expect(trigger).toBeFocused()
    }
  })

  for (const width of [390, 768, 1024, 1280, 1440]) {
    test(`${width}px 项目切换器打开、选择并把焦点还给触发器`, async ({ page }) => {
      await openHome(page, width)
      const trigger = page.getByTestId('project-switcher-trigger').first()
      await trigger.click()

      const search = page.getByRole('combobox', { name: '搜索项目' })
      await expect(search).toBeVisible()
      await expect(search).toBeFocused()
      await expect(page.getByText('最近使用', { exact: true })).toHaveCount(0)

      if (width <= 768) {
        const dialog = page.getByRole('dialog', { name: '选择项目' })
        await expect(dialog).toHaveAttribute('data-overlay-surface', '')
        await expect(dialog).toHaveCSS('z-index', '9000')
        await expectWorkspaceLocked(page)
      }
      else {
        const popover = page.locator('[data-overlay-owned][data-state="open"]').last()
        await expect(popover).toBeVisible()
        await expect(popover).toHaveCSS('z-index', '9000')
      }

      const projectList = page.getByRole('listbox', { name: '全部项目' })
      await search.fill('锦绣华庭')
      const alternative = projectList.getByRole('option', { name: /锦绣华庭/ })
      await expect(alternative).toBeVisible()
      await expect(alternative).toHaveAttribute('aria-selected', 'false')
      await alternative.click()

      await expect(search).toBeHidden()
      await expect(trigger).toBeFocused()
    })
  }

  test('归档范围 Sheet 进入模态栈并在 Esc 后恢复焦点', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 844 })
    await page.goto('/material/delivery/archive')
    await page.waitForLoadState('networkidle')

    const trigger = page.getByRole('button', { name: '选择归档范围' })
    await trigger.click()
    const sheet = page.getByTestId('archive-scope-sheet')

    await expect(sheet).toBeVisible()
    await expectWorkspaceLocked(page)
    await expect(sheet).toHaveAttribute('data-overlay-surface', '')
    await expect(sheet).toHaveCSS('z-index', '9000')

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})

async function openKitPage(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dev/kit-ui')
  await page.waitForLoadState('networkidle')
}

test.describe('Issue #172：全局浮层契约收缩', () => {
  test('模态期间 Toast 可读、可操作且不关闭 Dialog', async ({ page }) => {
    await openKitPage(page)
    await page.getByRole('button', { name: '软删除（可撤回）' }).click()

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已删除「测试项目」' })
    await expect(toast).toBeVisible()
    await page.getByRole('button', { name: 'simple（归档后修改）' }).click()

    const dialog = page.getByRole('dialog', { name: '修改已归档发票' })
    const toaster = toast.locator('xpath=ancestor::*[@data-sonner-toaster]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('z-index', '9000')
    await expect(toaster).toHaveCSS('z-index', '9100')

    await toast.getByRole('button', { name: '撤回' }).click()
    await expect(page.getByText('记录已恢复到原位置', { exact: true })).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('页签菜单在模态激活后关闭，且不能从页面层重新越过遮罩', async ({ page }) => {
    await openKitPage(page)
    const activeTab = page.locator('[data-shell-tab][data-active="true"]')

    await activeTab.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCSS('z-index', '9000')

    await page.getByRole('button', { name: 'simple（归档后修改）' }).click()
    const dialog = page.getByRole('dialog', { name: '修改已归档发票' })
    await expect(dialog).toBeVisible()
    await expect(menu).toBeHidden()

    await activeTab.click({ button: 'right', force: true })
    await expect(menu).toBeHidden()
    await expect(dialog).toBeVisible()
  })

  test('全屏编辑和开发面板只消费定稿语义令牌', async ({ page }) => {
    await openKitPage(page)
    await page.getByRole('button', { name: '打开 Mock 数据工具' }).click()
    const devPanel = page.locator('.fixed.inset-0').filter({ hasText: '开发工具' })
    await expect(devPanel).toHaveCSS('z-index', '8900')
    await devPanel.getByRole('button').first().click()

    await page.goto('/owner/change/new')
    await expect(page.getByRole('heading', { name: '新建 · 甲方变洽签' })).toBeVisible()
    const lineGrid = page.locator('#section-lines')
    await page.getByRole('button', { name: '全屏编辑' }).click()
    await expect(lineGrid).toHaveCSS('z-index', '100')

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        fullscreen: style.getPropertyValue('--z-page-fullscreen').trim(),
        legacyDrawer: style.getPropertyValue('--z-shell-drawer').trim(),
        legacyModal: style.getPropertyValue('--z-shell-modal').trim(),
        legacyOverlay: style.getPropertyValue('--z-shell-overlay').trim(),
        legacyPopover: style.getPropertyValue('--z-shell-popover').trim(),
      }
    })
    expect(tokens).toEqual({
      fullscreen: '100',
      legacyDrawer: '',
      legacyModal: '',
      legacyOverlay: '',
      legacyPopover: '',
    })
  })
})
