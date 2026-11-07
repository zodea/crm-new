import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installContractEngineeringFixture, selectContractEngineeringFixture } from './helpers/contract-engineering-fixture'
import { createVerifiedSignatory, selectVerifiedSignatory, verifiedSignatoryAdoption } from './helpers/contract-signatory'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'
type Domain = 'owner-documents' | 'subcontract-contracts' | 'projects'

function session(testInfo: TestInfo) {
  return Buffer.from(`${testInfo.testId}-${testInfo.retry}`, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, domain: Domain, scenario: Scenario = 'ready') {
  const response = await request.post(`/api/testing/${domain}/reset`, {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function chooseLookup(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).fill(option)
  await page.getByRole('option').filter({ hasText: option }).first().click()
}

async function createSubcontract(page: Page, name: string): Promise<string> {
  const ownName = `此流程已核实我方签约主体-${randomUUID()}`
  const ownId = await createVerifiedSignatory(page, ownName)
  await installContractEngineeringFixture(page, 'subcontract', '中央正式施工项目')
  await page.goto('/contract/subcontract/form')
  await expect(page.getByRole('heading', { name: /新建 · 分包合同/ })).toBeVisible({ timeout: 20_000 })
  await selectVerifiedSignatory(page, ownId, ownName)
  await page.getByLabel('合同名称 *').fill(name)
  await selectContractEngineeringFixture(page)
  await chooseLookup(page, '检索分供方', '中央正式劳务分供方')
  await page.getByLabel('合同内容简述 *').fill('E2E 正式劳务分包范围')
  await page.getByLabel('签约日期 *').fill('2026-08-25')
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/commands/subcontract-contracts') && response.request().method() === 'POST')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as { id: string }).id
}

async function createChange(page: Page, contractName: string, action: 'draft' | 'submit'): Promise<string> {
  await page.goto('/subcontract/change/new')
  await expect(page.getByRole('heading', { name: '新建 · 分包变洽签' })).toBeVisible({ timeout: 20_000 })
  await chooseLookup(page, '检索项目', '中央正式施工项目')
  await chooseLookup(page, '检索分供方', '中央正式劳务分供方')
  await chooseLookup(page, '检索分包合同', contractName)
  await page.getByTestId('owner-document-no').fill(action === 'submit' ? 'FB-E2E-327' : 'FB-DRAFT-327')
  await page.getByTestId('owner-document-changeDate').fill('2026-08-27')
  await page.getByTestId('owner-document-approvedAmount').fill(action === 'submit' ? '42700' : '12700')
  await page.getByTestId('owner-document-changedArea').fill('132.7')
  await page.getByTestId('owner-document-actualApprovedPrice').fill('41000')
  await page.getByTestId('owner-document-reason').fill(action === 'submit' ? 'E2E 分包范围调整' : 'E2E 草稿分包变更')
  if (action === 'submit') {
    await page.getByTestId('finance-attachment-input').setInputFiles({
      name: 'e2e-分包现场指令单.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('issue-327-subcontract-change'),
    })
  }
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: action === 'submit' ? '保存并提交' : '保存草稿' }).click()
  if (action === 'submit')
    await page.getByRole('dialog', { name: '提交' }).getByRole('button', { name: '提交', exact: true }).click()
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as { id: string }).id
}

// 创建界面由同文件的中央命令旅程覆盖；来源往返单独使用真实命令准备数据，避免重复冷启动两个表单。
async function seedSubmittedChange(page: Page, contractName: string) {
  const ownId = await createVerifiedSignatory(page, `来源往返已核实主体-${randomUUID()}`)
  const adoption = await verifiedSignatoryAdoption(page, ownId)
  const identity = { workspaceId: 'workspace-default', actorId: 'actor-default' }
  const contract = await page.request.post('/api/commands/subcontract-contracts', { data: {
    ...identity,
    requiredCapability: 'subcontract-contract:write',
    commandId: randomUUID(),
    baseVersion: null,
    action: 'save',
    constructionMain: { id: 'synthetic-ui-construction-main', projectId: 'project-real-320', basis: '0'.repeat(64) },
    draft: { ...adoption, name: contractName, projectId: 'project-real-320', supplierId: 'supplier-real-327', subKind: '劳务', content: 'E2E 正式劳务分包范围', signDate: '2026-08-25', amount: 0 },
    attachments: { add: [], removeIds: [], restoreIds: [] },
  } })
  expect(contract.ok(), await contract.text()).toBe(true)
  const contractId = (await contract.json()).id as string
  expect(contractId).toBeTruthy()
  const change = await page.request.post('/api/commands/owner-documents', { data: {
    ...identity,
    requiredCapability: 'subcontract-document:write',
    commandId: randomUUID(),
    kind: 'sub_change',
    id: null,
    baseVersion: null,
    action: 'submit',
    draft: { no: 'FB-E2E-327', projectId: 'project-real-320', contractId, supplierId: 'supplier-real-327', changeType: '增项', changeDate: '2026-08-27', approvedAmount: 42700, changedArea: 132.7, actualApprovedPrice: 41000, reason: 'E2E 分包范围调整' },
    attachments: { add: [{ fileName: 'e2e-分包现场指令单.pdf', fileSize: 28, mimeType: 'application/pdf', category: '业务附件' }], removeIds: [], restoreIds: [] },
  } })
  expect(change.ok(), await change.text()).toBe(true)
  const changeId = (await change.json()).id as string
  expect(changeId).toBeTruthy()
  return { contractId, changeId }
}

