import type { APIRequestContext } from '@playwright/test'
import type { QuantityCommand } from '../app/lib/quantity/central-contract'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { blankQuantityTemplateDraft, editableQuantityTemplateDraft } from '../app/lib/quantity/template'
import { expectLocalHorizontalScroll, expectNoPageOverflow } from './helpers/responsive'

test.use({ actionTimeout: 15_000 })

async function setupMonthly(request: APIRequestContext) {
  const headers = { 'x-ruihang-test-session': `quantity-monthly-${randomUUID()}` }
  const session = await (await request.get('/api/read/business-session', { headers })).json()
  const create = async (entity: string, capability: string, draft: Record<string, unknown>, action = 'draft') => {
    const response = await request.post(`/api/commands/${entity}`, { headers, data: { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: capability, commandId: randomUUID(), baseVersion: null, action, draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const project = await create('projects', 'project:write', { name: '月报当前链合成项目', manager: '合成经办人', status: '筹备中' })
  const projectId = project.id as string
  const contract = await create('construction-contracts', 'construction-contract:write', { name: '月报当前链施工合同', projectId, content: '合成验收', signDate: '2026-09-11', amount: 5200 })
  const ownerEnvelope = { ...session, requiredCapability: 'owner-document:write', kind: 'owner_change', attachments: { add: [], removeIds: [], restoreIds: [] } }
  const changeResponse = await request.post('/api/commands/owner-documents', { headers, data: { ...ownerEnvelope, commandId: randomUUID(), action: 'submit', id: null, baseVersion: null, draft: { name: '新增验收清单', reason: '合成端到端测试', projectId, contractId: contract.id, applicationDate: '2026-09-11', lines: [{ operation: 'add', itemName: '墙面抹灰', unit: '㎡', deltaQty: 100, newUnitPrice: 52 }] } } })
  expect(changeResponse.ok(), await changeResponse.text()).toBe(true)
  const change = await changeResponse.json()
  const approved = await request.post('/api/commands/owner-documents', { headers, data: { ...ownerEnvelope, commandId: randomUUID(), action: 'approve', id: change.id, baseVersion: change.version, approvedAt: '2026-09-11' } })
  expect(approved.ok(), await approved.text()).toBe(true)
  const crew = await create('crews', 'crew:write', { name: '月报当前链泥水班组', contactName: '合成联系人', contactPhone: '13800000000', trade: '泥水工', capabilityTrades: ['泥水工'], capabilityItems: ['墙面抹灰'], defaultPayRatio: 0.8, assignmentLevel: 'worker' }, 'save')
  const query = { projectId, origin: 'real', includeDemo: false }
  const read = async (endpoint: string, params: Record<string, string | number | boolean> = query) => {
    const response = await request.get(endpoint, { headers, params })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  let version = (await read('/api/read/quantity/region')).sourceVersion
  const execute = async (action: QuantityCommand['action']) => {
    const response = await request.post('/api/commands/quantity', { headers, data: { workspaceId: session.workspaceId, actorId: session.actorId, projectId, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: version, action } })
    expect(response.ok(), await response.text()).toBe(true)
    const result = await response.json()
    version = result.sourceVersion
    return result
  }
  const boq = (await read('/api/read/quantity/boq')).data.lines[0]
  expect(boq).toBeTruthy()
  const assignee = (await read('/api/read/quantity/assignments')).data.assignees.find((row: { id: string }) => row.id === crew.id)
  expect(assignee).toBeTruthy()
  const trade = assignee.trades[0] || assignee.trade
  const draft = blankQuantityTemplateDraft(projectId)
  Object.assign(draft, { code: 'M', name: '月报验证户型' })
  draft.newItems = [{ key: 'item', code: 'MONTHLY', name: assignee.itemNames[0] || boq.itemName, trade, section: '', unit: boq.unit, sortOrder: 1 }]
  draft.lines = [{ key: 'line', id: null, boqLineId: boq.id, roomKey: draft.rooms[0]!.key, itemId: 'item', recognizedContractQty: null, contractQty: 0, provisionalQty: null, fieldFormula: '2*3', fieldQty: 6, note: '', sortOrder: 1 }]
  const template = await execute({ kind: 'save-template', draft })
  const templates = (await read('/api/read/quantity/templates')).data
  expect(templates.lines[0].recognizedContractQty).toBe(boq.qty)
  const itemId = templates.items[0].id
  const building = await execute({ kind: 'create-building', draft: { code: 'M', name: '月报验证栋' } })
  const floor = await execute({ kind: 'create-floor', buildingId: building.id, draft: { code: '1', name: '一层' } })
  const unit = await execute({ kind: 'create-unit', floorId: floor.id, draft: { code: '101', name: '101室', templateId: template.id } })
  const unconfigured = await request.get('/api/commands/owner-documents/boq-lines', { headers, params: { projectId, contractId: boq.contractId, periodNo: '2026-09', quantityBasis: 'field' } })
  expect(unconfigured.status()).toBe(422)
  expect(await unconfigured.text()).toContain('报量阶段')
  const stage = await execute({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code: 'MONTHLY', name: '验收阶段', trade, completionMode: 'unit', sortOrder: 1, itemIds: [itemId] } })
  await execute({ kind: 'set-reporting-stage', itemId, stageId: stage.id, allowArchivedEdit: false })
  await execute({ kind: 'save-assignments', draft: { projectId, trade, assigneeKind: 'crew', assigneeId: assignee.id, unitIds: [unit.id], expectedAssignments: [{ unitId: unit.id, assignmentId: null, fingerprint: null }], scopes: [], allowReplacement: false } })
  const detail = (await read('/api/read/quantity/completion', { ...query, unitId: unit.id })).data
  const stageState = detail.stages.find((row: { id: string }) => row.id === stage.id)
  const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='
  await execute({ kind: 'save-completion', draft: { projectId, unitId: unit.id, stageId: stage.id, status: 'completed', completedAt: '2026-09-11', note: '', expectedCompletionId: null, expectedCompletionFingerprint: null, expectedAssignmentId: stageState.currentAssignment.id, photos: [{ fileName: '验收.png', mimeType: 'image/png', fileSize: Buffer.from(contentBase64, 'base64').length, contentBase64 }] } })
  const monthlyQuery = { projectId, contractId: boq.contractId, periodNo: '2026-09' }
  return { headers, session, boq, monthlyQuery, template, read, execute }
}

test('当前清单、中央完工与甲方月报经真实 HTTP 联通，三量不回退且已提交快照不漂移', async ({ request }) => {
  test.setTimeout(120_000)
  const { headers, session, boq, monthlyQuery, template, read, execute } = await setupMonthly(request)
  const field = await read('/api/commands/owner-documents/boq-lines', { ...monthlyQuery, quantityBasis: 'field' })
  expect(field).toEqual([expect.objectContaining({ id: boq.id, autoQty: 6, missingQtyCount: 0 })])
  expect(await read('/api/commands/owner-documents/boq-lines', { ...monthlyQuery, quantityBasis: 'contract' })).toEqual([expect.objectContaining({ autoQty: 0, missingQtyCount: 0 })])
  expect(await read('/api/commands/owner-documents/boq-lines', { ...monthlyQuery, quantityBasis: 'provisional' })).toEqual([expect.objectContaining({ autoQty: 0, missingQtyCount: 1 })])
  const response = await request.post('/api/commands/owner-documents', { headers, data: { ...session, requiredCapability: 'owner-document:write', commandId: randomUUID(), kind: 'owner_report', action: 'submit', id: null, baseVersion: null, draft: { ...monthlyQuery, applicationDate: '2026-09-11', quantityBasis: 'field', lines: [{ boqLineId: boq.id }] }, attachments: { add: [], removeIds: [], restoreIds: [] } } })
  expect(response.ok(), await response.text()).toBe(true)
  const report = await response.json()
  const before = await read(`/api/commands/owner-documents/owner_report/${report.id}/form`, {})
  expect(before.draft).toMatchObject({ quantityBasis: 'field', reportedAmount: 6 * boq.effectiveUnitPrice, lines: [expect.objectContaining({ autoQty: 6, reportedQty: 6 })] })
  const changed = editableQuantityTemplateDraft((await read('/api/read/quantity/templates')).data, template.id)
  changed.lines[0]!.fieldFormula = '9'
  await execute({ kind: 'save-template', draft: changed })
  expect(await read('/api/commands/owner-documents/boq-lines', { ...monthlyQuery, quantityBasis: 'field' })).toEqual([expect.objectContaining({ autoQty: 9 })])
  expect(await read(`/api/commands/owner-documents/owner_report/${report.id}/form`, {})).toEqual(before)
})

test('甲方月报换基准、申报冻结并逐行审定，刷新列表回读差额', async ({ page, request }) => {
  test.setTimeout(150_000)
  const { headers, boq, monthlyQuery, template, read, execute } = await setupMonthly(request)
  await page.setExtraHTTPHeaders(headers)
  await page.goto('/owner/report/new')
  await expect(page.getByRole('heading', { name: '新建 · 甲方报量' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('combobox', { name: '检索项目', exact: true }).fill('月报当前链合成项目')
  await page.getByRole('option').filter({ hasText: '月报当前链合成项目' }).click()
  await page.getByRole('combobox', { name: '检索施工合同', exact: true }).fill('月报当前链施工合同')
  await page.getByRole('option').filter({ hasText: '月报当前链施工合同' }).click()
  await page.getByTestId('owner-document-periodNo').fill('2026-09')
  await page.getByTestId('owner-document-applicationDate').fill('2026-09-11')
  await page.getByTestId('owner-document-operatorName').fill('月报合成经办')
  const basis = page.getByRole('combobox', { name: '取数基准', exact: true })
  const quantity = page.getByRole('spinbutton', { name: '申报量', exact: true })
  await expect(quantity).toHaveValue('6')
  await quantity.fill('8')
  await basis.click()
  await page.getByRole('option', { name: '合同量', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '更换报量基准' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '保留原稿' }).click()
  await expect(quantity).toHaveValue('8')
  await expect(basis).toContainText('现场复核量')
  await basis.click()
  await page.getByRole('option', { name: '合同量', exact: true }).click()
  await confirmation.getByRole('button', { name: '确认重算' }).click()
  await expect(quantity).toHaveValue('0')
  await basis.click()
  await page.getByRole('option', { name: '暂估量', exact: true }).click()
  await confirmation.getByRole('button', { name: '确认重算' }).click()
  await expect(quantity).toHaveValue('')
  await expect(page.getByText(/项报量 · 申报 待核对/)).toBeVisible()

  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await expectNoPageOverflow(page, `甲方月报缺量 @ ${width}px`)
    await page.getByTestId('owner-document-line-scroll').scrollIntoViewIfNeeded()
    if (width <= 768)
      await expectLocalHorizontalScroll(page.getByTestId('owner-document-line-scroll'), `甲方报量明细 @ ${width}px`)
    await quantity.scrollIntoViewIfNeeded()
  }
  await basis.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: '现场复核量', exact: true }).click()
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '确认重算' }).focus()
  await expect(confirmation.getByRole('button', { name: '确认重算' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(quantity).toHaveValue('6')
  const submitted = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents')
    && response.request().method() === 'POST' && response.request().postDataJSON().action === 'submit')
  await page.getByRole('button', { name: '保存并申报' }).click()
  await page.getByRole('dialog', { name: '申报', exact: true }).getByRole('button', { name: '申报', exact: true }).click()
  const response = await submitted
  expect(response.ok(), await response.text()).toBe(true)
  const report = await response.json()
  await expect(page).toHaveURL(/\/owner\/report(?:\?|$)/)
  const before = await read(`/api/commands/owner-documents/owner_report/${report.id}/form`, {})
  expect(before.draft).toMatchObject({ quantityBasis: 'field', reportedAmount: 6 * boq.effectiveUnitPrice, lines: [expect.objectContaining({ autoQty: 6, reportedQty: 6 })] })
  const changed = editableQuantityTemplateDraft((await read('/api/read/quantity/templates')).data, template.id)
  changed.lines[0]!.fieldFormula = '9'
  await execute({ kind: 'save-template', draft: changed })
  expect(await read('/api/commands/owner-documents/boq-lines', { ...monthlyQuery, quantityBasis: 'field' })).toEqual([expect.objectContaining({ autoQty: 9 })])
  expect(await read(`/api/commands/owner-documents/owner_report/${report.id}/form`, {})).toEqual(before)
  await page.goto(`/owner/report/${report.id}?origin=real`)
  await expect(page.getByTestId('owner-commercial-document-detail')).toBeVisible()
  await expect(page.getByRole('group', { name: '申报金额', exact: true })).toContainText('312.00')
  await expect(page.getByTestId('owner-commercial-document-detail')).toContainText('月报合成经办')
  await page.reload()
  await expect(page.getByRole('group', { name: '申报金额', exact: true })).toContainText('312.00')
  await page.getByRole('button', { name: '处理流转', exact: true }).click()
  await page.getByRole('spinbutton', { name: '审定量', exact: true }).fill('4')
  const audited = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents')
    && response.request().method() === 'POST' && response.request().postDataJSON().action === 'audit')
  await page.getByRole('button', { name: '确认审定', exact: true }).click()
  await page.getByRole('dialog', { name: '确认甲方审定' }).getByRole('button', { name: '确认审定', exact: true }).click()
  const auditResponse = await audited
  expect(auditResponse.ok(), await auditResponse.text()).toBe(true)
  expect(await auditResponse.json()).toMatchObject({ id: report.id })
  const after = await read(`/api/commands/owner-documents/owner_report/${report.id}/form`, {})
  expect(after.draft).toMatchObject({
    reportedAmount: 312,
    auditedAmount: 208,
    lines: [expect.objectContaining({ boqLineId: boq.id, autoQty: 6, reportedQty: 6, auditedQty: 4 })],
  })
  await page.goto(`/owner/report/${report.id}?origin=real`)
  await expect(page.getByRole('group', { name: '申报金额', exact: true })).toContainText('312.00')
  await expect(page.getByRole('group', { name: '审定金额', exact: true })).toContainText('208.00')
  await expect(page.getByRole('group', { name: '审定差额', exact: true })).toContainText('¥-104.00')
  await page.goto(`/owner/report?origin=real&projectId=${monthlyQuery.projectId}&status=audited`)
  const reportLink = page.locator(`a[href^="/owner/report/${report.id}?"]`)
  await expect(reportLink).toBeVisible()
  const auditedRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '已审定', exact: true }) })
  await expect(auditedRow).toContainText('208.00')
  await expect(auditedRow).toContainText('-104.00')
  await reportLink.click()
  await expect(page.getByRole('group', { name: '审定金额', exact: true })).toContainText('208.00')
})
