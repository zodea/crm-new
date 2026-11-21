import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.describe('材采分供方零与未知', () => {
  function session(testInfo: TestInfo) {
    return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
  }

  async function reset(request: APIRequestContext, id: string) {
    for (const domain of ['suppliers', 'projects', 'material-contracts'] as const) {
      const response = await request.post(`/api/testing/${domain}/reset`, {
        headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
        data: { scenario: 'ready' },
      })
      expect(response.ok()).toBe(true)
    }
  }

  test.describe('Issue #277：项目—材采合同—分供方零值只读样板链', () => {
    test.beforeEach(async ({ page }, testInfo) => {
      const id = session(testInfo)
      await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
      await reset(page.context().request, id)
    })

    test('既有正式合同共用中央分供方身份，零结算进入真实空表并恢复来源上下文', async ({ page }) => {
      await page.goto('/project?search=中央正式材料&page=1&pageSize=20')
      const projectLink = page.getByRole('link', { name: '中央正式材料项目', exact: true })
      await expect(projectLink).toBeVisible({ timeout: 20_000 })
      await projectLink.click()

      const workspace = page.locator('[data-shell-workspace]')
      const materialJourneyLink = page.getByRole('link', { name: '查看材料采购合同（1）' })
      await workspace.evaluate(element => element.scrollTop = 48)
      await materialJourneyLink.focus()
      const projectScrollTop = await workspace.evaluate(element => element.scrollTop)
      await materialJourneyLink.press('Enter')
      await page.getByLabel('搜索材料采购合同').fill('既有中央')
      const contractLink = page.getByRole('link', { name: '既有中央材料采购合同' })
      await expect(contractLink).toBeVisible()
      await contractLink.click()

      const supplierLink = page.getByRole('link', { name: '中央正式材料供应商' })
      await expect(supplierLink).toHaveAttribute('href', '/base/supplier/supplier-real-318?origin=real')
      await page.getByRole('tab', { name: /支出结算/ }).click()
      const supplierFactLink = page.getByRole('link', { name: '查看分供方结算事实' })
      await workspace.evaluate(element => element.scrollTop = 96)
      await supplierFactLink.focus()
      const contractScrollTop = await workspace.evaluate(element => element.scrollTop)
      await supplierFactLink.press('Enter')

      await expect(page.getByRole('heading', { name: '中央正式材料供应商' })).toBeVisible()
      const summary = page.getByTestId('supplier-summary')
      await expect(summary).toContainText('累计结算金额¥0.00')
      await expect(page).toHaveURL(/\/base\/supplier\/supplier-real-318\?.*tab=settlements.*returnTo=/)
      await expect(page.getByText('暂无结算事实', { exact: true }).nth(1)).toBeVisible()

      await page.getByRole('link', { name: '返回材料采购合同' }).click()
      await expect(page.getByRole('link', { name: '查看分供方结算事实' })).toBeFocused()
      await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(contractScrollTop)
      await page.getByRole('link', { name: '返回材料采购合同列表' }).click()
      await expect(page.getByLabel('搜索材料采购合同')).toHaveValue('既有中央')
      await expect(page.getByRole('link', { name: '既有中央材料采购合同' })).toBeFocused()
      await page.getByRole('link', { name: '返回项目详情' }).click()
      await expect(page.getByRole('link', { name: '查看材料采购合同（1）' })).toBeFocused()
      await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(projectScrollTop)
      await page.getByRole('link', { name: '返回项目列表' }).click()
      await expect(page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })).toHaveValue('中央正式材料')
      await expect(page.getByRole('link', { name: '中央正式材料项目', exact: true })).toBeFocused()
    })
  })
})

test.describe('项目材采分供方旅程', () => {
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
      await expect(page.getByRole('tab', { name: /收票登记/ })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: /付款管理/ }).click()
      await page.reload()
      await expect(page.getByRole('tab', { name: /付款管理/ })).toHaveAttribute('aria-selected', 'true')

      await page.getByRole('link', { name: '返回材料采购合同' }).click()
      await expect(page.getByRole('tab', { name: /发票登记/ })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('link', { name: '返回材料采购合同列表' }).click()
      await expect(page.getByLabel('搜索材料采购合同')).toHaveValue('瓷砖')
      await expect(page.getByRole('link', { name: '瓷砖采购合同', exact: true })).toBeFocused()

      await page.getByRole('link', { name: '返回项目详情' }).click()
      await expect(page.getByRole('link', { name: '查看材料采购合同（3）' })).toBeFocused()
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

    test('全旅程在各宽度无页面级横滚', async ({ page }) => {
      const expectNoOverflowAcrossWidths = async (label: string) => {
        for (const width of RESPONSIVE_WIDTHS) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await expectNoPageOverflow(page, `#319 ${label} @ ${width}px`)
        }
      }
      await page.goto('/project/proj_demo_001?origin=demo')
      await expect(page.getByRole('heading', { name: '合和新城' })).toBeVisible({ timeout: 20_000 })
      await expectNoOverflowAcrossWidths('项目详情')
      await page.getByRole('link', { name: /查看材料采购合同/ }).click()
      await expectNoOverflowAcrossWidths('材采列表')
      await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
      await expectNoOverflowAcrossWidths('材采详情')
      await page.getByRole('link', { name: '查看分供方合同事实' }).click()
      await expect(page.getByRole('tab', { name: /支出合同/ })).toBeVisible()
      await expectNoOverflowAcrossWidths('分供方事实')
    })
  })
})
