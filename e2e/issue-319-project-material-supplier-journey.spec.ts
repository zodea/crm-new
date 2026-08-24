import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(
  request: APIRequestContext,
  id: string,
  materialScenario: 'ready' | 'empty' | 'forbidden' | 'unavailable' = 'ready',
) {
  for (const [domain, scenario] of [
    ['projects', 'ready'],
    ['material-contracts', materialScenario],
    ['suppliers', 'ready'],
  ] as const) {
    const response = await request.post(`/api/testing/${domain}/reset`, {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
      data: { scenario },
    })
    expect(response.ok()).toBe(true)
  }
}

test.describe('Issue #319：项目—材采合同—分供方旅程', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
  })

  test('逐级进入四类分供方事实，并恢复合同、项目列表页签与焦点', async ({ page }) => {
    await page.goto('/project?search=合和&pageSize=20')
    const projectLink = page.getByRole('link', { name: '合和新城', exact: true })
    await expect(projectLink).toBeVisible({ timeout: 20_000 })
    await projectLink.click()
    await expect(page.getByRole('heading', { name: '合和新城' })).toBeFocused()

    await page.getByRole('link', { name: '查看材料采购合同（3）' }).click()
    await expect(page).toHaveURL(/\/contract\/material\?.*projectId=proj_demo_001.*origin=demo.*returnTo=/)
    await expect(page.getByRole('link', { name: '返回项目详情' })).toBeVisible()

    await page.getByLabel('搜索材料采购合同').fill('瓷砖')
    const contractLink = page.getByRole('link', { name: '瓷砖采购合同', exact: true })
    await expect(contractLink).toBeVisible()
    await contractLink.click()
    await expect(page).toHaveURL(/\/contract\/con_demo_cg01\?.*contractKind=material.*returnTo=/)
    await page.getByRole('tab', { name: /发票登记/ }).click()
    await page.getByRole('link', { name: '查看分供方收票事实' }).click()

    await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_007\?.*tab=invoices.*returnTo=/)
    await expect(page.getByRole('tab', { name: /收票事实/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /付款事实/ }).click()
    await page.reload()
    await expect(page.getByRole('tab', { name: /付款事实/ })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('link', { name: '返回材料采购合同' }).click()
    await expect(page.getByRole('tab', { name: /发票登记/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('link', { name: '返回材料采购合同列表' }).click()
    await expect(page.getByLabel('搜索材料采购合同')).toHaveValue('瓷砖')
    await expect(page.getByRole('link', { name: '瓷砖采购合同', exact: true })).toBeFocused()

    await page.getByRole('link', { name: '返回项目详情' }).click()
    await expect(page.getByRole('heading', { name: '合和新城' })).toBeFocused()
    await page.getByRole('link', { name: '返回项目列表' }).click()
    await expect(page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })).toHaveValue('合和')
    await expect(page.getByRole('link', { name: '合和新城', exact: true })).toBeFocused()
  })

  test('真实零合同仍进入专属空列表；禁止状态不伪装为零', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'empty')
    await page.goto('/project/proj_demo_001?origin=demo')
    await page.getByRole('link', { name: '查看材料采购合同（0）' }).click()
    await expect(page.getByRole('status', { name: '暂无材料采购合同' })).toBeVisible()

    await reset(page.context().request, id, 'forbidden')
    await page.goto('/project/proj_demo_001?origin=demo')
    await expect(page.getByText('无材料采购合同查看权限')).toBeVisible()
    await expect(page.getByRole('link', { name: /查看材料采购合同/ })).toHaveCount(0)
  })

  test('材采聚合读取失败可重试，恢复后不再冒充未接入', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'unavailable')
    await page.goto('/project/proj_demo_001?origin=demo')

    const failure = page.getByRole('alert', { name: '材料采购合同读取失败' })
    await expect(failure).toBeVisible()
    const retry = failure.getByRole('button', { name: '重试' })
    await reset(page.context().request, id, 'ready')
    await retry.click()

    await expect(page.getByRole('link', { name: '查看材料采购合同（3）' })).toBeVisible()
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 全旅程无页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/project/proj_demo_001?origin=demo')
      await expect(page.getByRole('heading', { name: '合和新城' })).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#319 项目详情 @ ${width}px`)
      await page.getByRole('link', { name: /查看材料采购合同/ }).click()
      await expectNoPageOverflow(page, `#319 材采列表 @ ${width}px`)
      await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
      await expectNoPageOverflow(page, `#319 材采详情 @ ${width}px`)
      await page.getByRole('link', { name: '查看分供方合同事实' }).click()
      await expect(page.getByRole('tab', { name: /合同事实/ })).toBeVisible()
      await expectNoPageOverflow(page, `#319 分供方事实 @ ${width}px`)
    })
  }
})
