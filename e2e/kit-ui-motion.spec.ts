import { expect, test } from '@playwright/test'

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
