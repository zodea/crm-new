import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  expectTabSequence,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

test.describe('Issue #194：班组详情', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 展示真实班组、责任范围和项目关联，页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/base/crew/crew_demo_001')

      const shell = page.locator('[data-ui="entity-detail-shell"]')
      await expect(shell.getByRole('heading', { name: '泥水A班' }))
        .toBeVisible({ timeout: 15_000 })
      await expect(shell.getByText('泥水工', { exact: true }).first()).toBeVisible()
      await expect(shell.getByRole('link', { name: '编辑班组' }))
        .toHaveAttribute('href', '/base/crew/form/crew_demo_001')
      await expect(shell.getByRole('region', { name: /工种与责任范围/ })).toBeVisible()
      await expect(shell.getByRole('region', { name: /班组成员/ })).toBeVisible()
      await expect(shell.getByRole('region', { name: /项目参与与核算关联/ })).toBeVisible()
      await expect(shell.getByText('137 **** 0001', { exact: true })).toBeVisible()
      await expect(shell.getByText('13700110001', { exact: true })).toHaveCount(0)
      await expect(shell.getByText('13511220001', { exact: true })).toHaveCount(0)
      await expect(shell.getByRole('link', { name: '虞建华', exact: true }))
        .toHaveAttribute('href', '/base/worker/wkr_demo_001')
      await expectNoPageOverflow(page, `班组详情 @ ${width}px`)
    })
  }

  test('窄窗头部键盘顺序稳定，密集关联表只在自身区域横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/crew/crew_demo_001')

    const back = page.getByRole('link', { name: '返回班组列表' })
    const edit = page.getByRole('link', { name: '编辑班组' })
    await expectTabSequence(page, back, [edit], '班组详情头部操作')
    await expectLocalHorizontalScroll(page.getByTestId('crew-members-scroll'), '班组成员表')
    await expectLocalHorizontalScroll(page.getByTestId('crew-projects-scroll'), '班组项目关联表')
    await expect(page.getByRole('status', { name: /暂无扣罚记录/ })).toBeVisible()
    await expectNoPageOverflow(page, '班组详情窄窗')
  })

  test('长名称空班组保持完整标题并展示真实空态', async ({ page }) => {
    const name = `跨区域超长施工班组-${Date.now()}-墙地砖及防水综合作业队`
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/crew/form')
    await page.getByLabel('班组名称 *').fill(name)
    await page.getByLabel('工种 *').fill('综合工种')
    await page.getByLabel('负责人 *').fill('测试负责人')
    await page.getByLabel('联系电话 *').fill('13900139000')
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存并提交' })
      .click()

    await expect(page).toHaveURL(/\/base\/crew\/[^/]+$/)
    await expect(page.getByRole('heading', { name })).toBeVisible()
    await expect(page.getByRole('status', { name: /暂无班组成员/ })).toBeVisible()
    await expect(page.getByRole('status', { name: /暂无项目关联/ })).toBeVisible()
    await expect(page.getByRole('status', { name: /暂无扣罚记录/ })).toBeVisible()
    await expect(page.getByText('139 **** 9000', { exact: true })).toBeVisible()
    await expect(page.getByText('13900139000', { exact: true })).toHaveCount(0)
    await expectNoPageOverflow(page, '班组详情长名称空态')
  })

  test('不存在的班组保留返回入口', async ({ page }) => {
    await page.goto('/base/crew/not-exists')

    await expect(page.getByRole('status', { name: '班组不存在或已删除' })).toBeVisible()
    await expect(page.getByRole('link', { name: '返回班组列表' }))
      .toHaveAttribute('href', '/base/crew')
  })
})
