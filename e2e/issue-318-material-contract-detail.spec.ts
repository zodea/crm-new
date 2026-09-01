import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'demo-forbidden'
const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, scenario: Scenario = 'ready') {
  const response = await request.post('/api/testing/material-contracts/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok()).toBe(true)
}

test.describe('Issue #318：材料采购合同中央只读详情', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
  })

  test('列表进入演示详情，七页签、来源、关系与真实空态刷新保持', async ({ page }) => {
    await page.goto('/contract/material?search=瓷砖')
    await expect(page.getByTestId('material-contract-list').getByRole('heading', { name: '材料采购合同' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
    await expect(page).toHaveURL(/\/contract\/con_demo_cg01\?origin=demo&contractKind=material&returnTo=/)
    await expect(page.getByRole('heading', { name: '瓷砖采购合同' })).toBeVisible()
    await expect(page.getByText('演示只读')).toBeVisible()
    await expect(page.getByTestId('material-contract-edit')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001?origin=demo')
    await expect(page.getByRole('link', { name: '广东宏宇陶瓷有限公司' })).toHaveAttribute('href', '/base/supplier/sup_demo_007?origin=demo')
    await expect(page.getByRole('tab')).toHaveCount(7)
    await page.getByRole('tab', { name: /材料管理/ }).click()
    await expect(page).toHaveURL(/tab=materials/)
    await expect(page.getByRole('status', { name: '暂无关联直调记录' })).toBeVisible()
    await expect(page.getByRole('status', { name: '暂无关联出库记录' })).toBeVisible()
    await page.getByRole('tab', { name: /发票登记/ }).click()
    await expect(page.getByText('瓷砖首期收票')).toBeVisible()
    await expect(page.getByRole('link', { name: '瓷砖首期收票' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('瓷砖首期收票')).toBeVisible()
    await page.getByRole('link', { name: '返回材料采购合同列表' }).click()
    await expect(page.getByLabel('搜索材料采购合同')).toHaveValue('瓷砖')
  })

  test('受控迁入的既有正式合同按稳定 ID 刷新并进入显式编辑', async ({ page }) => {
    await page.goto('/contract/material?search=既有中央')
    await page.getByRole('link', { name: '既有中央材料采购合同' }).click()
    await expect(page).toHaveURL(/\/contract\/contract-existing-318\?origin=real&contractKind=material/)
    await expect(page.getByRole('heading', { name: '既有中央材料采购合同' })).toBeVisible()
    await page.reload()
    await page.getByTestId('material-contract-edit').click()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央材料采购合同')
    await page.getByLabel('【保存】后关闭').uncheck()
    await page.getByLabel('合同名称 *').fill('既有中央材料采购合同（留在表单）')
    const saved = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page).toHaveURL(/\/contract\/material\/form\/contract-existing-318/)
    await page.reload()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央材料采购合同（留在表单）')
  })

  test('无效查询显式报错；保留旧列表的刷新失败仍可见并可重试', async ({ page }, testInfo) => {
    await page.goto('/contract/material?pageSize=13')
    await expect(page.getByText('材料采购合同查询条件无效')).toBeVisible()
    await page.getByRole('button', { name: '清除无效条件' }).click()
    await expect(page.getByRole('link', { name: '瓷砖采购合同', exact: true })).toBeVisible()

    const id = session(testInfo)
    await reset(page.context().request, id, 'unavailable')
    await page.getByLabel('搜索材料采购合同').fill('瓷砖')
    await expect(page.getByRole('alert')).toContainText('当前保留上一次成功读取的列表')
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  test('正式合同经中央命令新建、详情、编辑与刷新闭合', async ({ page }) => {
    await page.goto('/contract/material/form')
    await expect(page.getByRole('heading', { name: /新建 · 材料采购合同/ })).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('合同名称 *').fill('中央正式瓷砖合同')
    await page.getByRole('combobox', { name: '检索项目' }).click()
    await page.getByText('中央正式材料项目').click()
    await page.getByRole('combobox', { name: '检索分供方' }).click()
    await page.getByText('中央正式材料供应商').click()
    await page.getByLabel('合同内容简述 *').fill('正式瓷砖采购')
    await page.getByLabel('签约日期 *').fill('2026-08-24')
    const created = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await created).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同' })).toBeVisible()
    await page.getByTestId('material-contract-edit').click()
    await page.getByLabel('合同名称 *').fill('中央正式瓷砖合同（已编辑）')
    const updated = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await updated).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同（已编辑）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同（已编辑）' })).toBeVisible()
  })

  test('HTTP 接缝明确区分禁止、暂不可用、缺失、来源错配与演示未授权', async ({ page }, testInfo) => {
    const id = session(testInfo)
    const request = page.context().request
    const cases = [
      ['/api/read/material-contracts/missing?origin=real', 404, 'not-found'],
      ['/api/read/material-contracts/con_demo_cg01?origin=real&includeDemo=true', 404, 'relationship-mismatch'],
    ] as const
    for (const [url, status, code] of cases) {
      const response = await request.get(url, { headers: { 'x-ruihang-test-session': id } })
      expect(response.status()).toBe(status)
      expect(await response.json()).toMatchObject({ data: { code } })
    }
    await reset(request, id, 'demo-forbidden')
    const demo = await request.get('/api/read/material-contracts/con_demo_cg01?origin=demo&includeDemo=true', { headers: { 'x-ruihang-test-session': id } })
    expect(demo.status()).toBe(403)
    await reset(request, id, 'forbidden')
    await page.goto('/contract/material')
    await expect(page.getByText('无材料采购合同查看权限')).toBeVisible()
    await reset(request, id, 'unavailable')
    await page.goto('/contract/con_demo_cg01?origin=demo&contractKind=material')
    await expect(page.getByText('材料采购合同中央读取服务暂时不可用')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 列表、详情与宽表无页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/contract/material?search=瓷砖')
      await expect(page.getByTestId('material-contract-list')).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#318 列表 @ ${width}px`)
      await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
      await expect(page.getByTestId('material-contract-detail')).toBeVisible()
      await expectNoPageOverflow(page, `#318 详情 @ ${width}px`)
      await page.getByRole('tab', { name: /采购明细/ }).click()
      await expect(page.getByTestId('material-contract-lines-scroll')).toBeVisible()
      await expectNoPageOverflow(page, `#318 采购明细 @ ${width}px`)
    })
  }
})