async function createPaginationDrafts(
  request: APIRequestContext,
  sessionId: string,
  contractId: string,
): Promise<void> {
  for (let index = 1; index <= 10; index += 1) {
    const response = await request.post('/api/commands/owner-documents', {
      headers: { 'x-ruihang-test-session': sessionId },
      data: {
        workspaceId: 'workspace-default',
        actorId: 'actor-default',
        requiredCapability: 'subcontract-document:write',
        commandId: `issue-327-pagination-${sessionId}-${index}`,
        action: 'save',
        kind: 'sub_change',
        id: null,
        baseVersion: null,
        draft: {
          no: `FB-E2E-327-SEED-${String(index).padStart(2, '0')}`,
          projectId: 'project-real-320',
          supplierId: 'supplier-real-327',
          contractId,
          changeType: '增项',
          changeDate: '2026-08-27',
          approvedAmount: index,
          reason: `分页证据 ${index}`,
        },
        attachments: { add: [], removeIds: [], restoreIds: [] },
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
}

test.describe('Issue #327：分包变洽签专属只读链', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id, 'projects')
    await reset(page.context().request, id, 'subcontract-contracts')
    await reset(page.context().request, id, 'owner-documents')
  })

  test('中央命令保存后从全局列表进入专属详情并精确返回', async ({ page }, testInfo) => {
    const contractName = 'E2E 中央劳务分包合同'
    const contractId = await createSubcontract(page, contractName)
    const changeId = await createChange(page, contractName, 'submit')
    await createPaginationDrafts(page.context().request, session(testInfo), contractId)

    await expect(page).toHaveURL('/subcontract/change')
    await page.setViewportSize({ width: 1024, height: 520 })
    await page.goto('/subcontract/change?search=FB-E2E-327&documentType=%E5%A2%9E%E9%A1%B9&page=2&pageSize=10')
    const mainLink = page.getByRole('link', { name: 'FB-E2E-327', exact: true })
    await expect(mainLink).toBeVisible({ timeout: 20_000 })
    const listSearch = page.getByRole('searchbox', { name: '搜索变更编号 / 类型 / 分供方' })
    await expect(listSearch).toHaveValue('FB-E2E-327')
    await expect(page.getByRole('button', { name: /^类型，已选 1 项$/ })).toHaveText('增项')
    await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('combobox', { name: '每页条数' })).toHaveValue('10')
    const globalWorkspace = page.locator('[data-shell-workspace]')
    const globalScrollTop = await globalWorkspace.evaluate((element) => {
      element.scrollTop = Math.min(96, element.scrollHeight - element.clientHeight)
      return element.scrollTop
    })
    expect(globalScrollTop).toBeGreaterThan(0)
    await mainLink.evaluate(element => (element as HTMLElement).click())
    await expect(page.getByTestId('subcontract-change-detail')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('group', { name: '审批金额' })).toContainText('¥42,700.00')
    await expect(page.getByRole('group', { name: '变更面积' })).toContainText('132.7 ㎡')
    await expect(page.getByRole('group', { name: '实际审定价' })).toContainText('¥41,000.00')
    await expect(page.getByRole('link', { name: '中央正式施工项目' })).toBeVisible()
    await expect(page.getByRole('link', { name: '中央正式劳务分供方' })).toBeVisible()
    await expect(page.getByText('e2e-分包现场指令单.pdf')).toBeVisible()
    await expect(page.getByTestId('subcontract-change-edit')).toHaveCount(0)
    await page.getByRole('link', { name: '返回分包变洽签列表' }).click()
    await expect.poll(() => {
      const url = new URL(page.url())
      return {
        path: url.pathname,
        search: url.searchParams.get('search'),
        documentType: url.searchParams.get('documentType'),
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
        hasNavigation: url.searchParams.get('nav')?.startsWith('origin_') ?? false,
        hash: url.hash,
      }
    }).toEqual({
      path: '/subcontract/change',
      search: 'FB-E2E-327',
      documentType: '增项',
      page: '2',
      pageSize: '10',
      hasNavigation: true,
      hash: `#${encodeURIComponent(`owner-document-row-real:sub_change:${changeId}`)}`,
    })
    await expect(listSearch).toHaveValue('FB-E2E-327')
    await expect(page.getByRole('button', { name: /^类型，已选 1 项$/ })).toHaveText('增项')
    await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('combobox', { name: '每页条数' })).toHaveValue('10')
    await expect(mainLink).toBeFocused()
    await expect.poll(() => globalWorkspace.evaluate(element => element.scrollTop)).toBe(globalScrollTop)
    await mainLink.evaluate(element => (element as HTMLElement).click())
    await expect(page.getByTestId('subcontract-change-detail')).toBeVisible({ timeout: 20_000 })
  })

  test('中央分包变洽签详情与分供方往返', async ({ page }) => {
    const contractName = 'E2E 中央劳务分包合同'
    const { changeId } = await seedSubmittedChange(page, contractName)
    await page.goto(`/subcontract/change/${changeId}?origin=real`)
    await expect(page.getByTestId('subcontract-change-detail')).toBeVisible({ timeout: 20_000 })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E 分包范围调整' })).toBeVisible()
    await page.getByRole('link', { name: '中央正式劳务分供方' }).click()
    await expect(page).toHaveURL(/\/base\/supplier\/supplier-real-327\?origin=real&returnTo=/)
    await page.getByRole('link', { name: '返回分包变洽签' }).click()
    await expect(page).toHaveURL(new RegExp(`/subcontract/change/${changeId}\\?origin=real`))
    await expect(page.getByRole('heading', { name: 'E2E 分包范围调整' })).toBeVisible()
  })

  test('中央分包变洽签来源筛选保留有效结果及无匹配空态', async ({ page }) => {
    const contractName = 'E2E 中央劳务分包合同'
    await seedSubmittedChange(page, contractName)
    await page.goto('/subcontract/change?supplier=supplier-real-327')
    await expect(page.getByLabel('来源筛选')).toContainText('分供方：中央正式劳务分供方')
    await expect(page.getByRole('link', { name: 'FB-E2E-327', exact: true })).toBeVisible()
    await page.goto('/subcontract/change?supplier=supplier-unknown-327')
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '没有符合条件的分包变洽签' })).toBeVisible()
  })

  test('中央分包变洽签详情与合同来源往返', async ({ page }) => {
    const contractName = 'E2E 中央劳务分包合同'
    const { contractId, changeId } = await seedSubmittedChange(page, contractName)
    await page.goto(`/subcontract/change/${changeId}?origin=real`)
    await page.getByText('来源单据', { exact: true }).locator('..').getByRole('link', { name: contractName }).click()
    await expect(page).toHaveURL(new RegExp(`/contract/${contractId}\\?.*tab=changes.*focus=${changeId}.*returnTo=`))
    await expect(page.getByRole('link', { name: 'E2E 分包范围调整' })).toBeFocused()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(new RegExp(`/subcontract/change/${changeId}\\?origin=real`))
  })

  test('从分供方进入中央分包变洽签并精确返回', async ({ page }) => {
    const contractName = 'E2E 中央劳务分包合同'
    await createSubcontract(page, contractName)
    await createChange(page, contractName, 'submit')

    await page.goto('/base/supplier/supplier-real-327?origin=real')
    await expect(page.getByRole('heading', { name: '中央正式劳务分供方' })).toBeVisible({ timeout: 20_000 })
    const workspace = page.locator('[data-shell-workspace]')
    const supplierEntry = page.getByRole('link', { name: '查看分包变洽签' })
    await expect(supplierEntry).toBeVisible()
    const supplierScrollTop = await workspace.evaluate((element) => {
      element.scrollTop = Math.min(96, element.scrollHeight - element.clientHeight)
      return element.scrollTop
    })
    await supplierEntry.evaluate(element => (element as HTMLElement).click())
    await expect(page).toHaveURL(/\/subcontract\/change\?.*supplier=supplier-real-327.*returnTo=/)
    await page.getByRole('link', { name: 'FB-E2E-327', exact: true }).click()
    await page.getByRole('link', { name: '返回分包变洽签列表' }).click()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/base\/supplier\/supplier-real-327\?origin=real&subChangeJourney=origin_[^#]+#supplier-subcontract-change-link/)
    await expect(page.getByRole('link', { name: '查看分包变洽签' })).toBeFocused()
    await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(supplierScrollTop)
  })

  test('从项目进入中央分包变洽签并精确返回', async ({ page }) => {
    const contractName = 'E2E 中央劳务分包合同'
    await createSubcontract(page, contractName)
    await createChange(page, contractName, 'submit')

    await page.goto(`/project/project-real-320?origin=real`)
    const projectCard = page.getByRole('link', { name: /分包变洽签/ })
    await expect(projectCard).toBeVisible({ timeout: 20_000 })
    await projectCard.click()
    await expect(page).toHaveURL(/\/subcontract\/change\?.*projectId=project-real-320.*returnTo=/)
    await page.getByRole('link', { name: 'FB-E2E-327', exact: true }).click()
    await page.getByRole('link', { name: '返回分包变洽签列表' }).click()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/project\/project-real-320\?origin=real&ownerJourney=origin_[^#]+#project-owner-document-card-sub-change/)
    await expect(page.getByRole('link', { name: /分包变洽签/ })).toBeFocused()
  })

  test('正式草稿只能通过显式整页入口编辑，取消后恢复原详情与合同来源', async ({ page }) => {
    const contractName = 'E2E 草稿劳务分包合同'
    const contractId = await createSubcontract(page, contractName)
    const changeId = await createChange(page, contractName, 'draft')
    const contractSource = `/contract/${contractId}?origin=real&contractKind=subcontract&tab=changes&focus=${changeId}`

    await page.goto(`/subcontract/change/${changeId}?origin=real&returnTo=${encodeURIComponent(contractSource)}`)
    await expect(page.getByRole('heading', { name: 'E2E 草稿分包变更' })).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('subcontract-change-edit').click()
    await expect(page).toHaveURL(new RegExp(`/subcontract/change/form/${changeId}\\?origin=real&returnTo=`))
    await expect(page.getByTestId('owner-document-approvedAmount')).toHaveValue('12700')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '取消' }).click()
    await expect(page).toHaveURL(new RegExp(`/subcontract/change/${changeId}\\?origin=real&returnTo=`))
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(contractSource)
    await expect(page.getByRole('link', { name: 'E2E 草稿分包变更' })).toBeFocused()
  })

  test('真实空态显示无数据', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'owner-documents', 'empty')
    await page.goto('/subcontract/change')
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无分包变洽签' })).toBeVisible({ timeout: 20_000 })
  })

  test('无权限显示权限提示', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'owner-documents', 'forbidden')
    await page.goto('/subcontract/change/sub-change-real-327?origin=real')
    await expect(page.getByText('无权查看分包变洽签')).toBeVisible({ timeout: 20_000 })
  })

  test('来源关系错配显示独立提示', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'owner-documents', 'ready')
    await page.goto('/subcontract/change/owner-penalty-real-326?origin=real')
    await expect(page.getByText('单据来源或关系不匹配')).toBeVisible({ timeout: 20_000 })
  })

  test('读取失败后可重试', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'owner-documents', 'unavailable')
    await page.goto('/subcontract/change/sub-change-real-327?origin=real')
    await expect(page.getByText('分包变洽签读取失败')).toBeVisible({ timeout: 20_000 })
    await reset(page.context().request, id, 'owner-documents', 'ready')
    await page.getByRole('button', { name: '重新加载' }).click()
    await expect(page.getByRole('heading', { name: '中央正式分包范围调整' })).toBeVisible()
  })

  test('列表与详情在各宽度无页面级横滚，密集宽表只在自身区域滚动', async ({ page }) => {
    const expectNoOverflowAcrossWidths = async (label: string) => {
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `#327 ${label} @ ${width}px`)
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/subcontract/change')
    const table = page.locator('[data-ui="owner-document-table"]')
    await expect(table).toBeVisible({ timeout: 20_000 })
    await table.focus()
    await expect(table).toBeFocused()
    await expectLocalHorizontalScroll(table, '#327 分包变洽签列表 @ 390px')
    await expectNoOverflowAcrossWidths('分包变洽签列表')

    await page.goto('/subcontract/change/sub-change-real-327?origin=real')
    await expect(page.getByTestId('subcontract-change-detail')).toBeVisible({ timeout: 20_000 })
    await expectNoOverflowAcrossWidths('分包变洽签详情')
  })
})
