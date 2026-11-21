import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import type { BoqBuildingContext } from '../app/lib/boq/central-building-contract'
import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { QuantityCommand } from '../app/lib/quantity/central-contract'
import type { QuantityCompletionStageView } from '../app/lib/quantity/completion'
import type { QuantityTemplateWorkspace } from '../app/lib/quantity/template'
import type { ScheduleBindingRead } from '../app/lib/schedule/central-binding-contract'
import type { ScheduleAction, ScheduleCommand, ScheduleCommandResult, ScheduleRead } from '../app/lib/schedule/central-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { editableQuantityTemplateDraft } from '../app/lib/quantity/template'

test.use({ actionTimeout: 15_000 })
const BACKUP_INPUT = { createdAt: '2026-09-15T00:00:00.000Z' }

async function resetMigrationFixture({ request }: { request: APIRequestContext }) {
  if (process.env.SCHEDULE_BINDING_RESUME_PROJECT)
    return
  const response = await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(response.ok(), await response.text()).toBe(true)
}

test.beforeEach(resetMigrationFixture)
test.afterEach(resetMigrationFixture)
async function choose(page: Page, label: string, name: string | RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name }).click()
}
async function capture(page: Page, info: TestInfo, name: string, detail: 'lower' | 'horizontal' | null = null) {
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 12_000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: detail ? 720 : 960 })
    if (detail) {
      const table = page.getByRole('region', { name: '分项与数量差异', exact: true })
      await table.evaluate(node => node.scrollIntoView({ block: 'center' }))
      await expect.poll(async () => {
        const box = await table.boundingBox()
        return !!box && box.y >= 72 && box.y + box.height <= 720
      }).toBe(true)
      if (detail === 'horizontal') {
        const scroller = table.locator('.vxe-table--body-inner-wrapper')
        await scroller.evaluate((node) => {
          node.scrollLeft = node.scrollWidth
        })
        await expect.poll(() => scroller.evaluate(node => node.scrollWidth <= node.clientWidth + 1 || node.scrollLeft > 0)).toBe(true)
        await expect(table.getByRole('button', { name: '查看清单来源 1', exact: true }).first()).toBeInViewport()
      }
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const dialog of await page.locator('[role="dialog"]:visible').all())
      await expect(dialog).toHaveCSS('opacity', '1')
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
}
async function fixture(page: Page, info: TestInfo) {
  const resumeProjectId = process.env.SCHEDULE_BINDING_RESUME_PROJECT
  if (resumeProjectId) {
    const runId = process.env.SCHEDULE_BINDING_RESUME_RUN
    const groupId = process.env.SCHEDULE_BINDING_RESUME_GROUP
    const libraryId = process.env.SCHEDULE_BINDING_RESUME_LIBRARY
    const expectedState = process.env.SCHEDULE_BINDING_RESUME_STATE
    expect(runId && groupId && libraryId && ['provisional', 'contract'].includes(expectedState ?? ''), '续测必须声明完整批次、分组、工序库和预期状态').toBeTruthy()
    const catalog = await (await page.request.get('/api/read/schedule/catalog', { params: { origin: 'real', includeDemo: false } })).json()
    const project = catalog.projects.find((row: { id: string, name: string }) => row.id === resumeProjectId && row.name === `绑定验收工程 · ${runId}`)
    expect(project, '只能继续本票已知的合成项目，不得按名称回退其他项目').toBeTruthy()
    const read = async (): Promise<ScheduleRead> => (await page.request.get('/api/read/schedule/workspace', { params: { projectId: resumeProjectId, origin: 'real', includeDemo: false } })).json()
    expect((await read()).snapshot.groups.find(group => group.id === groupId)).toMatchObject({ id: groupId, processLibraryId: libraryId, scopeBasis: expectedState })
    return { projectId: resumeProjectId, libraryName: `绑定验收工序库 · ${runId}`, read }
  }
  const output = info.outputPath('binding-source.json')
  const runId = randomUUID()
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/schedule-binding-source.ts'), output, runId])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(output, 'utf8'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const identity = { workspaceId: session.workspaceId, actorId: session.actorId }
  const envelope = () => ({ ...identity, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: BACKUP_INPUT.createdAt, immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const response = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const mapped = (entityType: string, legacyId: string) => batch.mappings.find(row => row.entityType === entityType && row.legacyId === legacyId)!.serverId
  const projectId = mapped('projects', 'q-project')
  const read = async (): Promise<ScheduleRead> => (await page.request.get('/api/read/schedule/workspace', { params: { projectId, origin: 'real', includeDemo: false } })).json()
  const command = async (action: ScheduleAction) => {
    const current = await read()
    const response = await page.request.post('/api/commands/schedule', { data: { ...identity, commandId: randomUUID(), projectId, origin: 'real', requiredCapability: 'schedule:write', sourceVersion: current.sourceVersion, action } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  return { projectId, mapped, read, command, identity, libraryName: `绑定验收工序库 · ${runId}` }
}

async function exerciseExceptions(page: Page, info: TestInfo, data: Awaited<ReturnType<typeof fixture>>, contractId: string) {
  const projectId = data.projectId
  const session = await (await page.request.get('/api/read/business-session')).json()
  const identity = { workspaceId: session.workspaceId, actorId: session.actorId }
  const query = { projectId, origin: 'real', includeDemo: false }
  const readQuantity = async (kind: string, params: Record<string, string> = {}) => (await page.request.get(`/api/read/quantity/${kind}`, { params: { ...query, ...params } })).json()
  const quantity = async (action: QuantityCommand['action']) => {
    const current = await readQuantity('region')
    const response = await page.request.post('/api/commands/quantity', { data: { ...identity, commandId: randomUUID(), requiredCapability: 'quantity:write', ...query, includeDemo: undefined, baseVersion: current.sourceVersion, action } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const boqRead = async (): Promise<BoqBuildingContext> => (await page.request.get('/api/read/boq/building-context', { params: { projectId, contractId, origin: 'real' } })).json()
  const correct = async (lineId: string, buildingId: string, reason: string) => {
    const read = await boqRead()
    const response = await page.request.post('/api/commands/boq-building', { data: { ...identity, commandId: randomUUID(), requiredCapability: 'owner-document:write', projectId, contractId, origin: 'real', sourceVersion: read.sourceVersion, lineId, buildingId, reason } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const exceptionResume = process.env.SCHEDULE_BINDING_EXCEPTION_RESUME ? JSON.parse(await readFile(process.env.SCHEDULE_BINDING_EXCEPTION_RESUME, 'utf8')) : null
  if (exceptionResume) {
    expect(exceptionResume.projectId).toBe(projectId)
    expect(exceptionResume.contractId).toBe(contractId)
    expect((await data.read()).snapshot.groups.find(row => row.id === exceptionResume.groupId)).toMatchObject({ scopeBasis: 'provisional', buildingIds: [exceptionResume.buildingId] })
  }
  const run = exceptionResume?.run ?? randomUUID().slice(0, 8)
  let templates: QuantityTemplateWorkspace = (await readQuantity('templates')).data
  const template = templates.templates.find(row => row.code === 'TC')!
  let partial = templates.templates.find(row => row.code === 'PARTIAL')!
  expect(template && partial).toBeTruthy()
  if (!exceptionResume) {
    const initial = editableQuantityTemplateDraft(templates, partial.id)
    const wall = initial.lines.find(line => line.itemId === templates.items.find(item => item.code === 'I')!.id)!
    if (wall.provisionalQty !== null) {
      wall.provisionalQty = null
      await quantity({ kind: 'save-template', draft: initial })
      templates = (await readQuantity('templates')).data
      partial = templates.templates.find(row => row.id === partial.id)!
    }
  }
  const building = exceptionResume ? { id: exceptionResume.buildingId } : await quantity({ kind: 'create-building', draft: { code: `B-${run}`, name: `异常恢复验收栋 ${run}` } })
  const sourceLines = ['wbs-contract-boq', 'binding-boq-ZERO', 'binding-boq-LENGTH']
  let groupId: string = exceptionResume?.groupId ?? ''
  if (!exceptionResume) {
    const floor = await quantity({ kind: 'create-floor', buildingId: building.id, draft: { code: 'F1', name: '一层' } })
    for (const [code, templateId] of [['301', template.id], ['302', partial.id]])
      await quantity({ kind: 'create-unit', floorId: floor.id, draft: { code: code!, name: `${code}户`, templateId: templateId! } })
    for (const lineId of sourceLines) {
      expect((await boqRead()).lines.some(row => row.id === lineId && row.sourceKind === 'confirmed-import')).toBe(true)
    }
    await page.goto(`/schedule/new?project=${projectId}&origin=real`)
    await expect(page.locator('[data-schedule-wizard-step="1"]')).not.toHaveAttribute('inert')
    await page.getByLabel('分组名称').fill(`异常恢复暂估组 ${run}`)
    await page.getByRole('radio', { name: /内部暂估/ }).check()
    await expect(page.locator('[data-schedule-wizard-step="1"]')).not.toHaveAttribute('inert')
    for (const checkbox of await page.getByRole('checkbox').all()) {
      const label = await checkbox.evaluate(node => node.closest('label')?.textContent ?? '')
      if (!label.includes(`异常恢复验收栋 ${run}`))
        await checkbox.uncheck()
    }
    await page.getByRole('checkbox', { name: new RegExp(`异常恢复验收栋 ${run}`) }).check()
    await page.getByRole('button', { name: '下一步：选择工序' }).click()
    await choose(page, '标准工序库', new RegExp(data.libraryName))
    await page.getByRole('button', { name: '下一步：预览排程' }).click()
    await page.getByRole('button', { name: '生成排程', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '生成排程', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\?.*group=/)
    groupId = new URL(page.url()).searchParams.get('group')!
  }
  const before = (await data.read()).snapshot.groups.find(row => row.id === groupId)!
  expect(before.buildingIds).toEqual([building.id])
  const units = (await readQuantity('region')).data.units as Array<{ id: string }>
  const completionFacts = async () => Promise.all(units.map(async unit => ({ unitId: unit.id, stages: ((await readQuantity('completion', { unitId: unit.id })).data.stages as QuantityCompletionStageView[]).map(stage => ({ id: stage.id, completion: stage.completion, photos: stage.photos, assignment: stage.currentAssignment })) })))
  const completionBefore = await completionFacts()
  await writeFile(info.outputPath('exception-fixture.json'), JSON.stringify({ projectId, contractId, groupId, buildingId: building.id, run, before, completionBefore }, null, 2))
  // 修改当前模板后，既有楼层暂估必须仍保留建组时的8/null，不能用99补齐。
  if (!exceptionResume) {
    const edit = editableQuantityTemplateDraft(templates, partial.id)
    edit.lines.find(line => line.itemId === templates.items.find(item => item.code === 'I')!.id)!.provisionalQty = 99
    await quantity({ kind: 'save-template', draft: edit })
  }
  const bindingUrl = `/schedule/${projectId}/bind/${groupId}?origin=real&contract=${contractId}&month=2026-09&view=crew&assignee=crew:source`
  await page.goto(bindingUrl)
  await expect(page.getByText('已知 8 · 缺 1 项', { exact: true })).toBeVisible()
  const confirmButton = page.getByRole('button', { name: '确认绑定合同', exact: true })
  if (!exceptionResume) {
    await expect(confirmButton).toBeDisabled()
    await capture(page, info, 'coverage-blocked-frozen')
    await page.getByRole('button', { name: '补齐合同楼栋证据' }).click()
    await choose(page, '合同清单行', /腻子.*原量 12.*已确认导入/)
    await choose(page, '实际覆盖楼栋', new RegExp(`异常恢复验收栋 ${run}`))
    await page.getByRole('textbox', { name: '更正理由' }).fill(`已确认合成原件所列腻子属于验收栋 ${run}`)
    await capture(page, info, 'building-evidence-draft')
    await page.getByRole('button', { name: '保存楼栋证据', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '保存楼栋证据', exact: true }).click()
    await expect(page).toHaveURL(/\/bind\//)
    for (const lineId of sourceLines.slice(1))
      await correct(lineId, building.id, `本票合成来源范围更正至独立验收栋 ${run}`)
    await page.goto(bindingUrl)
  }
  await expect(confirmButton).toBeEnabled()
  await confirmButton.scrollIntoViewIfNeeded()
  await capture(page, info, 'comparison-lower-and-confirm', 'lower')
  await capture(page, info, 'comparison-horizontal-sources', 'horizontal')
  await confirmButton.click()
  const cancelButton = page.getByRole('dialog').getByRole('button', { name: '取消', exact: true })
  await cancelButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(confirmButton).toBeFocused()
  expect((await data.read()).snapshot.groups.find(row => row.id === groupId)!.scopeBasis).toBe('provisional')
  await page.route('**/api/commands/schedule', async (route) => {
    if (route.request().postDataJSON().action.kind === 'bind-contract') {
      const source = await boqRead()
      const extra = source.lines.find(row => row.id === 'q-boq')!
      const other = source.buildings.find(row => row.code === (extra.building === 'B1' ? 'B2' : 'B1'))!
      await correct(extra.id, other.id, `另一入口更新额外楼栋证据 ${run}`)
    }
    await route.continue()
  })
  await confirmButton.click()
  await page.getByRole('dialog').getByRole('button', { name: '确认绑定', exact: true }).click()
  await expect(page.getByText('合同选择已保留，请重新核对最新资料后再确认。')).toBeVisible()
  await expect(page.getByLabel('已选施工合同', { exact: true })).toHaveText('迁入合同')
  await page.unroute('**/api/commands/schedule')
  await expect(confirmButton).toBeDisabled()
  await page.locator('.binding-screen').getByRole('heading', { name: '绑定施工合同', exact: true }).scrollIntoViewIfNeeded()
  await capture(page, info, 'stale-preview-retained')
  expect((await data.read()).snapshot.groups.find(row => row.id === groupId)!.scopeBasis).toBe('provisional')
  await page.getByRole('button', { name: '重新核对资料', exact: true }).click()
  await expect(confirmButton).toBeEnabled()
  const submitted: ScheduleCommand[] = []
  let applied: ScheduleCommandResult | null = null
  await page.route('**/api/commands/schedule', async (route) => {
    const command = route.request().postDataJSON()
    if (command.action.kind !== 'bind-contract')
      return route.continue()
    submitted.push(command)
    if (submitted.length === 1) {
      const result = await route.fetch()
      expect(result.ok(), await result.text()).toBe(true)
      applied = await result.json()
      await route.abort('failed')
    }
    else { await route.continue() }
  })
  await confirmButton.click()
  await page.getByRole('dialog').getByRole('button', { name: '确认绑定', exact: true }).click()
  const recover = page.getByRole('button', { name: '核对原提交', exact: true })
  await expect(recover).toBeEnabled()
  await expect(page.getByLabel('已选施工合同', { exact: true })).toHaveText('迁入合同')
  await recover.scrollIntoViewIfNeeded()
  await capture(page, info, 'unknown-command-retained')
  const resolution = page.waitForResponse(response => new URL(response.url()).pathname === '/api/commands/schedule/resolve')
  await recover.focus()
  await page.keyboard.press('Enter')
  const proof = await resolution
  const original = submitted[0]!
  expect(proof.request().postDataJSON()).toEqual({ commandId: original.commandId, workspaceId: original.workspaceId, actorId: original.actorId, family: 'schedule', targetId: original.projectId, action: 'bind-contract' })
  expect(proof.ok(), await proof.text()).toBe(true)
  expect(await proof.json()).toEqual({ outcome: 'applied', result: applied })
  await expect(page).toHaveURL(url => url.pathname === '/schedule' && url.searchParams.get('group') === groupId, { timeout: 20_000 })
  await page.unroute('**/api/commands/schedule')
  expect(submitted).toHaveLength(1)
  expect((await data.read()).snapshot.groups.find(row => row.id === groupId)!.tasks).toEqual(before.tasks)
  expect(await completionFacts()).toEqual(completionBefore)
  await page.goto(bindingUrl)
  await expect(page.getByText('已知 8 · 缺 1 项', { exact: true })).toBeVisible()
  const envelope = { ...identity, requiredCapability: 'owner-document:write' }
  const changeResponse = await page.request.post('/api/commands/owner-documents', { data: { ...envelope, commandId: randomUUID(), action: 'submit', kind: 'owner_change', id: null, baseVersion: null, draft: { name: `已签新增只读 ${run}`, reason: '本票合成实际签证', projectId, contractId, applicationDate: '2026-09-12', lines: [{ operation: 'add', itemName: `已签新增只读 ${run}`, unit: '㎡', deltaQty: 2, newUnitPrice: 4 }] }, attachments: {} } })
  expect(changeResponse.ok(), await changeResponse.text()).toBe(true)
  const change = await changeResponse.json()
  const approved = await page.request.post('/api/commands/owner-documents', { data: { ...envelope, commandId: randomUUID(), action: 'approve', kind: 'owner_change', id: change.id, baseVersion: change.version, approvedAt: '2026-09-12' } })
  expect(approved.ok(), await approved.text()).toBe(true)
  await page.getByRole('button', { name: '查看清单来源 1', exact: true }).first().click()
  await choose(page, '合同清单行', new RegExp(`已签新增只读 ${run}`))
  await expect(page.getByText(/已签证变更新增行不可直接更正/)).toBeVisible()
  await expect(page.getByRole('button', { name: '保存楼栋证据', exact: true })).toHaveCount(0)
  await capture(page, info, 'signed-addition-readonly')
}

test('暂估冻结差异、缺覆盖更正往返、取消与确认、绑定冷读及原楼层来源五档闭环', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const data = await fixture(page, info)
  const initial = await data.read()
  const contractId = initial.contracts[0]!.id
  const oldGroup = initial.snapshot.groups.find(group => group.contractId)!
  await page.goto(`/schedule/${data.projectId}/bind/${oldGroup.id}?origin=real`)
  await expect(page.getByRole('heading', { name: '施工合同绑定依据' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/旧来源没有保存绑定时的完整差异/)).toBeVisible()
  await capture(page, info, 'legacy-bound-readonly')

  let createdGroupId = process.env.SCHEDULE_BINDING_RESUME_GROUP
  if (!createdGroupId) {
    await page.goto(`/schedule/new?project=${data.projectId}&origin=real`)
    await expect(page.getByLabel('分组名称')).toBeEnabled()
    await page.getByLabel('分组名称').fill('冻结数量待绑定组')
    await page.getByRole('radio', { name: /内部暂估/ }).check()
    const building = page.getByRole('checkbox', { name: /合同待建二栋/ })
    await expect(building).toBeEnabled()
    await building.check()
    await expect(building).toBeChecked()
    await page.getByRole('button', { name: '下一步：选择工序' }).click()
    await choose(page, '标准工序库', new RegExp(data.libraryName))
    await page.getByRole('button', { name: '下一步：预览排程' }).click()
    await page.getByRole('button', { name: '生成排程', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '生成排程', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\?.*group=/)
    createdGroupId = new URL(page.url()).searchParams.get('group')!
  }
  const created = await data.read()
  const group = created.snapshot.groups.find(row => row.id === createdGroupId)!
  expect(group.tasks).toHaveLength(3)
  const baselinePath = process.env.SCHEDULE_BINDING_BASELINE
  const beforeTasks = baselinePath ? JSON.parse(await readFile(baselinePath, 'utf8')).snapshot.groups.find((row: { id: string }) => row.id === group.id).tasks : structuredClone(group.tasks)
  const bindingUrl = `/schedule/${data.projectId}/bind/${group.id}?origin=real&group=${group.id}&month=2026-09&view=crew&assignee=crew:source`
  if (group.scopeBasis === 'provisional') {
    await page.goto(bindingUrl)
    const lookup = page.getByRole('combobox', { name: /搜索合同名称或编号/ })
    await lookup.click()
    await page.getByRole('option', { name: /BIND-/ }).click()
    await expect(page.getByRole('heading', { name: '必须先处理' })).toBeVisible()
    await expect(page.getByRole('button', { name: '确认绑定合同', exact: true })).toBeDisabled()
    await expect(page.getByText('已知 8 · 缺 1 项', { exact: true })).toBeVisible()
    await capture(page, info, 'coverage-blocked-frozen')
    await page.getByRole('button', { name: '补齐合同楼栋证据' }).click()
    await expect(page.getByRole('heading', { name: '更正楼栋证据' })).toBeVisible()
    for (const name of ['腻子', '真零踢脚线', '按米核对管线']) {
      await choose(page, '合同清单行', new RegExp(`${name}.*楼栋未提供.*已确认导入`))
      await choose(page, '实际覆盖楼栋', /合同待建二栋/)
      await page.getByRole('textbox', { name: '更正理由' }).fill(`合成原件清单所列${name}属于二栋`)
      if (name === '腻子')
        await capture(page, info, 'building-evidence-draft')
      await page.getByRole('button', { name: '保存楼栋证据', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '保存楼栋证据', exact: true }).click()
      await expect(page).toHaveURL(/\/bind\//)
      await expect(page.getByRole('heading', { name: '绑定差异复核', exact: true })).toBeVisible()
      if (name !== '按米核对管线')
        await page.getByRole('button', { name: '查看清单来源 1', exact: true }).last().click()
    }
    await expect(page.getByRole('button', { name: '确认绑定合同', exact: true })).toBeEnabled()
    await capture(page, info, 'ready-to-bind')
    await page.getByRole('button', { name: '确认绑定合同', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    expect((await data.read()).snapshot.groups.find(row => row.id === group.id)!.scopeBasis).toBe('provisional')
    await page.getByRole('button', { name: '确认绑定合同', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认绑定', exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/schedule' && url.searchParams.get('project') === data.projectId && url.searchParams.get('group') === group.id)
  }
  await page.reload()
  const bound = (await data.read()).snapshot.groups.find(row => row.id === group.id)!
  expect(bound.contractId).toBe(contractId)
  expect(bound.tasks).toEqual(beforeTasks)
  await page.goto(bindingUrl)
  await expect(page.getByRole('heading', { name: '施工合同绑定依据' })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认绑定合同', exact: true })).toHaveCount(0)
  await capture(page, info, 'bound-cold-read')
  await page.getByRole('heading', { name: '分项与数量差异', exact: true }).scrollIntoViewIfNeeded()
  await capture(page, info, 'bound-differences-lower', 'lower')
  await page.getByRole('button', { name: '查看清单来源 1', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: '合同清单来源', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存楼栋证据', exact: true })).toHaveCount(0)
  await capture(page, info, 'contract-source-readonly')
  await page.getByRole('link', { name: '查看原楼层计划 1', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /工序详情/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('dialog', { name: /工序详情/ })).toBeVisible()
  await capture(page, info, 'original-floor-readonly')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('link', { name: '返回合同清单来源' }).click()
  await expect(page.getByRole('heading', { name: '合同清单来源', exact: true })).toBeVisible()
  expect(errors).toEqual([])
  const response = await page.request.get('/api/read/schedule/binding', { params: { projectId: data.projectId, groupId: group.id, contractId, origin: 'real', includeDemo: false } })
  const binding: ScheduleBindingRead = await response.json()
  expect(binding.binding?.preview?.items.some(item => item.provisional.missingCount === 1 && item.differenceQty === null)).toBe(true)
  await exerciseExceptions(page, info, data, contractId)
  expect(errors).toEqual([])
})
