import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'
function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}
type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

async function reset(request: APIRequestContext, sessionId: string, scenario: Scenario = 'ready') {
  const response = await request.post('/api/testing/crew-workers/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario } })
  expect(response.ok()).toBe(true)
}

async function createFormalCrew(request: APIRequestContext, sessionId: string, suffix = '') {
  const response = await request.post('/api/commands/crews', {
    headers: { 'x-ruihang-test-session': sessionId },
    data: {
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      requiredCapability: 'crew:write',
      commandId: `crew-command-${suffix || 'main'}`,
      baseVersion: null,
      action: 'save',
      draft: { name: `中央泥水班组${suffix}`, trade: '泥工', contactName: '陈师傅', contactPhone: '13800000001', capabilityTrades: ['泥工'], capabilityItems: ['墙砖'], defaultPayRatio: 0.8, rentSubsidyEnabled: false, mgmtFeeEnabled: false, assignmentLevel: 'worker', note: '', status: '' },
      attachments: {},
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json() as { id: string }).id
}

async function createFormalWorker(request: APIRequestContext, sessionId: string, crewId: string | null, suffix = '') {
  const response = await request.post('/api/commands/workers', {
    headers: { 'x-ruihang-test-session': sessionId },
    data: {
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      requiredCapability: 'worker:write',
      commandId: `worker-command-${suffix || 'main'}`,
      baseVersion: null,
      action: 'save',
      draft: { name: `中央链路工人${suffix}`, phone: '13800000002', idCard: '440101199001011234', trade: '泥工', bankName: '示例银行', bankAccount: '6222000000001234', crewId, safetyEducation: true, projectStatus: '在场', capabilityTrades: ['泥工'], capabilityItems: ['墙砖'], note: '', status: '' },
      attachments: {},
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json() as { id: string }).id
}

test.describe('Issue #316：班组—工人中央关系链', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await reset(page.context().request, sessionId)
  })
  test.afterEach(async ({ page }, testInfo) => {
    await reset(page.context().request, testSession(testInfo))
  })

  test('正式班组与工人经稳定 ID 往返，显式编辑只提交中央命令', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    const crewId = await createFormalCrew(page.context().request, sessionId)
    const workerId = await createFormalWorker(page.context().request, sessionId, crewId)
    await page.goto('/base/worker?search=中央链路')
    await expect(page.getByRole('heading', { name: '工人资料库' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: '中央泥水班组', exact: true })).toHaveAttribute('href', new RegExp(`/base/crew/${crewId}\\?origin=real&returnTo=`))
    await page.getByRole('link', { name: '中央链路工人', exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/base/worker/${workerId}\\?origin=real&returnTo=`))
    await expect(page.getByText('138 **** 0002', { exact: true })).toBeVisible()
    await expect(page.getByText('4401 **** 1234', { exact: true })).toBeVisible()
    const crewLink = page.getByRole('link', { name: '中央泥水班组', exact: true })
    await expect(crewLink).toHaveAttribute('href', new RegExp(`/base/crew/${crewId}\\?origin=real&returnTo=`))
    await crewLink.click()
    await expect(page.getByRole('heading', { name: '中央泥水班组' })).toBeVisible()
    await page.goBack()
    await page.getByRole('link', { name: '编辑', exact: true }).click()
    await expect(page.getByText('中央附件边界尚未接入')).toBeVisible()
    await page.getByLabel('姓名 *').fill('中央链路工人（已编辑）')
    const update = page.waitForResponse(candidate => candidate.url().includes(`/api/commands/workers/${workerId}`) && candidate.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await update).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央链路工人（已编辑）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央链路工人（已编辑）' })).toBeVisible()
    await page.getByRole('link', { name: '返回工人列表' }).click()
    await expect(page).toHaveURL(/\/base\/worker\?search=%E4%B8%AD%E5%A4%AE%E9%93%BE%E8%B7%AF/)
    await expect(page.getByPlaceholder('搜索姓名、手机号、证件号…')).toHaveValue('中央链路')
  })

  test('班组详情直接添加和移出成员，只更新工人班组归属', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    const crewId = await createFormalCrew(page.context().request, sessionId, '-成员管理')
    const sourceCrewId = await createFormalCrew(page.context().request, sessionId, '-原班组')
    await createFormalWorker(page.context().request, sessionId, crewId, '-原成员')
    const candidateId = await createFormalWorker(page.context().request, sessionId, sourceCrewId, '-待转入')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/base/crew/${crewId}?origin=real`)
    await expect(page.getByRole('heading', { name: '中央泥水班组-成员管理' })).toBeVisible({ timeout: 20_000 })
    await expectNoPageOverflow(page, '#316 班组成员管理 @ 390px')

    await page.getByRole('button', { name: '添加成员' }).click()
    const addDialog = page.getByRole('dialog', { name: /添加成员/ })
    await addDialog.getByLabel('工人').selectOption({ label: '中央链路工人-待转入 · 泥工 · 中央泥水班组-原班组' })
    const addRequest = page.waitForResponse(response => response.url().includes(`/api/commands/workers/${candidateId}`) && response.request().method() === 'PUT')
    await addDialog.getByRole('button', { name: '加入班组' }).click()
    const transferDialog = page.getByRole('dialog', { name: '确认转组' })
    await expect(transferDialog).toContainText('中央泥水班组-原班组')
    await expect(transferDialog).toContainText('中央泥水班组-成员管理')
    await transferDialog.getByRole('button', { name: '确认转组' }).click()
    expect((await addRequest).ok()).toBe(true)
    const memberRow = page.getByRole('row').filter({ hasText: '中央链路工人-待转入' })
    await expect(memberRow).toBeVisible()

    const removeRequest = page.waitForResponse(response => response.url().includes(`/api/commands/workers/${candidateId}`) && response.request().method() === 'PUT')
    await memberRow.getByRole('button', { name: '移出班组' }).click()
    const removeDialog = page.getByRole('dialog', { name: '移出班组' })
    await expect(removeDialog).toContainText('不会删除工人、工资或历史记录')
    await removeDialog.getByRole('button', { name: '移出班组' }).click()
    expect((await removeRequest).ok()).toBe(true)
    await expect(memberRow).toBeHidden()

    await page.goto(`/base/worker/${candidateId}?origin=real`)
    await expect(page.getByRole('heading', { name: '中央链路工人-待转入' })).toBeVisible()
    await expect(page.getByText('所属班组').locator('..')).toContainText('—')
  })

  test('测试工人详情闭合项目、责任单元、工资单与扣罚单穿透，不反推未知工资分配', async ({ page }) => {
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.goto('/base/worker/wkr_demo_001?origin=demo')
    await expect(page.getByRole('heading', { name: '虞建华' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('135 **** 0001', { exact: true })).toBeVisible()
    await expect(page.getByText('3306 **** 7890', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '泥水A班' })).toHaveAttribute('href', /\/base\/crew\/crew_demo_001\?origin=demo&returnTo=/)
    await expect(page.getByRole('cell', { name: '历史未记录' })).toBeVisible()

    await page.getByRole('link', { name: '合和新城' }).first().click()
    await expect(page.getByRole('heading', { name: '合和新城' })).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).first().click()
    await expect(page.getByRole('heading', { name: '虞建华' })).toBeVisible()

    await page.getByRole('link', { name: '201户' }).click()
    await expect(page.getByRole('heading', { name: '201户' })).toBeFocused()
    await expect(page.getByRole('link', { name: '合和新城' })).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page.getByRole('heading', { name: '虞建华' })).toBeVisible()

    await page.goto('/subcontract/quantity/proj_demo_002/qty_u_1_02_01?origin=demo&ownerKind=worker&ownerId=wkr_demo_001&returnTo=%2Fbase%2Fworker%2Fwkr_demo_001%3Forigin%3Ddemo')
    await expect(page.getByRole('alert', { name: '关系来源不匹配' })).toContainText('不属于地址中的来源对象或项目')
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page.getByRole('heading', { name: '虞建华' })).toBeVisible()

    await page.getByRole('link', { name: '2026-07工资单' }).click()
    await expect(page.getByRole('heading', { name: '2026-07工资单' })).toBeFocused()
    await expect(page.getByText('历史未记录', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page.getByRole('heading', { name: '虞建华' })).toBeVisible()

    await page.getByRole('link', { name: 'FK-DEMO-001' }).click()
    await expect(page.getByRole('heading', { name: 'FK-DEMO-001' })).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page.getByRole('heading', { name: '虞建华' })).toBeVisible()

    await page.goto('/subcontract/payroll/wage-demo-1?origin=demo&ownerKind=worker&ownerId=wkr_demo_002&returnTo=%2Fbase%2Fworker%2Fwkr_demo_001%3Forigin%3Ddemo')
    await expect(page.getByRole('alert', { name: '关系来源不匹配' })).toContainText('不属于地址中的来源对象')
  })

  test('中央 HTTP 明确区分真实空态、禁止、暂不可用、缺失与来源错配', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await reset(page.context().request, sessionId, 'empty')
    await page.goto('/base/crew')
    await expect(page.getByRole('status', { name: '还没有班组档案' })).toBeVisible({ timeout: 20_000 })
    await reset(page.context().request, sessionId, 'forbidden')
    await page.goto('/base/worker')
    await expect(page.getByRole('status', { name: '工人列表加载失败' })).toContainText('无班组或工人查看权限')
    await reset(page.context().request, sessionId, 'unavailable')
    await page.goto('/base/worker/wkr_demo_001?origin=demo')
    await expect(page.getByRole('alert', { name: '中央详情加载失败' })).toContainText('暂时不可用')
    await reset(page.context().request, sessionId)
    await page.goto('/base/worker/not-there?origin=real')
    await expect(page.getByRole('status', { name: '工人不存在或来源不匹配' })).toContainText('不存在或已删除')
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.goto('/base/worker/wkr_demo_001?origin=real')
    await expect(page.getByRole('status', { name: '工人不存在或来源不匹配' })).toContainText('来源与地址不匹配')
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 班组工人列表—详情—表单无页面级横滚`, async ({ page }, testInfo) => {
      const sessionId = testSession(testInfo)
      const crewId = await createFormalCrew(page.context().request, sessionId, `-${width}`)
      const workerId = await createFormalWorker(page.context().request, sessionId, crewId)
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/base/worker')
      await expect(page.getByRole('heading', { name: '工人资料库' })).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#316 工人列表 @ ${width}px`)
      await page.goto(`/base/worker/${workerId}?origin=real`)
      await expect(page.getByRole('heading', { name: '中央链路工人' })).toBeVisible()
      await expectNoPageOverflow(page, `#316 工人详情 @ ${width}px`)
      await page.getByRole('link', { name: '编辑', exact: true }).click()
      await expect(page.getByRole('heading', { name: '编辑 · 工人' })).toBeVisible()
      await expectNoPageOverflow(page, `#316 工人表单 @ ${width}px`)

      await page.goto('/base/crew')
      await expect(page.getByRole('heading', { name: '班组资料库' })).toBeVisible()
      await expectNoPageOverflow(page, `#316 班组列表 @ ${width}px`)
      await page.goto(`/base/crew/${crewId}?origin=real`)
      await expect(page.getByRole('heading', { name: `中央泥水班组-${width}` })).toBeVisible()
      await expectNoPageOverflow(page, `#316 班组详情 @ ${width}px`)
      await page.getByRole('link', { name: '编辑', exact: true }).click()
      await expect(page.getByRole('heading', { name: '编辑 · 班组' })).toBeVisible()
      await expectNoPageOverflow(page, `#316 班组表单 @ ${width}px`)
    })
  }
})
