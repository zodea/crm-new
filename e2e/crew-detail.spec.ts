import { randomUUID } from 'node:crypto'
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
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `crew-detail-${randomUUID()}` })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    const response = await page.request.post('/api/testing/crew-workers/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
    expect(response.ok(), await response.text()).toBe(true)
  })
  test('展示演示班组、责任范围和项目关联，各宽度页面不横向溢出', async ({ page }) => {
    await page.goto('/base/crew/crew_demo_001?origin=demo')

    const shell = page.locator('[data-ui="entity-detail-shell"]')
    const heading = shell.getByRole('heading', { name: '泥水A班' })
    await expect(heading)
      .toBeVisible({ timeout: 15_000 })
    await expect(shell.getByText('测试档案只读', { exact: true })).toBeVisible()
    await expect(shell.getByRole('link', { name: '编辑', exact: true })).toHaveCount(0)
    await expect(shell.getByText('班组主档', { exact: true })).toBeVisible()
    await expect(shell.getByText('成员', { exact: true }).last()).toBeVisible()
    await expect(shell.getByText(/^(项目与工资事实|当前成员与责任项目)$/)).toBeVisible()
    await expect(shell.getByText('137 **** 0001', { exact: true }).first()).toBeVisible()
    await expect(shell.getByText('13700110001', { exact: true })).toHaveCount(0)
    await expect(shell.getByText('13511220001', { exact: true })).toHaveCount(0)
    await expect(shell.getByRole('link', { name: '虞建华', exact: true }))
      .toHaveAttribute('href', /\/base\/worker\/wkr_demo_001\?origin=demo&returnTo=/)
    await expect(shell.getByRole('button', { name: '添加成员', exact: true })).toHaveCount(0)
    await expect(shell.getByRole('button', { name: '移出班组', exact: true })).toHaveCount(0)
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await expect(heading).toBeVisible()
      await expectNoPageOverflow(page, `班组详情 @ ${width}px`)
    }
  })

  test('窄窗头部键盘顺序稳定，密集关联表只在自身区域横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/crew/crew_demo_001?origin=demo')

    const back = page.getByRole('link', { name: '返回班组列表' })
    const member = page.getByRole('link', { name: '虞建华', exact: true })
    await expectTabSequence(page, back, [member], '只读班组返回入口与成员关系')
    await expectLocalHorizontalScroll(page.getByLabel('班组成员表，可横向滚动查看全部列'), '班组成员表')
    const projects = page.locator('section').filter({ has: page.getByText(/^(项目与工资事实|当前成员与责任项目)$/) })
    await expectLocalHorizontalScroll(projects.locator('div.overflow-x-auto'), '班组项目关联表')
    await expect(page.getByText('扣罚事实', { exact: true })).toBeVisible()
    await expectNoPageOverflow(page, '班组详情窄窗')
  })

  for (const input of [
    { name: '正式空班组', trade: '泥工', leader: '合成负责人甲', phone: '13900139000', masked: '139 **** 9000' },
    { name: '跨区域超长施工班组-墙地砖及防水综合作业队', trade: '综合工种', leader: '合成负责人乙', phone: '13700004567', masked: '137 **** 4567' },
  ]) {
    test(`正式空班组保持完整标题并展示真实空态：${input.name}`, async ({ page }) => {
      const name = input.name
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/base/crew/form')
      await page.getByLabel('班组名称 *').fill(name)
      await page.getByLabel('工种 *').fill(input.trade)
      await page.getByLabel('负责人 *').fill(input.leader)
      await page.getByLabel('联系电话 *').fill(input.phone)
      const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/crews') && response.request().method() === 'POST')
      await page.getByRole('group', { name: '表单操作' })
        .getByRole('button', { name: '保存并提交' })
        .click()

      const receipt = await saved
      expect(receipt.ok(), await receipt.text()).toBe(true)
      const id = (await receipt.json()).id
      await expect(page).toHaveURL(url => url.pathname === `/base/crew/${id}` && url.searchParams.get('origin') === 'real')
      await expect(page.getByRole('heading', { name })).toBeVisible()
      await expect(page.getByText('暂无成员关系', { exact: true })).toBeVisible()
      await expect(page.getByText(/^(暂无项目、责任或工资事实|暂无当前成员或责任项目)$/)).toBeVisible()
      await expect(page.getByText('暂无扣罚事实', { exact: true })).toBeVisible()
      await expect(page.getByText(input.masked, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(input.phone, { exact: true })).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expectNoPageOverflow(page, '班组详情长名称空态')
    })
  }

  test('不存在的班组保留返回入口', async ({ page }) => {
    await page.goto('/base/crew/not-exists')

    await expect(page.getByRole('status', { name: '班组不存在或来源不匹配' })).toBeVisible()
    await expect(page.getByRole('link', { name: '返回班组列表' }))
      .toHaveAttribute('href', '/base/crew')
  })
})
