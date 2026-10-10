import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

const MATRIX = [
  { width: 390, height: 844, gutter: 8 },
  { width: 768, height: 900, gutter: 8 },
  { width: 1024, height: 900, gutter: 10.24 },
  { width: 1280, height: 900, gutter: 12 },
  { width: 1440, height: 1000, gutter: 12 },
] as const

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #112 R1：共享响应式原语', () => {
  test('MetricGrid 在各宽度按可读宽度降列', async ({ page }) => {
    await page.goto('/dev/kit-atoms')
    await page.waitForLoadState('networkidle')

    const metric = page.getByRole('group', { name: '主合同金额' })
    await expect(metric).toBeVisible()
    const metricGrid = metric.locator('..')
    for (const viewport of MATRIX) {
      await page.setViewportSize(viewport)
      const columns = await metricGrid.evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      )

      expect(columns).toBeGreaterThanOrEqual(1)
      expect(columns).toBeLessThanOrEqual(5)
      for (const label of ['主合同金额', '增补合同额', '变更后合同额', '项目收款', '项目可用资金余额']) {
        const card = metricGrid.getByRole('group', { name: label, exact: true })
        await expect(card).toBeVisible()
        expect((await card.boundingBox())!.width, `${viewport.width}px ${label}`).toBeGreaterThanOrEqual(160)
      }
      await documentDoesNotOverflow(page)
    }
  })

  for (const input of [PROJECT_INPUTS[0], PROJECT_INPUTS[1]]) {
    test(`项目资料网格在各宽度使用容器驱动列数：${input.name}`, async ({ page }) => {
      const fixture = await installProjectCentralFixture(page, input)
      await fixture.open()
      const detailGrid = page.locator('header[aria-labelledby="project-detail-title"] dl')
      await expect(detailGrid.getByRole('term')).toHaveText(['业务流程阶段', '经营类型', '项目经理', '客户(甲方)', '承包单位'])
      await expect(detailGrid).toContainText(fixture.input.manager)
      for (const viewport of MATRIX) {
        await page.setViewportSize(viewport)
        const geometry = await detailGrid.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return { left: bounds.left, right: bounds.right, cells: [...element.children].map(cell => ({ left: cell.getBoundingClientRect().left, right: cell.getBoundingClientRect().right, width: cell.getBoundingClientRect().width })) }
        })
        for (const cell of geometry.cells) {
          expect(cell.width, `${viewport.width}px 资料单元宽度`).toBeGreaterThanOrEqual(140)
          expect(cell.left).toBeGreaterThanOrEqual(geometry.left)
          expect(cell.right).toBeLessThanOrEqual(geometry.right + 1)
        }
        await documentDoesNotOverflow(page)
      }
    })
  }

  // 窄屏为分区下拉、宽屏为锚点导航，验收对象是弹窗打开时的初始形态，保持按宽度生成用例。
  for (const viewport of MATRIX) {
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
  }

  test('TablePager 在各宽度保持翻页控件可达', async ({ page }) => {
    await page.goto('/dev/kit-table')
    await page.waitForLoadState('networkidle')

    const pager = page.getByRole('navigation', { name: '表格分页' })
    for (const viewport of MATRIX) {
      await page.setViewportSize(viewport)
      await expect(pager).toBeVisible()
      await expect(pager.getByRole('button', { name: '上一页' })).toBeVisible()
      await expect(pager.getByRole('button', { name: '下一页' })).toBeVisible()
      await expect(pager.getByRole('combobox', { name: '每页条数' })).toBeVisible()
      await expect.poll(() => pager.evaluate(element =>
        Array.from(element.querySelectorAll<HTMLElement>('[data-pager-page]'))
          .filter(button => getComputedStyle(button).display !== 'none')
          .length,
      ), `${viewport.width}px 可见页码数`).toBe(viewport.width === 390 ? 1 : 5)
      await documentDoesNotOverflow(page)
    }
  })

  test('工作区紧凑留白在各宽度保持左右对称', async ({ page }) => {
    await page.goto('/dev/kit-atoms')
    await page.waitForLoadState('networkidle')

    const workspace = page.locator('[data-shell-workspace]')
    for (const viewport of MATRIX) {
      await page.setViewportSize(viewport)
      const padding = await workspace.evaluate(element => ({
        left: Number.parseFloat(getComputedStyle(element).paddingLeft),
        right: Number.parseFloat(getComputedStyle(element).paddingRight),
      }))
      expect(padding.left, `${viewport.width}px 左留白`).toBeCloseTo(viewport.gutter, 2)
      expect(padding.right, `${viewport.width}px 右留白`).toBeCloseTo(viewport.gutter, 2)
      await expectNoPageOverflow(page, `工作区留白 @ ${viewport.width}px`)
    }
  })
})
