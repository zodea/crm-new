import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
})

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #7：首页共享施工进度甘特', () => {
  test('项目切换、真实排程与工程量下钻返回使用同一上下文', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/?project=proj_demo_001&origin=demo')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
    await expect(page.getByText('图表待实现 (#7)', { exact: true })).toHaveCount(0)
    await expect(page.getByText('合同总额', { exact: true })).toHaveCount(0)
    const projectSwitcher = page.getByTestId('project-switcher-trigger')
    await expect(projectSwitcher).toContainText('合和新城')
    await expect(page.getByText('户内1栋-2栋', { exact: true })).toBeVisible()
    await expect(page.getByText('计划区间', { exact: true })).toBeVisible()
    await expect(page.getByTestId('home-schedule-scroll').getByText('今天', { exact: true })).toBeVisible()

    await projectSwitcher.focus()
    await page.keyboard.press('ArrowDown')
    const projectSearch = page.getByRole('combobox', { name: '搜索项目' })
    await expect(projectSearch).toBeFocused()
    await projectSearch.fill('锦绣华庭')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/project=proj_demo_002/)
    await expect(page.getByText('锦绣华庭还没有施工排程', { exact: true })).toBeVisible()

    await projectSwitcher.click()
    await page.getByRole('combobox', { name: '搜索项目' }).fill('合和新城')
    await page.keyboard.press('Enter')
    const quantityTask = page.getByRole('button', { name: /卫生间回填及防水/ }).first()
    await expect(quantityTask).toBeVisible()
    await quantityTask.click()

    await expect(page).toHaveURL(/\/subcontract\/quantity\?.*from=home/)
    await expect(page.getByText('来自首页施工进度 · 户内1栋-2栋')).toBeVisible()
    await page.getByRole('link', { name: '返回首页该工序', exact: true }).click()
    await expect(page).toHaveURL(/\/\?.*project=proj_demo_001.*group=schedule_group_demo_001.*task=schedule_task_demo_03/)
    await expect(page.getByText('户内1栋-2栋', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /卫生间回填及防水/ }).first()).toBeVisible()

    expect(pageErrors).toEqual([])
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    test(`${viewport.width}px 项目切换与甘特局部滚动可达，页面不横滚`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/?project=proj_demo_001')
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('link', { name: '全部项目', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: '打开施工进度', exact: true })).toBeVisible()
      await expect(page.getByTestId('home-schedule-scroll').getByText('今天', { exact: true })).toBeVisible()

      const projectSwitcher = page.getByTestId('project-switcher-trigger')
      await expect(projectSwitcher).toContainText('合和新城')
      await projectSwitcher.click()
      await expect(page.getByRole('combobox', { name: '搜索项目' })).toBeVisible()
      await expect(page.getByRole('option', { name: /合和新城/ }).last()).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Escape')
      await expect(projectSwitcher).toBeFocused()

      const scroller = page.getByTestId('home-schedule-scroll')
      await expect(scroller).toBeVisible()
      const scroll = await scroller.evaluate((element) => {
        const start = element.scrollLeft
        element.scrollLeft = 80
        return {
          client: element.clientWidth,
          width: element.scrollWidth,
          moved: element.scrollLeft > start,
        }
      })
      if (scroll.width > scroll.client)
        expect(scroll.moved).toBe(true)

      await expectDocumentDoesNotOverflow(page)
    })
  }

  test('1440px 显示器在 200% 等效布局宽度下仍可操作且不横滚', async ({ page }) => {
    // 浏览器 200% 缩放会把 1440 物理像素收敛为约 720 CSS px 的布局视口。
    await page.setViewportSize({ width: 720, height: 500 })
    await page.goto('/?project=proj_demo_001')
    await page.waitForLoadState('networkidle')

    const projectSwitcher = page.getByTestId('project-switcher-trigger')
    await projectSwitcher.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('combobox', { name: '搜索项目' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(projectSwitcher).toBeFocused()

    const scroller = page.getByTestId('home-schedule-scroll')
    await expect(scroller).toBeVisible()
    await expect(page.getByRole('link', { name: '打开施工进度', exact: true })).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
  })
})
