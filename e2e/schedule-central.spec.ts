import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { ScheduleRead } from '../app/lib/schedule/central-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { blankQuantityTemplateDraft } from '../app/lib/quantity/template'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

test.use({ actionTimeout: 15_000 })
const BACKUP_INPUT = { createdAt: '2026-09-15T00:00:00.000Z' }

async function resetMigrationFixture({ request }: { request: APIRequestContext }) {
  const response = await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(response.ok(), await response.text()).toBe(true)
}

test.beforeEach(resetMigrationFixture)
test.afterEach(resetMigrationFixture)

async function choose(page: Page, label: string, name: string | RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name }).click()
}

async function capture(page: Page, info: TestInfo, name: string, widths = [390, 768, 1024, 1280, 1440]) {
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 12_000 })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 960 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const dialog of await page.locator('[role="dialog"]:visible').all())
      await expect(dialog).toHaveCSS('opacity', '1')
    for (const control of await page.locator('[data-schedule-wizard-step="1"] input, [data-schedule-wizard-step="1"] [role="combobox"]').all()) {
      const bounds = await control.boundingBox()
      expect(bounds, '第一步表单控件应有可见边界').not.toBeNull()
      expect(bounds!.x + bounds!.width, '第一步表单控件不得被屏幕右侧裁切').toBeLessThanOrEqual(width)
    }
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
}

