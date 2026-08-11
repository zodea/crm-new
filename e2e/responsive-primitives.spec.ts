import { expect, test } from '@playwright/test'

const MATRIX = [
  { width: 390, height: 844, metricColumns: 2, formColumns: 1, gutter: 12, path: '/dev/kit-atoms' },
  { width: 768, height: 900, metricColumns: 4, formColumns: 3, gutter: 15.36, path: '/dev/kit-atoms' },
  { width: 1024, height: 900, metricColumns: 4, formColumns: 3, gutter: 20.48, path: '/dev/kit-atoms' },
  // 项目详情在宽屏仍保留辅助栏；主内容列按最小可读宽度自然为 4 列。
  { width: 1440, height: 1000, metricColumns: 4, formColumns: 4, gutter: 24, path: '/project/proj_demo_001' },
] as const

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #112 R1：共享响应式原语', () => {
  for (const viewport of MATRIX) {
    test(`MetricGrid 在 ${viewport.width}px 按可读宽度降列`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto(viewport.path)
      await page.waitForLoadState('networkidle')

      const metric = page.getByRole('group', { name: '主合同金额' })
      await expect(metric).toBeVisible()
      const metricGrid = metric.locator('..')
      const columns = await metricGrid.evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      )

      expect(columns).toBe(viewport.metricColumns)
      await documentDoesNotOverflow(page)
    })
  }

  for (const viewport of MATRIX) {
    test(`form-grid 在 ${viewport.width}px 使用容器驱动列数`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/project/proj_demo_001')
      await page.waitForLoadState('networkidle')

      const detailGrid = page.locator('.form-grid').first()
      const detailColumns = await detailGrid.evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      )
      expect(detailColumns).toBe(viewport.formColumns)
      await documentDoesNotOverflow(page)
    })

    test(`FormDialog 在 ${viewport.width}px 保持分区导航与主动作可达`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/dev/kit-ui')
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: '打开行级对象弹窗', exact: true }).click()

      const dialog = page.getByRole('dialog', { name: '编辑清单分项' })
      const sectionSelect = dialog.getByRole('combobox', { name: '表单分区' })
      const anchorNav = dialog.locator('.form-dialog__nav')
      const fieldColumns = await dialog.locator('.form-dialog-demo-grid').first().evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      )
      if (viewport.width === 390) {
        await expect(sectionSelect).toBeVisible()
        await expect(anchorNav).toBeHidden()
        expect(fieldColumns).toBe(1)
      }
      else {
        await expect(sectionSelect).toBeHidden()
        await expect(anchorNav).toBeVisible()
        expect(fieldColumns).toBe(2)
      }

      const saveButton = dialog.getByRole('button', { name: '保存', exact: true })
      await expect(saveButton).toBeVisible()
      const saveBox = await saveButton.boundingBox()
      expect(saveBox?.x).toBeGreaterThanOrEqual(0)
      expect((saveBox?.x ?? 0) + (saveBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
      await documentDoesNotOverflow(page)
    })

    test(`TablePager 在 ${viewport.width}px 保持翻页控件可达`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/dev/kit-table')
      await page.waitForLoadState('networkidle')

      const pager = page.getByRole('navigation', { name: '表格分页' })
      await expect(pager).toBeVisible()
      await expect(pager.getByRole('button', { name: '上一页' })).toBeVisible()
      await expect(pager.getByRole('button', { name: '下一页' })).toBeVisible()
      await expect(pager.getByRole('combobox', { name: '每页条数' })).toBeVisible()

      const visiblePageButtons = await pager.evaluate(element =>
        Array.from(element.querySelectorAll<HTMLElement>('[data-pager-page]'))
          .filter(button => getComputedStyle(button).display !== 'none')
          .length,
      )
      expect(visiblePageButtons).toBe(viewport.width === 390 ? 1 : 5)
      await documentDoesNotOverflow(page)
    })
  }

  test('工作区 gutter 按四档视口渐进收敛', async ({ page }) => {
    for (const viewport of MATRIX) {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const workspace = page.locator('[data-shell-workspace]')
      const padding = await workspace.evaluate(element => ({
        left: Number.parseFloat(getComputedStyle(element).paddingLeft),
        right: Number.parseFloat(getComputedStyle(element).paddingRight),
      }))
      expect(padding.left).toBeCloseTo(viewport.gutter, 2)
      expect(padding.right).toBeCloseTo(viewport.gutter, 2)
      await documentDoesNotOverflow(page)
    }
  })
})
