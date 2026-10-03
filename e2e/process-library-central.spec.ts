import type { Page } from '@playwright/test'
import type { ProcessLibraryCreateCommand, ProcessLibraryVersion } from '../app/lib/schedule/process-library-contract'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

const widths = [390, 768, 1024, 1280, 1440]
const MIGRATION_INPUT = { backupCreatedAt: '2026-09-15T00:00:00.000Z', expectedUsageCount: 0, expectedUsageLabel: '尚未引用 · 仍以新版本方式调整' }
const CALLER_INPUT = { libraryCode: 'JOURNEY-443', libraryName: '往返标准库', taskName: '交接检查', duration: '3', editedDuration: '13', groupName: '往返后保留的楼栋组', description: '从建组调用页维护的新版本' }
test.afterEach(async ({ request }) => {
  const reset = await request.post('/api/testing/process-libraries/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': 'default' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const core = await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(core.ok(), await core.text()).toBe(true)
})
async function evidence(page: Page, info: import('@playwright/test').TestInfo, state: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
    await page.screenshot({ path: info.outputPath(`${state}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
}

test('真实 SQLite 迁入、从任意旧版保存下一版、冷刷新与冲突人工核对', async ({ page, request }, info) => {
  test.setTimeout(300_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const reset = await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const destination = info.outputPath('process-library-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/process-library-migration-source.ts'), destination])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(destination, 'utf8'))
  const session = await (await request.get('/api/read/business-session')).json()
  const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId, requiredCapability: 'core:migration:write' })
  const preflight = await request.post('/api/migrations/core/preflight', { data: { ...envelope('process-http-preflight'), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await request.post('/api/migrations/core/dry-run', { data: { ...envelope('process-http-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: MIGRATION_INPUT.backupCreatedAt, immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch = await dry.json()
  expect(batch.issues.filter((issue: { entityType: string, metricKey: string }) => issue.entityType === 'process_libraries' && issue.metricKey === 'apply-failed')).toEqual([])
  for (const action of ['import', 'import', 'confirm', 'confirm']) {
    const response = await request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(`process-http-${action}`), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const catalog = await (await request.get('/api/read/process-libraries?origin=real')).json()
  expect(catalog.seriesVersions['HTTP-443']).toBe(2)
  const legacy = catalog.libraries.find((row: { code: string }) => row.code === 'HTTP-443')
  const oldPath = `/api/read/process-libraries/${legacy.id}?origin=real`
  const original: ProcessLibraryVersion = await (await request.get(oldPath)).json()
  expect(original).toMatchObject({ version: 1, usageCount: MIGRATION_INPUT.expectedUsageCount, legacyId: 'http-library-443-v1', sortOrder: -10 })
  expect(original.tasks[1]).toMatchObject({ predecessorKey: 'task-0', stageCode: 'GLOBAL-STAGE-1', itemCodes: ['GLOBAL-ITEM'] })

  await page.goto('/schedule/process-library?origin=real')
  await expect(page.getByRole('heading', { name: '标准工序库', exact: true }).last()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(MIGRATION_INPUT.expectedUsageLabel, { exact: true }).first()).toBeVisible()
  await evidence(page, info, '01-library-list')
  const group = page.locator('section').filter({ has: page.getByRole('heading', { name: '装饰施工标准工序', exact: true }) })
  await group.getByRole('link', { name: '查看版本' }).click()
  await expect(page.getByRole('heading', { name: '装饰施工标准工序 · v1', exact: true })).toBeVisible()
  await evidence(page, info, '02-immutable-old-version')
  await page.getByRole('link', { name: '基于此版本新建', exact: true }).click()
  await expect(page.getByRole('heading', { name: '基于旧版新建版本', exact: true })).toBeVisible()
  await expect(page.getByLabel('工序库编码 *')).toBeDisabled()
  await expect(page.getByRole('grid', { name: '标准工序模板甘特' })).toBeVisible()
  await evidence(page, info, '03-full-page-version-form')
  await page.getByRole('button', { name: '上移基层施工', exact: true }).click()
  const reorder = page.getByRole('dialog', { name: /本次调整会冲突/ })
  await expect(reorder).toBeVisible()
  await evidence(page, info, '04-reorder-conflict')
  await expect(reorder.getByText('现场交接（task-0）')).toBeVisible()
  await expect(reorder.getByText('基层施工（task-1）')).toBeVisible()
  await reorder.getByRole('button', { name: '取消调整', exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: '设置基层施工前置工序' })).not.toContainText('已置灰')
  await page.getByRole('button', { name: '上移基层施工', exact: true }).click()
  await reorder.getByRole('button', { name: '调整并置灰冲突', exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: '设置基层施工前置工序' })).toContainText('已置灰')
  await page.getByLabel('现场交接默认工期').fill('9')
  await page.getByLabel('版本说明').fill('第一次人工稿：保留前置键并置灰')

  let submitted: ProcessLibraryCreateCommand | undefined
  let lost = false
  await page.route('**/api/commands/process-libraries', async (route) => {
    if (!lost) {
      submitted = route.request().postDataJSON()
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      lost = true
      await route.abort('failed')
    }
    else {
      expect(route.request().postDataJSON().commandId).toBe(submitted?.commandId)
      await route.continue()
    }
  })
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('版本说明')).toHaveValue('第一次人工稿：保留前置键并置灰')
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByRole('heading', { name: '装饰施工标准工序 · v3', exact: true })).toBeVisible()
  await page.unroute('**/api/commands/process-libraries')
  await page.reload()
  await expect(page.getByRole('heading', { name: '装饰施工标准工序 · v3', exact: true })).toBeVisible()
  await expect(page.getByText('已置灰保留')).toBeVisible()
  await evidence(page, info, '05-saved-version-cold-refresh')
  expect(await (await request.get(oldPath)).json()).toEqual(original)
  const afterRetry = await (await request.get('/api/read/process-libraries?origin=real')).json()
  expect(afterRetry.libraries.filter((row: { code: string }) => row.code === 'HTTP-443').map((row: { version: number }) => row.version).sort()).toEqual([1, 3])

  await page.goto(`/schedule/process-library/form?source=${encodeURIComponent(original.id)}&origin=real`)
  await expect(page.getByLabel('现场交接默认工期')).toHaveValue('2')
  await page.getByLabel('版本说明').fill('并发之后仍保留的人工稿')
  const concurrent: ProcessLibraryCreateCommand = {
    action: 'create-version',
    commandId: 'process-http-concurrent',
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    origin: 'real',
    requiredCapability: 'process-library:write',
    baseVersion: 3,
    sourceVersion: original.sourceVersion,
    draft: { sourceLibraryId: original.id, code: original.code, name: original.name, description: '另一位操作者先保存', tasks: original.tasks.map(({ key, name, trade, color, durationDays, stageCode, itemCodes, predecessorKey, predecessorDisabled }) => ({ key, name, trade, color, durationDays, stageCode: stageCode ?? '', itemCodes, predecessorKey, predecessorDisabled })) },
  }
  const concurrentResponse = await request.post('/api/commands/process-libraries', { data: concurrent })
  expect(concurrentResponse.ok(), await concurrentResponse.text()).toBe(true)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByText('同编码已有新版本。人工稿已保留，请先核对再保存。')).toBeVisible()
  await expect(page.getByRole('button', { name: '保存为新版本', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重新核对当前版本系列', exact: true }).click()
  const review = page.getByRole('dialog', { name: '重新核对当前版本系列', exact: true })
  await expect(review).toBeVisible()
  await evidence(page, info, '06-version-conflict-review')
  await review.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: '保存为新版本', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重新核对当前版本系列', exact: true }).click()
  await review.getByRole('button', { name: '重新核对并保留人工稿', exact: true }).press('Enter')
  await expect(page.getByLabel('版本说明')).toHaveValue('并发之后仍保留的人工稿')
  await expect(page.getByRole('button', { name: '保存为新版本', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByRole('heading', { name: '装饰施工标准工序 · v5', exact: true })).toBeVisible()
  expect(await (await request.get(oldPath)).json()).toEqual(original)
  const rejectedActor = await request.post('/api/commands/process-libraries', { data: { ...concurrent, commandId: 'actor-forged', actorId: 'forged', baseVersion: 5 } })
  expect(rejectedActor.status()).toBe(403)
  const rejectedDemo = await request.post('/api/commands/process-libraries', { data: { ...concurrent, commandId: 'demo-write', origin: 'demo' } })
  expect(rejectedDemo.status()).toBe(403)
  const rollback = await request.post(`/api/migrations/core/${batch.batchId}/rollback`, { data: { ...envelope('process-http-rollback'), batchId: batch.batchId } })
  expect(rollback.status()).toBe(409)
  expect(await (await request.get(oldPath)).json()).toEqual(original)
  expect(pageErrors).toEqual([])
})

test('已有建组入口往返中央工序库后保留调用页步骤和人工工期', async ({ page }, info) => {
  test.setTimeout(150_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const fixture = await installQuantityProductionFixture(page)
  await page.goto('/schedule/process-library/form?origin=real')
  await expect(page.getByLabel('工序库编码 *')).toBeEnabled({ timeout: 30_000 })
  await page.getByLabel('工序库编码 *').fill(CALLER_INPUT.libraryCode)
  await page.getByLabel('工序库名称 *').fill(CALLER_INPUT.libraryName)
  await page.getByLabel('新工序 1名称').fill(CALLER_INPUT.taskName)
  await page.getByLabel(`${CALLER_INPUT.taskName}默认工期`).fill(CALLER_INPUT.duration)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${CALLER_INPUT.libraryName} · v1`, exact: true })).toBeVisible()
  await page.goto(`/schedule/new?project=${fixture.projectId}&origin=real`)
  await expect(page.getByRole('heading', { name: '楼栋分组与标准工序', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: /内部暂估/ }).check()
  await expect(page.getByRole('button', { name: '下一步：选择工序', exact: true })).toBeEnabled()
  await page.getByLabel('分组名称', { exact: true }).fill(CALLER_INPUT.groupName)
  await page.getByRole('button', { name: '下一步：选择工序', exact: true }).click()
  await page.getByRole('combobox', { name: '标准工序库', exact: true }).click()
  await page.getByRole('option', { name: `${CALLER_INPUT.libraryName} · v1 · 1 道`, exact: true }).click()
  await expect(page.getByLabel(`${CALLER_INPUT.taskName}默认工期`)).toHaveValue(CALLER_INPUT.duration)
  await page.getByLabel(`${CALLER_INPUT.taskName}默认工期`).fill(CALLER_INPUT.editedDuration)
  await evidence(page, info, '07-caller-draft-before')
  await page.getByRole('link', { name: '维护标准工序库 →', exact: true }).click()
  await expect(page.getByRole('link', { name: '返回新建楼栋分组', exact: true })).toBeVisible()
  const group = page.locator('section').filter({ has: page.getByRole('heading', { name: CALLER_INPUT.libraryName, exact: true }) })
  await group.getByRole('link', { name: '基于此版本新建', exact: true }).click()
  await expect(page.getByLabel(`${CALLER_INPUT.taskName}默认工期`)).toHaveValue(CALLER_INPUT.duration)
  await page.getByLabel('版本说明').fill(CALLER_INPUT.description)
  const tabs = page.getByRole('navigation', { name: '已打开页面' })
  await tabs.getByRole('button', { name: '新建楼栋分组', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '放弃修改', exact: true })).toHaveCount(0)
  await expect(page.getByLabel(`${CALLER_INPUT.taskName}默认工期`)).toHaveValue(CALLER_INPUT.editedDuration)
  await tabs.getByRole('button', { name: '标准工序库表单', exact: true }).click()
  await expect(page.getByLabel('版本说明')).toHaveValue(CALLER_INPUT.description)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${CALLER_INPUT.libraryName} · v2`, exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回新建楼栋分组', exact: true }).click()
  await expect(page.locator('[data-schedule-wizard-step="2"]')).toBeVisible()
  await expect(page.getByLabel(`${CALLER_INPUT.taskName}默认工期`)).toHaveValue(CALLER_INPUT.editedDuration)
  await expect(page.getByRole('combobox', { name: '标准工序库', exact: true })).toContainText('v1')
  await page.getByRole('combobox', { name: '标准工序库', exact: true }).click()
  await expect(page.getByRole('option', { name: `${CALLER_INPUT.libraryName} · v2 · 1 道`, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await evidence(page, info, '08-caller-draft-returned')
  await page.getByRole('button', { name: '上一步', exact: true }).click()
  await expect(page.getByLabel('分组名称', { exact: true })).toHaveValue(CALLER_INPUT.groupName)
  expect(pageErrors).toEqual([])
})

test('同源列表往返刷新保留表格横滚，网络失败后重试恢复写入', async ({ page, request }, info) => {
  test.setTimeout(120_000)
  const session = await (await request.get('/api/read/business-session')).json()
  const created = await request.post('/api/commands/process-libraries', {
    data: {
      action: 'create-version',
      commandId: 'scroll-443',
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      origin: 'real',
      requiredCapability: 'process-library:write',
      baseVersion: 0,
      sourceVersion: null,
      draft: { sourceLibraryId: null, code: 'SCROLL-443', name: '滚动保留标准库', description: '同源刷新保留最后成功的列表', tasks: [{ key: 'handoff', name: '交接检查', durationDays: 3, trade: '', color: '#64748b', stageCode: '', itemCodes: [], predecessorKey: null }] },
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/schedule/process-library?origin=real')
  const group = page.locator('section').filter({ has: page.getByRole('heading', { name: '滚动保留标准库', exact: true }) })
  const table = group.locator('[data-ui="kit-table"]')
  await expect(table).toBeVisible()
  const retainedTable = await table.elementHandle()
  const scroll = table.locator('.vxe-table--scroll-x-handle').first()
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await scroll.evaluate(element => element.scrollLeft = element.scrollWidth)
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(100)
  const scrollLeft = await scroll.evaluate(element => element.scrollLeft)
  await group.getByRole('link', { name: '查看版本', exact: true }).click()
  await expect(page.getByRole('heading', { name: '滚动保留标准库 · v1', exact: true })).toBeVisible()
  let releaseRead!: () => void
  let readStarted!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  const started = new Promise<void>((resolve) => {
    readStarted = resolve
  })
  await page.route('**/api/read/process-libraries?origin=real', async (route) => {
    readStarted()
    await gate
    await route.abort('failed')
  })
  await page.getByRole('navigation', { name: '已打开页面' }).getByRole('button', { name: '标准工序库', exact: true }).first().click()
  await started
  try {
    await expect(table).toBeVisible()
    expect(await table.evaluate((element, original) => element === original, retainedTable)).toBe(true)
    expect(await scroll.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
    await expect(page.getByRole('link', { name: '基于此版本新建', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('09-same-origin-refresh-pending-390.png'), animations: 'disabled' })
  }
  finally {
    releaseRead()
  }
  await expect(page.getByRole('button', { name: '重试刷新', exact: true })).toBeVisible()
  await expect(table).toBeVisible()
  expect(await scroll.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
  await expect(page.getByRole('link', { name: '基于此版本新建', exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('10-same-origin-refresh-failed-390.png'), animations: 'disabled' })
  await page.unroute('**/api/read/process-libraries?origin=real')
  await page.getByRole('button', { name: '重试刷新', exact: true }).click()
  await expect(page.getByRole('link', { name: '基于此版本新建', exact: true })).toBeVisible()
  expect(await table.evaluate((element, original) => element === original, retainedTable)).toBe(true)
  expect(await scroll.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
  await page.screenshot({ path: info.outputPath('11-same-origin-refresh-recovered-390.png'), animations: 'disabled' })
})
