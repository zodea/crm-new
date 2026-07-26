import { expect, test } from '@playwright/test'

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #114：施工进度 WBS 排程', () => {
  test('真实 seed 支持改期、人工进度、基线与工程量穿透返回', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/schedule')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'WBS 排程与实际进度' })).toBeVisible()
    await expect(page.getByTestId('project-switcher-trigger')).toContainText('合和新城')
    await expect(page.getByText('户内1栋-2栋', { exact: true })).toBeVisible()
    await expect(page.getByText('2026-05-06', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.dependency-path').first()).toBeVisible()

    await page.getByRole('button', { name: '放线及新建墙体', exact: true }).click()
    const manualDialog = page.getByRole('dialog', { name: /工序详情 · 放线及新建墙体/ })
    await expect(manualDialog.getByText('非工程量工序由排程人工填报')).toBeVisible()
    await manualDialog.getByRole('slider', { name: '人工进度百分比' }).fill('75')
    await manualDialog.getByRole('button', { name: '保存调整', exact: true }).click()
    await expect(page.getByText('工序计划已更新', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '设置基准', exact: true }).click()
    const baselineDialog = page.getByRole('dialog', { name: '设置当前计划为基准？' })
    await baselineDialog.getByRole('button', { name: '设置基准', exact: true }).click()
    await expect(page.getByText('排程基准已保存', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '卫生间回填及防水', exact: true }).click()
    const quantityDialog = page.getByRole('dialog', { name: /工序详情 · 卫生间回填及防水/ })
    await expect(quantityDialog.getByText('由工程量阶段完成事实自动派生，不可手填')).toBeVisible()
    await quantityDialog.getByRole('button', { name: '查看工程量', exact: true }).click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\?.*from=schedule/)
    await expect(page.getByText('来自施工排程 · 户内1栋-2栋')).toBeVisible()
    await expect(page.getByText('户内1栋-2栋', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('1栋 · 2层', { exact: true })).toBeVisible()
    await expect(page.getByText('2栋 · 2层', { exact: true })).toBeVisible()
    await expect(page.getByText(/映射分项：.*墙面防水.*地面防水/)).toBeVisible()
    await page.getByRole('link', { name: '返回该工序', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\?.*task=schedule_task_demo_03/)
    await expect(page.getByRole('dialog', { name: /工序详情 · 卫生间回填及防水/ })).toBeVisible()

    expect(pageErrors).toEqual([])
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    test(`${viewport.width}px 页面不横滚且 WBS / 甘特操作可达`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/schedule')
      await page.waitForLoadState('networkidle')

      const scroller = page.getByTestId('schedule-scroll')
      await expect(scroller).toBeVisible()
      const ganttToggle = page.getByRole('button', { name: '甘特', exact: true })
      if (await ganttToggle.isVisible()) {
        await ganttToggle.click()
        await expect(page.getByText('7月', { exact: true }).first()).toBeVisible()
        await page.getByRole('button', { name: 'WBS', exact: true }).click()
        await expect(page.getByRole('button', { name: '放线及新建墙体', exact: true })).toBeVisible()
      }
      else {
        await expect(page.getByText('7月', { exact: true }).first()).toBeVisible()
        await expect(page.getByRole('button', { name: '放线及新建墙体', exact: true })).toBeVisible()
      }
      await expectDocumentDoesNotOverflow(page)
    })
  }

  test('新建楼栋分组是独立页面并提供 22 道可调整工序', async ({ page }) => {
    await page.goto('/schedule/new?project=proj_demo_001')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: '楼栋分组与标准工序' })).toBeVisible()
    await expect(page.getByText('FS 前置', { exact: true })).toBeVisible()
    await expect(page.locator('.process-row').filter({ has: page.locator('input[type="checkbox"]') })).toHaveCount(22)
    await expect(page.getByRole('button', { name: '生成排程', exact: true })).toBeVisible()
  })
})
