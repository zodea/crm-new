import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

type SupplierScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

async function resetSupplierBackend(request: APIRequestContext, sessionId: string, scenario: SupplierScenario = 'ready') {
  const response = await request.post('/api/testing/suppliers/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId },
    data: { scenario },
  })
  expect(response.ok()).toBe(true)
}

async function createFormalSupplier(page: Page, name: string) {
  await page.goto('/base/supplier')
  await expect(page.getByRole('heading', { name: '分供方资料库' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '新增分供方' }).click()
  const dialog = page.getByRole('dialog', { name: '选择分供方类别' })
  await dialog.getByRole('radio', { name: '材料供应商' }).check()
  await dialog.getByRole('button', { name: '进入新建表单' }).click()
  await page.getByLabel('公司全称 *', { exact: true }).fill(name)
  await page.getByLabel('主要联系人 *', { exact: true }).fill('陈经理')
  const response = page.waitForResponse(candidate => candidate.url().includes('/api/commands/suppliers') && candidate.request().method() === 'POST')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  expect((await response).ok()).toBe(true)
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test.describe('Issue #315：分供方中央详情与四类真实事实', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await resetSupplierBackend(page.context().request, sessionId)
  })

  test.afterEach(async ({ page }, testInfo) => {
    await resetSupplierBackend(page.context().request, testSession(testInfo))
  })

  test('新建—详情—显式编辑通过中央命令，带筛选返回列表', async ({ page }) => {
    await createFormalSupplier(page, '中央链路分供方')
    const supplierId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!
    await page.getByRole('link', { name: '返回分供方列表' }).click()
    const search = page.getByPlaceholder('搜索公司名、税号、简称…')
    await search.fill('中央链路')
    await page.getByRole('link', { name: '中央链路分供方', exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/base/supplier/${supplierId}\\?origin=real&returnTo=`))
    const credentialReturnTo = await page.getByRole('link', { name: '证照附件' }).getAttribute('href')
    expect(credentialReturnTo).toContain('&returnTo=')
    await page.getByRole('link', { name: '证照附件' }).click()
    await expect(page.getByText('中央证照专用存储尚未接入')).toBeVisible()
    await page.getByRole('link', { name: '返回分供方详情' }).click()
    await expect(page).toHaveURL(new RegExp(`/base/supplier/${supplierId}\\?origin=real&returnTo=`))
    await page.getByRole('link', { name: '编辑分供方' }).click()
    const formCredentialLink = page.getByRole('link', { name: '前往证照附件' })
    await expect(formCredentialLink).toHaveAttribute('href', /\/base\/supplier\/credential\/.+\?origin=real&returnTo=/)
    await formCredentialLink.click()
    await expect(page.getByText('中央证照专用存储尚未接入')).toBeVisible()
    await page.getByRole('link', { name: '返回分供方详情' }).click()
    await expect(page).toHaveURL(new RegExp(`/base/supplier/${supplierId}\\?origin=real&returnTo=`))
    await page.getByRole('link', { name: '编辑分供方' }).click()
    await page.getByLabel('公司全称 *', { exact: true }).fill('中央链路分供方（已编辑）')
    const update = page.waitForResponse(candidate => candidate.url().includes(`/api/commands/suppliers/${supplierId}`) && candidate.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await update).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央链路分供方（已编辑）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央链路分供方（已编辑）' })).toBeVisible()
    await page.getByRole('link', { name: '返回分供方列表' }).click()
    await expect(search).toHaveValue('中央链路')
    await expect(page.getByRole('link', { name: '中央链路分供方（已编辑）', exact: true }).first()).toBeFocused()
  })

  test('四类事实使用真实来源和稳定目标，零结算仍进入真实空态，应付不可点击', async ({ page }) => {
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.goto('/base/supplier?search=穗建五金')
    await page.getByRole('link', { name: '穗建五金机电经营部', exact: true }).first().click()
    const summary = page.getByTestId('supplier-summary')
    await expect(summary).toContainText('¥261,250.00')
    await expect(summary).toContainText('¥12,380.00')
    await expect(summary).toContainText('¥101,138.00')
    await expect(summary).toContainText('¥160,112.00')
    await expect(page.getByRole('button', { name: '查看累计结算金额明细' })).toBeVisible()
    await expect(page.getByRole('button', { name: '查看应付金额明细' })).toHaveCount(0)

    await page.getByRole('button', { name: '查看累计结算金额明细' }).click()
    await expect(page.getByText('暂无结算事实', { exact: true }).nth(1)).toBeVisible()
    await page.getByRole('tab', { name: /支出合同/ }).click()
    await expect(page.getByRole('link', { name: '五金机电采购合同' })).toHaveAttribute('href', '/contract/con_demo_cg07')
    await expect(page.getByText('无权限', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: /收票登记/ }).click()
    await expect(page.getByRole('link', { name: '09442026000058702' })).toHaveAttribute('href', '/finance/invoice/inv_demo_004')
    await page.getByRole('tab', { name: /付款管理/ }).click()
    await expect(page.getByRole('link', { name: '五金机电采购首期请款' })).toHaveAttribute('href', '/finance/payment/pa_demo_sup004_1/detail')
    const credentialLink = page.getByRole('link', { name: '证照附件' })
    await expect(credentialLink).toHaveAttribute('href', /\/base\/supplier\/credential\/sup_demo_004\?origin=demo&returnTo=/)
    await credentialLink.click()
    await expect(page.getByRole('heading', { name: '穗建五金机电经营部 · 证照附件' })).toBeVisible()
    await expect(page.getByText('测试证照只读')).toBeVisible()
    await expect(page.getByRole('button', { name: /上传/ })).toHaveCount(0)
  })

  test('真实 HTTP 接缝区分空态、禁止、暂不可用、缺失与来源不匹配', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)

    await page.goto('/base/supplier/credential/sup_demo_004?origin=demo')
    await expect(page.getByText('测试数据未开启')).toBeVisible()

    await resetSupplierBackend(page.context().request, sessionId, 'empty')
    await page.goto('/base/supplier')
    await expect(page.getByRole('heading', { name: '分供方资料库' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('status', { name: '还没有分供方档案' })).toBeVisible()

    await resetSupplierBackend(page.context().request, sessionId, 'forbidden')
    const forbiddenResponse = await page.context().request.get('/api/read/suppliers', {
      headers: { 'x-ruihang-test-session': sessionId },
    })
    expect(forbiddenResponse.status()).toBe(403)
    expect(await forbiddenResponse.json()).toMatchObject({ data: { code: 'forbidden' } })
    await page.reload()
    await expect(page.getByText('无分供方查看权限')).toBeVisible()

    await resetSupplierBackend(page.context().request, sessionId, 'unavailable')
    const unavailableResponse = await page.context().request.get('/api/read/suppliers/sup_demo_004?origin=demo&includeDemo=true', {
      headers: { 'x-ruihang-test-session': sessionId },
    })
    expect(unavailableResponse.status()).toBe(503)
    expect(await unavailableResponse.json()).toMatchObject({ data: { code: 'unavailable', retryable: true } })
    await page.goto('/base/supplier/sup_demo_004?origin=demo&includeDemo=true')
    await expect(page.getByText('分供方中央读取服务暂时不可用')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()

    await resetSupplierBackend(page.context().request, sessionId)
    const missingResponse = await page.context().request.get('/api/read/suppliers/not-there?origin=real', {
      headers: { 'x-ruihang-test-session': sessionId },
    })
    expect(missingResponse.status()).toBe(404)
    expect(await missingResponse.json()).toMatchObject({ data: { code: 'not-found' } })
    const mismatchResponse = await page.context().request.get('/api/read/suppliers/sup_demo_004?origin=real&includeDemo=true', {
      headers: { 'x-ruihang-test-session': sessionId },
    })
    expect(mismatchResponse.status()).toBe(404)
    expect(await mismatchResponse.json()).toMatchObject({ data: { code: 'relationship-mismatch' } })
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 列表—详情—表单无页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await createFormalSupplier(page, `响应式分供方 ${width}`)
      await expectNoPageOverflow(page, `#315 分供方详情 @ ${width}px`)
      await page.getByRole('link', { name: '证照附件' }).click()
      await expect(page.getByText('中央证照专用存储尚未接入')).toBeVisible()
      await expect(page.getByRole('heading', { name: `响应式分供方 ${width} · 证照附件` })).toBeFocused()
      await expectNoPageOverflow(page, `#315 分供方证照专用页 @ ${width}px`)
      await page.getByRole('link', { name: '返回分供方详情' }).click()
      await page.getByRole('link', { name: '编辑分供方' }).click()
      await expectNoPageOverflow(page, `#315 分供方表单 @ ${width}px`)
      await page.getByRole('button', { name: '取消' }).click()
      await page.getByRole('link', { name: '返回分供方列表' }).click()
      await expectNoPageOverflow(page, `#315 分供方列表 @ ${width}px`)
    })
  }
})