async function importWbs(page: Page, info: TestInfo) {
  const output = info.outputPath('wbs-source.json')
  const runId = randomUUID()
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/wbs-migration-source.ts'), output, runId])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(output, 'utf8'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
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
  const read = async (): Promise<ScheduleRead> => {
    const response = await page.request.get('/api/read/schedule/workspace', { params: { projectId, origin: 'real', includeDemo: false } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  return { projectId, read, mapped, libraryName: `历史排程库 · ${runId}` }
}

test('中央合同三步建组、冻结历史、任务调整与基线在五档视口闭环', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  const fixture = await importWbs(page, info)
  const scheduleUrl = `/schedule?project=${fixture.projectId}&origin=real`
  await page.goto(scheduleUrl)
  await expect(page.getByRole('button', { name: '原冻结任务', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('schedule-history').locator('summary').first().click()
  await expect(page.getByTestId('schedule-history')).toContainText('无组旧删除任务')
  await expect(page.getByTestId('schedule-history')).toContainText('绑定施工合同')
  await page.getByRole('button', { name: '原冻结任务', exact: true }).click()
  const original = page.getByRole('dialog', { name: '工序详情 · 原冻结任务' })
  await expect(original).toContainText('旧冻结暂估量 8')
  await original.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '原冻结任务', exact: true })).toBeFocused()
  await page.goto(`/schedule/new?project=${fixture.projectId}&origin=real`)
  await page.getByLabel('分组名称').fill('中央新合同楼栋组')
  await page.getByRole('radio', { name: /合同清单/ }).check()
  await expect(page.getByRole('checkbox', { name: /合同待建二栋/ })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /合同待建二栋/ })).toBeChecked()
  await capture(page, info, 'contract-step1')
  await page.getByRole('button', { name: '下一步：选择工序' }).click()
  await choose(page, '标准工序库', new RegExp(fixture.libraryName))
  await page.getByLabel('计划开始', { exact: true }).fill('2026-09-12')
  await expect(page.getByRole('checkbox', { name: '启用原腻子工序' })).toBeChecked()
  await capture(page, info, 'contract-step2')
  await page.getByRole('button', { name: '下一步：预览排程' }).click()
  await capture(page, info, 'contract-step3')
  await page.setViewportSize({ width: 390, height: 960 })
  await page.getByRole('button', { name: '生成排程', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('contract-step3-lower-390.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '生成排程', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '生成排程', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule\?.*group=/)
  const created = (await fixture.read()).snapshot.groups.find(group => group.name === '中央新合同楼栋组')!
  expect(created).toMatchObject({ scopeBasis: 'contract', processLibraryVersion: 3 })
  expect(created.tasks[0]!.floorPlans[0]).toMatchObject({ sourceBasis: 'contract' })
  await page.getByRole('button', { name: '设置基准', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '设置基准', exact: true }).click()
  await expect.poll(async () => (await fixture.read()).snapshot.groups.find(group => group.id === created.id)?.tasks[0]?.baselineStart).toBe('2026-09-12')
  await page.getByRole('button', { name: '手工任务', exact: true }).click()
  const manual = page.getByRole('dialog', { name: '工序详情 · 手工任务' })
  await manual.getByLabel('人工进度百分比').fill('75')
  await manual.getByRole('button', { name: '保存调整' }).click()
  await expect(manual).not.toBeVisible()
  await expect.poll(async () => (await fixture.read()).snapshot.groups.flatMap(group => group.tasks).find(task => task.name === '手工任务')?.manualProgress).toBe(0.75)
  await page.getByRole('button', { name: '手工任务', exact: true }).click()
  await manual.getByLabel('计划完成', { exact: true }).fill('2026-09-06')
  await manual.getByRole('button', { name: '设置依赖' }).click()
  const dependency = page.getByRole('dialog', { name: '依赖设置 · 手工任务' })
  await choose(page, '前置工序', '原冻结任务')
  await dependency.getByLabel('Lag 天数').fill('0')
  await dependency.getByRole('button', { name: '保存依赖' }).click()
  await expect(manual).toBeVisible()
  // 轻量依赖往返不能覆盖还没提交的任务日期。
  await expect(manual.getByLabel('计划完成', { exact: true })).toHaveValue('2026-09-06')
  const keptDependencyId = (await fixture.read()).snapshot.dependencies[0]!.id
  await manual.getByRole('button', { name: '保存调整' }).click()
  await expect(manual).not.toBeVisible()
  expect((await fixture.read()).snapshot.dependencies[0]!.id).toBe(keptDependencyId)
  await page.getByRole('button', { name: '手工任务', exact: true }).click()
  await manual.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '原冻结任务', exact: true }).click()
  await original.getByLabel('计划完成', { exact: true }).fill('2026-09-06')
  await original.getByRole('button', { name: '保存调整' }).click()
  const conflict = page.getByRole('dialog', { name: /本次调期会冲突/ })
  await conflict.getByRole('button', { name: '取消', exact: true }).click()
  expect((await fixture.read()).snapshot.dependencies).toHaveLength(1)
  await expect(original.getByLabel('计划完成', { exact: true })).toHaveValue('2026-09-06')
  await original.getByRole('button', { name: '保存调整' }).click()
  await conflict.getByRole('button', { name: '调期并置灰冲突' }).click()
  await expect(original).not.toBeVisible()
  expect((await fixture.read()).snapshot.dependencies).toHaveLength(0)
  await page.getByRole('button', { name: '原冻结任务', exact: true }).click()
  await original.getByLabel('计划完成', { exact: true }).fill('2026-09-03')
  await original.getByLabel('开始', { exact: true }).fill('2026-09-01')
  await original.getByRole('button', { name: '保存调整' }).click()
  await expect(original).not.toBeVisible()
  expect((await fixture.read()).snapshot.groups.flatMap(group => group.tasks).find(task => task.name === '原冻结任务')?.floorPlans[0]).toMatchObject({ isManual: true, plannedStart: '2026-09-01' })
  await page.getByRole('button', { name: '手工任务', exact: true }).click()
  await manual.getByRole('button', { name: '设置依赖' }).click()
  await expect(dependency.getByText('已禁用的冲突关系')).toBeVisible()
  await capture(page, info, 'dependency-recovery')
  await dependency.getByRole('button', { name: '恢复关系' }).last().click()
  await expect.poll(async () => (await fixture.read()).snapshot.dependencies.length).toBe(1)
  await dependency.getByRole('button', { name: '移除依赖', exact: true }).click()
  await page.getByRole('dialog', { name: '移除当前前后置依赖？' }).getByRole('button', { name: '移除依赖', exact: true }).click()
  await expect(manual).toBeVisible()
  await manual.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '原腻子工序', exact: true }).click()
  await page.getByRole('dialog', { name: '工序详情 · 原腻子工序' }).getByRole('button', { name: '删除工序' }).click()
  await page.getByRole('dialog', { name: '删除工序「原腻子工序」？' }).getByRole('button', { name: '删除工序' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '向中央新合同楼栋组追加工序' }).click()
  await page.getByRole('dialog', { name: '向「中央新合同楼栋组」追加工序' }).getByRole('button', { name: '添加工序' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const readded = (await fixture.read()).snapshot.groups.find(group => group.id === created.id)!.tasks[0]!
  expect(readded.id).not.toBe(created.tasks[0]!.id)
  expect(readded.sourceLibraryTaskId).toBe(created.tasks[0]!.sourceLibraryTaskId)
  const handle = page.getByRole('button', { name: '调整工期：原冻结任务', exact: true })
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 45, box!.y + box!.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await fixture.read()).snapshot.groups.flatMap(group => group.tasks).find(task => task.name === '原冻结任务')!.plannedFinish > '2026-09-03').toBe(true)
  expect((await fixture.read()).snapshot.groups.flatMap(group => group.tasks).find(task => task.name === '原冻结任务')?.floorPlans[0]).toMatchObject({ isManual: true, plannedStart: '2026-09-01' })
  const usage = await (await page.request.get(`/api/read/process-libraries/${fixture.mapped('process_libraries', 'wbs-library')}`, { params: { origin: 'real' } })).json()
  expect(usage.usageCount).toBe(2)
  expect(usage.usageProjects).toContainEqual(expect.objectContaining({ id: fixture.projectId, groupCount: 2 }))
  await page.reload()
  await expect(page.getByRole('button', { name: '原腻子工序', exact: true })).toBeVisible()
  await capture(page, info, 'central-wbs')
  await page.goto(`${scheduleUrl}&boqLine=${encodeURIComponent(readded.boqLineIds[0]!)}`)
  await expect(page.getByRole('dialog', { name: '工序详情 · 原腻子工序' })).toContainText('合同待建二栋')
  await capture(page, info, 'boq-floor-source')
  await page.goto(`/schedule?project=${fixture.projectId}&origin=real&task=deleted-task`)
  await expect(page.getByText(/来源工序或清单分项已失效/).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('暂估冻结、未知提交恢复、自动进度及矩阵户详情同身份往返', async ({ page }, info) => {
  test.setTimeout(180_000)
  const fixture = await installQuantityProductionFixture(page)
  const quantityItems = (await fixture.read('templates')).data.items
  const masonryItem = quantityItems.find((item: { code: string }) => item.code === 'MASONRY')
  const recheckStage = await fixture.execute({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code: 'MASONRY-RECHECK', name: '泥水复验', trade: '泥水工', completionMode: 'unit', itemIds: [masonryItem.id], sortOrder: 2 } })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const library = await page.request.post('/api/commands/process-libraries', { data: {
    commandId: randomUUID(),
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    origin: 'real',
    requiredCapability: 'process-library:write',
    action: 'create-version',
    baseVersion: 0,
    sourceVersion: null,
    draft: { sourceLibraryId: null, code: 'SCHEDULE-UI', name: '中央暂估工序库', description: '真实命令验收样本', tasks: [
      { key: 'masonry', name: '泥水施工', trade: '泥水工', color: '#0f766e', durationDays: 4, stageCode: 'MASONRY-DONE', itemCodes: ['MASONRY'], predecessorKey: null, predecessorDisabled: false },
      { key: 'recheck', name: '泥水复验', trade: '泥水工', color: '#0f766e', durationDays: 2, stageCode: 'MASONRY-RECHECK', itemCodes: ['MASONRY'], predecessorKey: 'masonry', predecessorDisabled: false },
      { key: 'handoff', name: '现场交接', trade: '其他', color: '#64748b', durationDays: 2, stageCode: '', itemCodes: [], predecessorKey: 'masonry', predecessorDisabled: false },
    ] },
  } })
  expect(library.ok(), await library.text()).toBe(true)
  await page.goto(`/schedule/new?project=${fixture.projectId}&origin=real`)
  await page.getByLabel('分组名称').fill('保留输入的暂估楼栋组')
  await page.getByRole('radio', { name: /内部暂估/ }).check()
  await page.getByRole('link', { name: '配置楼栋、楼层与户' }).click()
  await expect(page.getByTestId('quantity-region-form')).toBeVisible()
  await page.getByRole('button', { name: '返回新建排程' }).click()
  await expect(page.getByLabel('分组名称')).toHaveValue('保留输入的暂估楼栋组')
  await page.getByRole('checkbox', { name: /1栋/ }).check()
  await page.getByRole('button', { name: '下一步：选择工序' }).click()
  await choose(page, '标准工序库', /中央暂估工序库/)
  await page.getByLabel('计划开始', { exact: true }).fill('2026-08-01')
  await page.getByRole('button', { name: '下一步：预览排程' }).click()
  const submissions: string[] = []
  await page.route('**/api/commands/schedule', async (route) => {
    submissions.push(route.request().postData()!)
    if (submissions.length === 1) {
      expect((await route.fetch()).ok()).toBe(true)
      await route.abort('failed')
    }
    else { await route.continue() }
  })
  await page.getByRole('button', { name: '生成排程', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '生成排程', exact: true }).click()
  await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
  await capture(page, info, 'pending-command')
  await page.getByRole('button', { name: '核对原提交', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule\?.*group=/)
  expect(submissions).toHaveLength(2)
  expect(submissions[1]).toBe(submissions[0])
  await page.unroute('**/api/commands/schedule')
  const read = async (): Promise<ScheduleRead> => (await page.request.get('/api/read/schedule/workspace', { params: { projectId: fixture.projectId, origin: 'real', includeDemo: false } })).json()
  const saved = await read()
  expect(saved.snapshot.groups).toHaveLength(1)
  const group = saved.snapshot.groups[0]!
  const task = group.tasks.find(row => row.name === '泥水施工')!
  expect(task.actualProgress).toBe(0.25)
  expect(group.tasks.find(row => row.name === '泥水复验')?.actualProgress).toBe(0)
  expect(task.floorPlans.every(plan => plan.quantitySnapshot?.completeness === 'complete')).toBe(true)
  await page.getByRole('button', { name: '泥水施工', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '查看工程量' }).click()
  await expect(page.getByTestId('quantity-matrix-cell').first()).toBeVisible()
  await page.getByRole('tab', { name: '班组矩阵' }).click()
  await expect(page).toHaveURL(/view=crew/)
  await choose(page, '班组/个人', /泥水A班/)
  await expect(page).not.toHaveURL(/assignee=all/)
  const matrix = new URL(page.url())
  expect(matrix.searchParams.get('task')).toBe(task.id)
  await page.getByRole('button', { name: /2层，201户/ }).press('Enter')
  await page.getByRole('button', { name: /详情/ }).first().click()
  await expect(page).toHaveURL(/\/subcontract\/quantity\/[^/?]+\/[^/?]+\?/)
  expect(new URL(page.url()).searchParams.get('group'), '详情进入保留来源').toBe(group.id)
  await page.reload()
  expect(new URL(page.url()).searchParams.get('group'), '详情冷读保留来源').toBe(group.id)
  await expect(page.getByRole('link', { name: '返回工程量矩阵' })).toHaveAttribute('href', new RegExp(`group=${group.id}`))
  await page.getByRole('link', { name: '返回工程量矩阵' }).click()
  await expect(page.getByRole('tab', { name: '班组矩阵' })).toHaveAttribute('data-state', 'active')
  for (const key of ['project', 'origin', 'group', 'task', 'stage', 'buildings', 'month', 'view', 'trade', 'assignee'])
    expect(new URL(page.url()).searchParams.get(key)).toBe(matrix.searchParams.get(key))
  await page.getByRole('link', { name: '返回该工序' }).click()
  await expect(page.getByRole('dialog', { name: '工序详情 · 泥水施工' })).toBeVisible()
  await capture(page, info, 'task-quantity-frozen')
  const complete = async (stageId: string, status: 'completed' | 'draft') => {
    const current = (await fixture.read('completion', { unitId: fixture.units['201']! })).data.stages.find((row: { id: string }) => row.id === stageId)
    const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='
    await fixture.execute({ kind: 'save-completion', draft: { projectId: fixture.projectId, unitId: fixture.units['201']!, stageId, status, completedAt: status === 'completed' ? '2026-08-02' : null, note: '真实完成更正验收', expectedCompletionId: current.completion?.id ?? null, expectedCompletionFingerprint: current.completion?.fingerprint ?? null, expectedAssignmentId: current.currentAssignment.id, photos: status === 'completed' ? [{ fileName: '验收.png', mimeType: 'image/png', fileSize: 68, contentBase64 }] : [] } })
  }
  await complete(recheckStage.id, 'completed')
  await complete(task.stageId!, 'draft')
  await page.reload()
  await expect(page.getByRole('dialog', { name: '工序详情 · 泥水施工' })).toContainText('实际进度 0%')
  const corrected = await read()
  expect(corrected.snapshot.groups[0]!.tasks.find(row => row.name === '泥水施工')?.actualProgress).toBe(0)
  expect(corrected.snapshot.groups[0]!.tasks.find(row => row.name === '泥水复验')?.actualProgress).toBe(0.25)
  const homeSourceQuery = new URLSearchParams(matrix.search)
  homeSourceQuery.set('from', 'home')
  await page.goto(`/schedule?${homeSourceQuery}`)
  await expect(page.getByText('施工进度只读查看')).toBeVisible()
  await expect(page.getByRole('button', { name: '设置基准', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '泥水施工', exact: true }).click()
  await expect(page).toHaveURL(/\/subcontract\/quantity\?/)
  await expect(page.getByTestId('quantity-matrix-cell').first()).toBeVisible()
  await expect(page.getByRole('link', { name: '返回首页该工序' })).toBeVisible()
  await page.getByRole('link', { name: '返回首页该工序' }).click()
  await expect(page).toHaveURL(new RegExp(`\\/\\?.*project=${fixture.projectId}`))
  await capture(page, info, 'home-central-readonly')
  const overviewLink = page.getByRole('link', { name: '打开施工进度' })
  const restoreKeys = ['project', 'origin', 'group', 'task', 'stage', 'item', 'buildings', 'month', 'view', 'trade', 'assignee']
  const href = new URL((await overviewLink.getAttribute('href'))!, page.url())
  for (const key of restoreKeys)
    expect(href.searchParams.get(key), `首页入口${key}`).toBe(matrix.searchParams.get(key))
  await overviewLink.click()
  await expect(page).toHaveURL(/\/schedule\?/)
  await expect(page.getByText('施工进度只读查看')).toBeVisible()
  await page.reload()
  await expect(page.getByText('施工进度只读查看')).toBeVisible()
  for (const key of restoreKeys)
    expect(new URL(page.url()).searchParams.get(key), `施工进度冷刷${key}`).toBe(matrix.searchParams.get(key))
  await capture(page, info, 'home-source-readonly')
  await page.getByRole('link', { name: '返回首页项目' }).click()
  await expect(page).toHaveURL(/\/\?/)
  await page.reload()
  await expect(page.getByRole('link', { name: '打开施工进度' })).toBeVisible()
  for (const key of restoreKeys)
    expect(new URL(page.url()).searchParams.get(key), `首页冷刷${key}`).toBe(matrix.searchParams.get(key))
})

test('缺区域整页补齐、逐栋阻塞及零与缺量按单位核对并保留工序草稿', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `schedule-region-${randomUUID()}` })
  const raw = await (await page.request.get('/api/read/business-session')).json()
  const session = { workspaceId: raw.workspaceId, actorId: raw.actorId }
  const projectResponse = await page.request.post('/api/commands/projects', { data: { ...session, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: '无区域暂估验收项目', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
  const { id: projectId } = await projectResponse.json()
  const read = async (kind: string) => (await page.request.get(`/api/read/quantity/${kind}`, { params: { projectId, origin: 'real', includeDemo: false } })).json()
  let version = (await read('region')).sourceVersion
  const execute = async (action: Record<string, unknown>) => {
    const response = await page.request.post('/api/commands/quantity', { data: { ...session, requiredCapability: 'quantity:write', commandId: randomUUID(), origin: 'real', projectId, baseVersion: version, action } })
    expect(response.ok(), await response.text()).toBe(true)
    const result = await response.json()
    version = result.sourceVersion
    return result
  }
  const draft = blankQuantityTemplateDraft(projectId)
  Object.assign(draft, { code: 'A', name: '含零与缺量户型' })
  draft.newItems = [{ key: 'area', code: 'AREA', name: '面积施工', section: '装饰', trade: '泥水工', unit: '㎡', sortOrder: 0 }, { key: 'length', code: 'LENGTH', name: '线性施工', section: '装饰', trade: '泥水工', unit: 'm', sortOrder: 1 }]
  draft.lines = draft.newItems.map((item, index) => ({ key: item.key, id: null, roomKey: draft.rooms[0]!.key, itemId: item.key, recognizedContractQty: null, contractQty: null, provisionalQty: index ? 0 : 8, fieldQty: null, fieldFormula: '', note: '', sortOrder: index }))
  draft.lines.push({ ...draft.lines[0]!, key: 'missing-area', roomKey: 'other-room', provisionalQty: null })
  draft.rooms.push({ key: 'other-room', id: null, code: 'OTHER', name: '待核对房间', kind: 'room', sortOrder: 1 })
  const template = await execute({ kind: 'save-template', draft })
  const item = (await read('templates')).data.items.find((row: { code: string }) => row.code === 'AREA')
  await execute({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code: 'AREA-DONE', name: '面积完成', trade: '泥水工', completionMode: 'unit', itemIds: [item.id], sortOrder: 0 } })
  const libraryResponse = await page.request.post('/api/commands/process-libraries', { data: { ...session, commandId: randomUUID(), requiredCapability: 'process-library:write', origin: 'real', baseVersion: 0, sourceVersion: null, action: 'create-version', draft: { sourceLibraryId: null, code: 'REGION-UI', name: '区域补齐工序库', description: '', tasks: [{ key: 'area', name: '面积施工', trade: '泥水工', color: '#0f766e', durationDays: 4, stageCode: 'AREA-DONE', itemCodes: ['AREA'], predecessorKey: null, predecessorDisabled: false }] } } })
  expect(libraryResponse.ok(), await libraryResponse.text()).toBe(true)
  await page.goto(`/schedule/new?project=${projectId}&origin=real`)
  await page.getByLabel('分组名称').fill('区域往返保留的分组')
  await page.getByRole('radio', { name: /内部暂估/ }).check()
  await expect(page.getByText(/当前项目尚未维护可用楼栋/)).toBeVisible()
  await capture(page, info, 'no-region')
  await page.getByRole('link', { name: '配置楼栋、楼层与户' }).click()
  const region = page.getByTestId('quantity-region-form')
  await region.getByLabel('楼栋编码', { exact: true }).fill('B1')
  await region.getByPlaceholder('如 1栋', { exact: true }).fill('完整范围一栋')
  await region.getByRole('button', { name: '新增楼栋', exact: true }).click()
  await expect(region.getByLabel('楼栋列表')).toContainText('完整范围一栋')
  await region.getByLabel('楼层编码', { exact: true }).fill('F1')
  await region.getByPlaceholder('如 1层', { exact: true }).fill('一层')
  await region.getByRole('button', { name: '新增楼层', exact: true }).click()
  await expect(region.getByLabel('楼层列表')).toContainText('一层')
  await region.getByLabel('户编码', { exact: true }).fill('101')
  await region.getByPlaceholder('如 101户', { exact: true }).fill('101户')
  await region.getByRole('combobox', { name: '户型模板', exact: true }).selectOption(template.id)
  await region.getByRole('button', { name: '新增户', exact: true }).click()
  await expect(region.getByLabel('户列表')).toContainText('101户')
  await region.getByLabel('楼栋编码', { exact: true }).fill('B2')
  await region.getByPlaceholder('如 1栋', { exact: true }).fill('缺楼层二栋')
  await region.getByRole('button', { name: '新增楼栋', exact: true }).click()
  await capture(page, info, 'region-configuration')
  await page.getByRole('button', { name: '返回新建排程' }).click()
  await expect(page.getByLabel('分组名称')).toHaveValue('区域往返保留的分组')
  await expect(page.getByText(/8 ㎡，缺 1 项.*0 m/)).toBeVisible()
  await expect(page.getByRole('button', { name: '下一步：选择工序' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /缺楼层二栋/ }).uncheck()
  await page.getByRole('button', { name: '下一步：选择工序' }).click()
  await choose(page, '标准工序库', /区域补齐工序库/)
  await page.getByLabel('面积施工默认工期').fill('7')
  await page.getByLabel('面积施工默认工期').blur()
  await page.getByRole('button', { name: '上一步', exact: true }).click()
  await page.getByRole('link', { name: '配置楼栋、楼层与户' }).click()
  await page.getByRole('button', { name: '返回新建排程' }).click()
  await page.getByRole('button', { name: '下一步：选择工序' }).click()
  await expect(page.getByLabel('面积施工默认工期')).toHaveValue('7')
  await page.getByRole('button', { name: '关闭 新建楼栋分组', exact: true }).click()
  await page.getByRole('dialog', { name: '放弃新建排程？' }).getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByLabel('面积施工默认工期')).toHaveValue('7')
  await page.getByRole('button', { name: '下一步：预览排程' }).click()
  await capture(page, info, 'provisional-zero-missing-preview')
  await page.getByRole('button', { name: '生成排程', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '生成排程', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule\?.*group=/)
  const saved = await (await page.request.get('/api/read/schedule/workspace', { params: { projectId, origin: 'real', includeDemo: false } })).json()
  expect(saved.snapshot.groups[0].tasks[0].floorPlans[0].quantitySnapshot).toMatchObject({ knownValue: 8, missingCount: 1, unit: '㎡' })
})
