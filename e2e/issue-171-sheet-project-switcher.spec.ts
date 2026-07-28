import { expect, test } from '@playwright/test'

async function openHome(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: width <= 768 ? 844 : 900 })
  await page.addInitScript(() => {
    localStorage.removeItem('ruihang-sidebar-pinned')
    localStorage.removeItem('ruihang-sidebar-groups')
    localStorage.removeItem('crm-recent-project-ids')
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
    const trigger = page.getByRole('button', { name: '打开通知中心' })
    await trigger.click()

    const drawer = page.getByRole('dialog', { name: '消息中心' })
    await expect(drawer).toBeVisible()
    await expectWorkspaceLocked(page)
    await expect(drawer).toHaveAttribute('data-overlay-surface', '')
    await expect(drawer).toHaveCSS('z-index', '9000')

    const typeSelect = drawer.getByRole('combobox')
    await typeSelect.click()
    const ownedLayer = page.locator('[data-overlay-owned][data-state="open"]').last()
    await expect(ownedLayer).toBeVisible()
    await expect(ownedLayer).toHaveCSS('z-index', '9000')

    await page.keyboard.press('Escape')
    await expect(ownedLayer).toBeHidden()
    await expect(drawer).toBeVisible()
    await expect(typeSelect).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  for (const width of [390, 768]) {
    test(`${width}px 移动侧栏使用语义层级、滚动锁与焦点返回`, async ({ page }) => {
      await openHome(page, width)
      const trigger = page.getByRole('button', { name: '切换侧边栏' })
      await trigger.click()

      const sheet = page.getByRole('dialog', { name: '导航菜单' })
      await expect(sheet).toBeVisible()
      await expectWorkspaceLocked(page)
      await expect(sheet).toHaveAttribute('data-overlay-surface', '')
      await expect(sheet).toHaveCSS('z-index', '9000')

      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await expect(trigger).toBeFocused()
    })
  }

  for (const width of [390, 768, 1440]) {
    test(`${width}px 项目切换器打开、选择并把焦点还给触发器`, async ({ page }) => {
      await openHome(page, width)
      const trigger = page.getByTestId('project-switcher-trigger').first()
      await trigger.click()

      const search = page.getByRole('combobox', { name: '搜索项目' })
      await expect(search).toBeVisible()
      await expect(search).toBeFocused()

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

      const alternative = page
        .getByRole('listbox', { name: '全部项目' })
        .locator('[role="option"][aria-selected="false"]')
        .first()
      await expect(alternative).toBeVisible()
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
