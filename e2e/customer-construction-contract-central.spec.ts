import type { Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, expectOverlayAboveShell } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })
test.setTimeout(120_000)

function headers(info: TestInfo) {
  return { 'x-ruihang-test-session': `customer-contract-${Buffer.from(info.testId).toString('base64url')}` }
}

async function reset(page: Page, info: TestInfo) {
  for (const entity of ['construction-contracts', 'projects', 'customers']) {
    const result = await page.context().request.post(`/api/testing/${entity}/reset`, {
      headers: { ...headers(info), 'x-ruihang-test-reset': '1' },
      data: { scenario: entity === 'construction-contracts' ? 'empty' : 'ready' },
    })
    expect(result.ok()).toBe(true)
  }
  // 显式测试入口准备中央身份；随后清空合同，以验证真正的首次保存回读。
  for (const scenario of ['ready', 'empty']) {
    const result = await page.context().request.post('/api/testing/construction-contracts/reset', {
      headers: { ...headers(info), 'x-ruihang-test-reset': '1' },
      data: { scenario },
    })
    expect(result.ok()).toBe(true)
  }
}

async function saveEntity(page: Page, entity: 'customers' | 'projects' | 'construction-contracts', draft: Record<string, unknown>, id?: string) {
  return page.evaluate(async ({ entity, draft, id }) => {
    const session = await (await fetch('/api/read/business-session')).json()
    const form = id ? await (await fetch(`/api/read/${entity}/${id}/form`)).json() : null
    const response = await fetch(`/api/commands/${entity}${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...session, ...(id ? { id } : {}), requiredCapability: entity === 'customers' ? 'customer:write' : entity === 'projects' ? 'project:write' : 'construction-contract:write', commandId: crypto.randomUUID(), baseVersion: form?.version ?? null, action: 'save', draft: { ...form?.draft, ...draft }, attachments: {} }),
    })
    const result = await response.json()
    if (!response.ok)
      throw new Error(`合成${entity}保存失败：${JSON.stringify(result)}`)
    return result as { id: string, version: string }
  }, { entity, draft, id })
}

const saveContract = (page: Page, name: string, amount = 123400) => saveEntity(page, 'construction-contracts', { name, amount, projectId: 'project-real-320', customerId: 'customer-real-320', content: '隔离合成施工', signDate: '2026-09-09', status: '履约中' })
const customerUrl = '/base/customer/customer-real-320?origin=real&tab=contracts'

test.beforeEach(async ({ page }, info) => {
  await page.setExtraHTTPHeaders(headers(info))
  await reset(page, info)
  await page.goto('/base/customer')
  await expect(page.getByRole('heading', { name: '客户档案', exact: true })).toBeVisible({ timeout: 30_000 })
})

test.afterEach(async ({ page }, info) => {
  await reset(page, info)
})

test('正式施工合同表单保存后客户回读同一合同并往返详情', async ({ page }) => {
  await page.goto('/contract/construction/form')
  await page.getByLabel('合同名称 *').fill('合成客户合同回读407')
  await page.getByRole('combobox', { name: '检索项目' }).click()
  await page.getByText('中央正式施工项目', { exact: true }).click()
  await page.getByRole('combobox', { name: '检索客户' }).click()
  await page.getByText('中央正式甲方客户', { exact: true }).click()
  await page.getByLabel('合同内容简述 *').fill('隔离合成施工合同回读')
  await page.getByLabel('签约日期 *').fill('2026-09-09')
  const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/construction-contracts') && response.request().method() === 'POST')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  const response = await saved
  expect(response.ok(), await response.text()).toBe(true)
  const contract = await response.json()
  await expect(page.getByRole('heading', { name: '合成客户合同回读407', exact: true })).toBeVisible()
  const form = await page.evaluate(async id => (await (await fetch(`/api/read/construction-contracts/${id}/form`)).json()), contract.id)
  expect(form.draft.customerId).toBe('customer-real-320')
  await page.goto('/base/customer/customer-real-320?origin=real&tab=contracts')
  await expect(page.getByRole('heading', { name: '中央正式甲方客户', exact: true })).toBeVisible()
  const detail = await page.evaluate(async () => (await (await fetch('/api/read/customers/customer-real-320?origin=real&includeDemo=false')).json()))
  expect(detail.summary.contractCount, '中央正式施工合同已保存，客户详情应回读同一合同事实').toBe(1)
  expect(detail.contracts[0].contract.id).toBe(contract.id)
  const link = page.getByRole('link', { name: '合成客户合同回读407', exact: true })
  await link.click()
  await expect(page.getByRole('heading', { name: '合成客户合同回读407', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
  await expect(page.getByRole('tab', { name: /施工合同/ })).toHaveAttribute('aria-selected', 'true')
  await expect(link).toBeFocused()
})

test('新建合成客户与项目可用于施工合同正式保存，同名次客户不取得合同', async ({ page }) => {
  const a = await saveEntity(page, 'customers', { name: '同名合成甲方425', contact: '主客户' })
  const b = await saveEntity(page, 'customers', { name: '同名合成甲方425', contact: '次客户' })
  const p = await saveEntity(page, 'projects', { name: '新建施工关联项目425', manager: '合成经理', customerId: a.id, secondaryCustomerId: b.id })
  await page.goto('/contract/construction/form')
  await page.getByRole('combobox', { name: '检索项目' }).click()
  await expect(page.getByText('新建施工关联项目425', { exact: true }), '新保存中央项目必须出现在正式合同候选').toBeVisible()
  await page.keyboard.press('Escape')
  const c = await saveEntity(page, 'construction-contracts', { name: '新客户施工合同425', projectId: p.id, customerId: a.id, amount: 100000, content: '新合成施工', signDate: '2026-09-09' })
  await page.goto(`/base/customer/${a.id}?origin=real&tab=contracts`)
  await page.getByRole('link', { name: '新客户施工合同425', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新客户施工合同425', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/base/customer/${a.id}\\?`))
  await saveEntity(page, 'projects', { customerId: b.id, secondaryCustomerId: null }, p.id)
  await page.reload()
  await expect(page.getByRole('link', { name: '新客户施工合同425', exact: true })).toBeVisible()
  await page.goto(`/base/customer/${b.id}?origin=real&tab=contracts`)
  await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无施工合同' })).toBeVisible()
  await saveEntity(page, 'construction-contracts', { customerId: b.id }, c.id)
  await page.reload()
  await expect(page.getByRole('link', { name: '新客户施工合同425', exact: true })).toBeVisible()
  await saveEntity(page, 'customers', { name: '甲方更名后425' }, b.id)
  await page.reload()
  await expect(page.getByRole('heading', { name: '甲方更名后425', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '新客户施工合同425', exact: true }).click()
  await expect(page.getByRole('link', { name: '甲方更名后425', exact: true })).toBeVisible()
})

test('五档视口合同往返恢复原行、表内横滚，键盘与来源确认浮层可达', async ({ page }) => {
  await saveContract(page, '第一份同项目施工合同425')
  await saveContract(page, '第二份同项目施工合同425', 456700)
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 })
    await page.goto(customerUrl)
    const link = page.getByRole('link', { name: '第二份同项目施工合同425', exact: true })
    await expect(link).toBeVisible()
    await expectNoPageOverflow(page, `客户施工合同 @ ${width}`)
    const table = page.locator('[data-customer-relations] .vxe-table--scroll-x-handle').first()
    await link.focus()
    const scrollLeft = await table.evaluate((element) => {
      element.scrollLeft = Math.min(110, element.scrollWidth - element.clientWidth)
      return element.scrollLeft
    })
    if (width <= 1280)
      expect(scrollLeft).toBeGreaterThan(0)
    await page.screenshot({ path: `docs/design/evidence/issue-425/customer-contract-${width}.png` })
    await link.press('Enter')
    await expect(page.getByRole('heading', { name: '第二份同项目施工合同425', exact: true })).toBeVisible()
    await expectNoPageOverflow(page, `施工合同详情 @ ${width}`)
    await page.reload()
    await page.getByRole('link', { name: '返回客户详情', exact: true }).press('Enter')
    await expect(link).toBeFocused()
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
    await page.getByRole('button', { name: '包含测试数据' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expectOverlayAboveShell(dialog, `来源浮层 @ ${width}`)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
})

test('合同显式编辑并保存后回客户刷新金额，保留原列表分页与筛选', async ({ page }) => {
  await saveContract(page, '编辑往返合成合同425')
  const list = '/base/customer?search=中央正式&status=active&sort=name-desc&page=2&pageSize=10'
  for (let index = 0; index < 11; index++)
    await saveEntity(page, 'customers', { name: `中央正式甲方客户${index}`, contact: '分页合成联系人' })
  await page.goto(list)
  await expect(page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' })).toHaveValue('中央正式')
  await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: '中央正式甲方客户', exact: true }).click()
  await page.getByRole('tab', { name: /施工合同/ }).click()
  await page.getByRole('link', { name: '编辑往返合成合同425', exact: true }).click()
  await page.getByTestId('construction-contract-edit').click()
  await page.getByLabel('合同名称 *').fill('合同更正后425')
  await page.getByLabel('含税合同金额 *', { exact: true }).fill('234500')
  const saved = page.waitForResponse(response => response.url().includes('/api/commands/construction-contracts/') && response.request().method() === 'PUT')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  expect((await saved).ok()).toBe(true)
  await expect(page.getByRole('heading', { name: '合同更正后425', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
  await expect(page.getByRole('link', { name: '合同更正后425', exact: true })).toBeFocused()
  await expect(page.getByTestId('customer-summary')).toContainText('234,500.00')
  await page.reload()
  await expect(page.getByRole('tab', { name: /施工合同/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('link', { name: '返回客户列表', exact: true })).toHaveAttribute('href', /search=/)
  await page.getByRole('link', { name: '返回客户列表', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' })).toHaveValue('中央正式')
  const url = new URL(page.url())
  for (const [key, value] of new URL(list, 'http://localhost').searchParams)
    expect(url.searchParams.get(key) ?? (key === 'pageSize' ? '10' : null)).toBe(value)
  await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: '中央正式甲方客户', exact: true })).toBeFocused()
})

test('合同源失败/无权反馈与重试，正式演示来源和会话隔离', async ({ page }, info) => {
  const c = await saveContract(page, '异常合成合同425')
  for (const scenario of ['forbidden', 'unavailable']) {
    await page.context().request.post('/api/testing/construction-contracts/reset', { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario } })
    await page.goto(customerUrl)
    await expect(page.getByRole('heading', { name: '中央正式甲方客户', exact: true })).toBeVisible()
    await expect(page.getByRole(scenario === 'forbidden' ? 'status' : 'alert', { name: scenario === 'forbidden' ? '无权查看施工合同' : '施工合同加载失败' })).toBeVisible()
    await expect(page.getByRole('tabpanel', { name: '施工合同' })).not.toContainText('暂无施工合同')
    await expect(page.getByTestId('customer-summary')).not.toContainText('0 份')
    await expect(page.getByRole('link', { name: '异常合成合同425', exact: true })).toHaveCount(0)
  }
  await page.context().request.post('/api/testing/construction-contracts/reset', { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
  await saveContract(page, '恢复后合成合同425')
  await page.getByRole('button', { name: '重新加载施工合同' }).click()
  await expect(page.getByRole('link', { name: '恢复后合成合同425', exact: true })).toBeVisible()
  const other = await page.context().request.get('/api/read/customers/customer-real-320?origin=real&includeDemo=false', { headers: { 'x-ruihang-test-session': `other-${info.testId}` } })
  expect(other.status()).toBe(404)
  expect(await other.text()).not.toContain(c.id)
  await page.getByRole('button', { name: '包含测试数据' }).click()
  await page.getByRole('button', { name: '确认切换' }).click()
  await expect(page.getByRole('button', { name: '关闭测试数据' })).toBeVisible()
  await page.goto('/base/customer/customer_demo_001?origin=demo&tab=contracts')
  await expect(page.getByRole('heading', { name: '合和地产集团', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '恢复后合成合同425', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '合和新城施工总承包合同', exact: true }).click()
  await expect(page).toHaveURL(/origin=demo&contractKind=construction/)
  await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
  await expect(page.getByRole('tab', { name: /施工合同/ })).toHaveAttribute('aria-selected', 'true')
  expect(page.url()).not.toContain(c.id)
})

test('合同详情保持打开直到客户返回信息到期，自动降级到施工合同列表', async ({ page }) => {
  await saveContract(page, '停留到期合成合同425')
  await page.goto(customerUrl)
  await page.clock.install()
  await page.getByRole('link', { name: '停留到期合成合同425', exact: true }).click()
  await expect(page.getByRole('heading', { name: '停留到期合成合同425', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回客户详情', exact: true })).toBeVisible()
  await page.clock.fastForward(31 * 60_000)
  await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toHaveAttribute('href', '/contract/construction')
})

test('合同目标读取失败仍可返回，深链/伪造/过期上下文降级；原行消失聚焦关系区', async ({ page }, info) => {
  const c = await saveContract(page, '安全返回合成合同425')
  await page.goto(customerUrl)
  const link = page.getByRole('link', { name: '安全返回合成合同425', exact: true })
  await page.route(`**/api/read/construction-contracts/${c.id}?**`, route => route.abort('connectionreset'))
  await link.click()
  await expect(page.getByRole('alert')).toBeVisible()
  const capturedUrl = page.url()
  await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
  await expect(link).toBeFocused()
  await page.unroute(`**/api/read/construction-contracts/${c.id}?**`)
  await page.goto(`/contract/${c.id}?origin=real&contractKind=construction`)
  await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toHaveAttribute('href', '/contract/construction')
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('ruihang:customer-relation-return:')) {
        const value = JSON.parse(sessionStorage.getItem(key)!)
        value.expiresAt = 1
        sessionStorage.setItem(key, JSON.stringify(value))
      }
    }
  })
  await page.goto(capturedUrl)
  await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toBeVisible()
  await page.goto(`/contract/${c.id}?origin=real&contractKind=construction&returnTo=${encodeURIComponent('https://evil.example')}`)
  await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toHaveAttribute('href', '/contract/construction')
  await page.goto(customerUrl)
  await link.click()
  await expect(page.getByRole('heading', { name: '安全返回合成合同425', exact: true })).toBeVisible()
  await reset(page, info)
  await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
  await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无施工合同' })).toBeVisible()
  await expect(page.locator('[data-customer-relations]')).toBeFocused()
})
