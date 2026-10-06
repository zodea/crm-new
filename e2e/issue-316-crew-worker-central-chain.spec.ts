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
      commandId: `crew-command-${Buffer.from(suffix || 'main', 'utf8').toString('base64url')}`,
      baseVersion: null,
      action: 'save',
      draft: { name: `中央泥水班组${suffix}`, trade: '泥工', contactName: '陈师傅', contactPhone: '13800000001', capabilityTrades: ['泥工'], capabilityItems: ['墙砖'], defaultPayRatio: 0.8, rentSubsidyEnabled: false, mgmtFeeEnabled: false, assignmentLevel: 'worker', note: '', status: '' },
      attachments: {},
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json() as { id: string }).id
}

async function createFormalWorker(request: APIRequestContext, sessionId: string, crewId: string | null, suffix = '', currentProjectId: string | null = null) {
  const response = await request.post('/api/commands/workers', {
    headers: { 'x-ruihang-test-session': sessionId },
    data: {
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      requiredCapability: 'worker:write',
      commandId: `worker-command-${Buffer.from(suffix || 'main', 'utf8').toString('base64url')}`,
      baseVersion: null,
      action: 'save',
      draft: { name: `中央链路工人${suffix}`, phone: '13800000002', idCard: '440101199001011234', trade: '泥工', bankName: '示例银行', bankAccount: '6222000000001234', crewId, currentProjectId, safetyEducation: true, projectStatus: '在场', capabilityTrades: ['泥工'], capabilityItems: ['墙砖'], note: '', status: '' },
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
    const privateGrant = await page.request.post('/api/testing/worker-roster/access', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { allowed: true } })
    expect(privateGrant.ok()).toBe(true)
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

  test('全局目录跨项目复用同工人ID，转组与显式项目更新保留原回执并可刷新回读', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    const headers = { 'x-ruihang-test-session': sessionId }
    await page.addInitScript(key => localStorage.setItem(key, 'false'), DATA_VISIBILITY_STORAGE_KEY)
    const projects: string[] = []
    for (const suffix of ['甲', '乙']) {
      const response = await page.request.post('/api/commands/projects', { headers, data: { workspaceId: 'workspace-default', actorId: 'actor-default', requiredCapability: 'project:write', commandId: `reuse-project-${suffix}`, baseVersion: null, action: 'draft', draft: { name: `跨项目复用工程${suffix}`, manager: '合成经办人', status: '筹备中' }, attachments: {} } })
      expect(response.ok(), await response.text()).toBe(true)
      projects.push((await response.json() as { id: string }).id)
    }
    const crewA = await createFormalCrew(page.request, sessionId, '-复用原班组')
    const crewB = await createFormalCrew(page.request, sessionId, '-复用目标班组')
    const workerId = await createFormalWorker(page.request, sessionId, crewA, '-跨项目复用', projects[0]!)
    const resolutionURL = '/api/commands/workers/resolve'
    const originalCommandId = `worker-command-${Buffer.from('-跨项目复用', 'utf8').toString('base64url')}`
    const original = await page.request.post(resolutionURL, { headers, data: { commandId: originalCommandId } })
    expect(original.ok(), await original.text()).toBe(true)
    const originalReceipt = await original.json()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/worker?search=跨项目复用')
    await expect(page.getByRole('heading', { name: '工人资料库' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: '中央链路工人-跨项目复用', exact: true }).first()).toHaveAttribute('href', new RegExp(`/base/worker/${workerId}`))
    await expect(page.getByRole('link', { name: '跨项目复用工程甲', exact: true })).toBeVisible()
    await expectNoPageOverflow(page, '跨项目全局工人目录@390')
    await page.goto(`/base/crew/${crewB}?origin=real`)
    await page.getByRole('button', { name: '添加成员' }).click()
    const dialog = page.getByRole('dialog', { name: '向「中央泥水班组-复用目标班组」添加成员' })
    await dialog.getByLabel('工人').selectOption({ label: '中央链路工人-跨项目复用 · 泥工 · 中央泥水班组-复用原班组 · 当前项目：跨项目复用工程甲' })
    await dialog.getByRole('button', { name: '加入班组' }).click()
    await page.getByRole('dialog', { name: '确认转组' }).getByRole('button', { name: '确认转组' }).click()
    const member = page.getByRole('row').filter({ hasText: '中央链路工人-跨项目复用' })
    await expect(member).toBeVisible()
    await expect(member).toContainText('跨项目复用工程甲')
    const formBefore = await page.request.get(`/api/read/workers/${workerId}/form`, { headers })
    expect((await formBefore.json()).draft).toMatchObject({ id: workerId, crewId: crewB, currentProjectId: projects[0], bankAccount: '6222000000001234' })
    await member.getByRole('link', { name: '中央链路工人-跨项目复用', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/base/worker/${workerId}\\?origin=real`))
    await expect(page.getByRole('heading', { name: '中央链路工人-跨项目复用', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '编辑', exact: true }).click()
    await expect(page.getByRole('heading', { name: '编辑 · 工人', exact: true })).toBeVisible()
    const picker = page.getByRole('combobox', { name: '检索项目', exact: true })
    await picker.fill('跨项目复用工程乙')
    await page.getByRole('option', { name: '跨项目复用工程乙', exact: true }).click()
    const saved = page.waitForResponse(response => response.url().includes(`/api/commands/workers/${workerId}`) && response.request().method() === 'PUT')
    const save = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })
    await save.focus()
    await page.keyboard.press('Enter')
    expect((await saved).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央链路工人-跨项目复用' })).toBeFocused()
    await page.reload()
    await expect(page.getByRole('link', { name: '跨项目复用工程乙', exact: true }).first()).toBeVisible()
    const updated = await page.request.get(`/api/read/workers/${workerId}/form`, { headers })
    expect((await updated.json()).draft).toMatchObject({ id: workerId, crewId: crewB, currentProjectId: projects[1], bankAccount: '6222000000001234' })
    const coldReceipt = await page.request.post(resolutionURL, { headers, data: { commandId: originalCommandId } })
    expect(await coldReceipt.json()).toEqual(originalReceipt)
    const global = await page.request.get('/api/read/workers?includeDemo=false&search=跨项目复用', { headers })
    const list = await global.json()
    expect(list.pagination.total).toBe(1)
    expect(list.items[0].worker.id).toBe(workerId)
    await expectNoPageOverflow(page, '跨项目工人刷新详情@390')
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

  for (const scenario of [{ unknown: true, reload: true }, { unknown: false, reload: false }, { unknown: false, reload: true }]) {
    test(`成员原操作${scenario.unknown ? '响应未知' : '已保存后读失败'}${scenario.reload ? '刷新后' : '当前页'}可独立恢复，已入班组候选不回放新写`, async ({ page }, testInfo) => {
      const sessionId = testSession(testInfo)
      const crewId = await createFormalCrew(page.request, sessionId, '-独立成员恢复')
      const workerId = await createFormalWorker(page.request, sessionId, null, '-独立成员恢复')
      await page.goto(`/base/crew/${crewId}?origin=real`)
      await expect(page.getByRole('heading', { name: '中央泥水班组-独立成员恢复', exact: true })).toBeVisible({ timeout: 20_000 })
      let writes = 0
      let resolves = 0
      let original: Record<string, unknown> | null = null
      const readPattern = `**/api/read/workers/${workerId}/form`
      await page.route(readPattern, route => writes > 0 && !scenario.unknown
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ data: { code: 'unavailable', message: '真实成员保存后原工人读取失败', retryable: true, fieldErrors: {}, traceId: null } }) })
        : route.continue())
      await page.route(`**/api/commands/workers/${workerId}`, async (route) => {
        if (route.request().method() !== 'PUT')
          return route.continue()
        writes++
        original = route.request().postDataJSON()
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        return scenario.unknown ? route.abort('connectionreset') : route.fulfill({ response })
      })
      page.on('request', (request) => {
        if (request.url().endsWith('/api/commands/workers/resolve'))
          resolves++
      })
      await page.getByRole('button', { name: '添加成员', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '向「中央泥水班组-独立成员恢复」添加成员' })
      await dialog.getByLabel('工人').selectOption({ label: '中央链路工人-独立成员恢复 · 泥工 · 未分组' })
      await dialog.getByRole('button', { name: '加入班组', exact: true }).click()
      const recovery = page.getByRole('status', { name: '原成员提交恢复', exact: true })
      await expect(recovery).toBeVisible()
      const current = await page.request.get(`/api/read/workers/${workerId}/form`, { headers: { 'x-ruihang-test-session': sessionId } })
      expect(await current.json()).toMatchObject({ draft: { id: workerId, crewId }, version: '2' })
      expect(writes).toBe(1)
      const descriptors = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('crm:form-command:v1:')).map(([, value]) => JSON.parse(value)))
      expect(descriptors).toEqual([{ workspaceId: 'workspace-default', actorId: 'actor-default', commandId: original!.commandId, family: 'worker-membership', targetId: workerId, scopeId: crewId, action: 'membership' }])
      await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeDisabled()
      if (!scenario.unknown)
        await expect(recovery.getByRole('button', { name: '重新读取已保存成员', exact: true })).toBeVisible()
      await page.unroute(readPattern)
      if (scenario.reload) {
        await page.reload()
        await expect(recovery).toBeVisible()
        await expect(page.getByRole('row').filter({ hasText: '中央链路工人-独立成员恢复' })).toBeVisible()
      }
      const recover = recovery.getByRole('button', { name: scenario.reload || scenario.unknown ? '核对原成员提交' : '重新读取已保存成员', exact: true })
      const memberTable = page.locator('[aria-label="班组成员表，可横向滚动查看全部列"]')
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await test.step(`${width}px：恢复提示、局部滚动与键盘焦点`, async () => {
          await page.setViewportSize({ width, height: 900 })
          await recover.scrollIntoViewIfNeeded()
          await expect(recovery).toBeVisible()
          await expect(recovery).toContainText(String(original!.commandId))
          await expect(recover).toBeEnabled()
          await expect(recover).toBeInViewport()
          const prompt = await recovery.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }))
          expect(prompt.scroll, `${width}px 原编号提示应在自身宽度内换行`).toBeLessThanOrEqual(prompt.client)
          await expectNoPageOverflow(page, `${width}px 成员原操作恢复提示`)
          const table = await memberTable.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, overflow: getComputedStyle(element).overflowX }))
          expect(table.overflow, `${width}px 成员表由自身容器承载横滚`).toMatch(/auto|scroll/)
          await memberTable.evaluate((element) => {
            element.scrollLeft = 0
          })
          await memberTable.focus()
          if (table.scroll > table.client) {
            await page.keyboard.press('ArrowRight')
            await expect.poll(() => memberTable.evaluate(element => element.scrollLeft), { message: `${width}px 键盘可滚动成员表自身` }).toBeGreaterThan(0)
          }
          await page.keyboard.press('Shift+Tab')
          await expect(recover).toBeFocused()
          await expect(recover).toBeInViewport()
          expect(writes, `${width}px 只检查焦点、不重复提交`).toBe(1)
          expect(resolves, `${width}px 尚未触发原操作核对`).toBe(0)
        })
      }
      await page.keyboard.press('Enter')
      await expect(recovery).toBeHidden()
      await expect(page.getByRole('row').filter({ hasText: '中央链路工人-独立成员恢复' })).toBeVisible()
      await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeEnabled()
      expect(writes).toBe(1)
      expect(resolves).toBe(scenario.reload || scenario.unknown ? 1 : 0)
      expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('crm:form-command:v1:')))).toEqual([])
      await expectNoPageOverflow(page, '成员原操作独立恢复')
    })
  }

  for (const kind of ['crew', 'worker'] as const) {
    test(`${kind} 原回执响应未知时禁止换号异文，刷新按原号恢复同一档案`, async ({ page }, testInfo) => {
      const sessionId = testSession(testInfo)
      const id = kind === 'crew'
        ? await createFormalCrew(page.request, sessionId, '-原编号恢复')
        : await createFormalWorker(page.request, sessionId, null, '-原编号恢复')
      await page.goto(`/base/${kind}/form/${id}?origin=real`)
      const name = page.getByLabel(kind === 'crew' ? '班组名称 *' : '姓名 *')
      await expect(name).toBeVisible({ timeout: 20_000 })
      await name.fill(`${kind}原保存事实`)
      let body: Record<string, unknown> | null = null
      let writes = 0
      await page.route(`**/api/commands/${kind}s/${id}`, async (route) => {
        if (route.request().method() !== 'PUT')
          return route.continue()
        writes++
        body = route.request().postDataJSON()
        const result = await route.fetch()
        expect(result.ok()).toBe(true)
        await route.abort('connectionreset')
      })
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      const recovery = page.getByRole('status', { name: '原提交恢复' })
      await expect(recovery).toContainText('原提交结果未知')
      await expect(recovery.getByRole('button', { name: '核对原提交', exact: true })).toBeEnabled()
      expect(writes).toBe(1)
      expect(body).not.toBeNull()
      const original = body!
      await expect(recovery).toContainText(String(original.commandId))
      const conflict = await page.request.put(`/api/commands/${kind}s/${id}`, { headers: { 'x-ruihang-test-session': sessionId }, data: { ...original, draft: { ...(original.draft as object), name: '不能替换原号的异文' } } })
      expect(conflict.status()).toBe(409)
      const confirmed = await page.request.post(`/api/commands/${kind}s/resolve`, { headers: { 'x-ruihang-test-session': sessionId }, data: { commandId: original.commandId } })
      expect(await confirmed.json()).toMatchObject({ outcome: 'applied', result: { id, commandId: original.commandId, version: '2' } })
      const savedDescriptor = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('crm:form-command:v1:')).map(([, value]) => JSON.parse(value)))
      expect(savedDescriptor).toEqual([{ workspaceId: 'workspace-default', actorId: 'actor-default', commandId: original.commandId, family: kind, targetId: id, action: 'save' }])
      await name.fill('刷新前后来输入')
      await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })).toBeDisabled()
      page.on('dialog', dialog => dialog.accept())
      await page.reload()
      await expect(name).toHaveValue(`${kind}原保存事实`, { timeout: 20_000 })
      await expect(recovery).toBeHidden()
      expect(writes).toBe(1)
      const remaining = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('crm:form-command:v1:')))
      expect(remaining).toEqual([])
    })

    test(`${kind} 保存后读取失败只重读原目标并保留后来输入`, async ({ page }, testInfo) => {
      const sessionId = testSession(testInfo)
      const id = kind === 'crew'
        ? await createFormalCrew(page.request, sessionId, '-保存后读回')
        : await createFormalWorker(page.request, sessionId, null, '-保存后读回')
      await page.goto(`/base/${kind}/form/${id}?origin=real`)
      const name = page.getByLabel(kind === 'crew' ? '班组名称 *' : '姓名 *')
      await expect(name).toBeVisible({ timeout: 20_000 })
      await name.fill(`${kind}已提交原文`)
      let writes = 0
      let resolves = 0
      page.on('request', (request) => {
        if (request.url().endsWith(`/api/commands/${kind}s/${id}`) && request.method() === 'PUT')
          writes++
        if (request.url().endsWith(`/api/commands/${kind}s/resolve`))
          resolves++
      })
      const readPattern = `**/api/read/${kind}s/${id}/form`
      await page.route(readPattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ data: { code: 'unavailable', message: '测试保存后同目标读取失败', retryable: true, fieldErrors: {}, traceId: null } }) }))
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      const recovery = page.getByRole('status', { name: '原提交恢复' })
      await expect(recovery).toContainText('已保存待刷新')
      await name.fill(`${kind}后来保留输入`)
      await page.unroute(readPattern)
      const recover = recovery.getByRole('button', { name: '重新读取已保存记录' })
      await recover.focus()
      await expect(recover).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(recovery).toBeHidden()
      await expect(name).toHaveValue(`${kind}后来保留输入`)
      expect(writes).toBe(1)
      expect(resolves).toBe(0)
      const saved = await page.request.get(`/api/read/${kind}s/${id}/form`, { headers: { 'x-ruihang-test-session': sessionId } })
      expect(await saved.json()).toMatchObject({ draft: { id, name: `${kind}已提交原文` }, version: '2' })
      await expectNoPageOverflow(page, `${kind} 原目标恢复后布局`)
    })
  }

  for (const width of [...RESPONSIVE_WIDTHS, 1280].sort((a, b) => a - b)) {
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
      const workerName = page.getByLabel('姓名 *')
      await workerName.focus()
      await expect(workerName).toBeFocused()
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })).toBeInViewport()

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
