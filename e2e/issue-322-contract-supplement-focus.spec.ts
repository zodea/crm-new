import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, kind: 'construction' | 'subcontract') {
  const response = await request.post(`/api/testing/${kind === 'construction' ? 'construction' : 'subcontract'}-contracts/reset`, {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario: 'ready' },
  })
  expect(response.ok()).toBe(true)
}

test.describe('Issue #322：补充协议稳定聚焦与来源恢复', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id, 'construction')
    await reset(page.context().request, id, 'subcontract')
  })

  test('施工补充协议从列表进入、稳定聚焦并恢复筛选、滚动与原合同焦点', async ({ page }) => {
    const sessionResponse = await page.request.get('/api/read/business-session')
    expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
    const { workspaceId, actorId } = await sessionResponse.json()
    const projectResponse = await page.request.post('/api/commands/projects', { data: {
      workspaceId,
      actorId,
      requiredCapability: 'project:write',
      commandId: randomUUID(),
      baseVersion: null,
      action: 'draft',
      draft: { name: '补充协议滚动验收项目', status: '筹备中' },
      attachments: {},
    } })
    expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
    const { id: projectId } = await projectResponse.json()
    for (const input of [
      { label: '01', date: '2026-09-12', amount: 100 },
      { label: '02', date: '2028-02-29', amount: 125.5 },
      { label: '03', date: '2026-09-13', amount: 250 },
      { label: '04', date: '2026-09-14', amount: 500 },
      { label: '05', date: '2026-09-15', amount: 750 },
      { label: '06', date: '2026-09-16', amount: 1000 },
    ]) {
      const response = await page.request.post('/api/commands/construction-contracts', { data: {
        workspaceId,
        actorId,
        requiredCapability: 'construction-contract:write',
        commandId: randomUUID(),
        baseVersion: null,
        action: 'draft',
        draft: { name: `合和新城滚动合同${input.label}`, projectId, signDate: input.date, amount: input.amount },
        attachments: {},
      } })
      expect(response.ok(), await response.text()).toBe(true)
      expect((await response.json()).id).toBeTruthy()
    }
    await page.setViewportSize({ width: 390, height: 420 })
    await page.goto('/contract/construction?search=合和新城&pageSize=20')
    const contractLink = page.getByRole('link', { name: '合和新城施工总承包合同', exact: true })
    await expect(contractLink).toBeVisible({ timeout: 20_000 })
    await contractLink.scrollIntoViewIfNeeded()
    const savedScroll = await page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)
    expect(savedScroll).toBeGreaterThan(0)
    await contractLink.click()
    await page.getByRole('tab', { name: /补充合同/ }).click()
    await page.getByRole('link', { name: '材料调价补充协议' }).click()

    await expect(page).toHaveURL(/contractKind=construction&tab=supplements&focus=cs_demo_sg01_01/)
    await expect(page.locator('#construction-contract-fact-cs_demo_sg01_01')).toBeFocused()
    await page.getByRole('link', { name: '返回施工合同列表' }).click()

    await expect(page).toHaveURL(/\/contract\/construction\?search=%E5%90%88%E5%92%8C%E6%96%B0%E5%9F%8E&pageSize=20&nav=origin_/)
    await expect(page.getByLabel('搜索施工合同')).toHaveValue('合和新城')
    await expect(page.getByLabel('每页数量')).toHaveValue('20')
    await expect(page.getByRole('link', { name: '合和新城施工总承包合同', exact: true })).toBeFocused()
    await expect.poll(() => page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)).toBe(savedScroll)
  })

  test('分包补充协议从列表进入、稳定聚焦并恢复筛选、滚动与原合同焦点', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 })
    await page.goto('/contract/subcontract?search=泥水&pageSize=20')
    const contractLink = page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true })
    await expect(contractLink).toBeVisible({ timeout: 20_000 })
    await contractLink.scrollIntoViewIfNeeded()
    const savedScroll = await page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)
    expect(savedScroll).toBeGreaterThan(0)
    await contractLink.click()
    await page.getByRole('tab', { name: '分包变洽签' }).click()
    await page.getByRole('link', { name: '劳务范围补充协议' }).click()

    await expect(page).toHaveURL(/contractKind=subcontract&tab=changes&focus=sub-supplement-1/)
    await expect(page.locator('#subcontract-contract-fact-sub-supplement-1')).toBeFocused()
    await page.getByRole('link', { name: '返回分包合同列表' }).click()

    await expect(page).toHaveURL(/\/contract\/subcontract\?search=%E6%B3%A5%E6%B0%B4&pageSize=20&nav=origin_/)
    await expect(page.getByLabel('搜索分包合同')).toHaveValue('泥水')
    await expect(page.getByLabel('每页数量')).toHaveValue('20')
    await expect(page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true })).toBeFocused()
    await expect.poll(() => page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)).toBe(savedScroll)
  })

  test('直接深链加载父合同，并区分补充协议父子错配和目标不存在', async ({ page }) => {
    await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=cs_demo_sg01_01')
    await expect(page.getByRole('heading', { name: '合和新城施工总承包合同' })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#construction-contract-fact-cs_demo_sg01_01')).toBeFocused()

    await page.goto('/contract/con_demo_sg02?origin=demo&contractKind=construction&tab=supplements&focus=cs_demo_sg01_01')
    await expect(page.getByText('补充协议与施工合同不匹配')).toBeVisible({ timeout: 20_000 })

    await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=supplement-missing')
    await expect(page.getByText('补充协议不存在或已删除')).toBeVisible({ timeout: 20_000 })

    await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=sub-supplement-1')
    await expect(page.getByRole('heading', { name: '泥水班组劳务分包合同' })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#subcontract-contract-fact-sub-supplement-1')).toBeFocused()

    await page.goto('/contract/con_demo_fb02?origin=demo&contractKind=subcontract&tab=changes&focus=sub-supplement-1')
    await expect(page.getByText('补充协议与分包合同不匹配')).toBeVisible({ timeout: 20_000 })

    await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=supplement-missing')
    await expect(page.getByText('聚焦的分包合同事实不存在或已删除')).toBeVisible({ timeout: 20_000 })

    await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=%00')
    await expect(page.getByText('施工合同详情查询参数无效')).toBeVisible({ timeout: 20_000 })

    await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=%00')
    await expect(page.getByText('分包合同详情查询参数无效')).toBeVisible({ timeout: 20_000 })
  })

  test('两类补充协议聚焦后在各宽度无页面级横滚', async ({ page }) => {
    const expectNoOverflowAcrossWidths = async (label: string) => {
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `#322 ${label} @ ${width}px`)
      }
    }
    await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=cs_demo_sg01_01')
    await expect(page.locator('#construction-contract-fact-cs_demo_sg01_01')).toBeFocused({ timeout: 20_000 })
    await expectNoOverflowAcrossWidths('施工补充协议聚焦')

    await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=sub-supplement-1')
    await expect(page.locator('#subcontract-contract-fact-sub-supplement-1')).toBeFocused({ timeout: 20_000 })
    await expectNoOverflowAcrossWidths('分包补充协议聚焦')
  })
})
