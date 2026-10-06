import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { TargetCostDetailRead, TargetCostFormRead } from '../app/lib/target-cost/central-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { decodeTargetCostRead, encodeTargetCostWire } from '../app/lib/target-cost/central-codec'
import { createVerifiedSignatory, verifiedSignatoryAdoption } from './helpers/contract-signatory'

test.use({ actionTimeout: 15_000 })
async function capture(page: Page, info: TestInfo, name: string, focus?: string) {
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    if (focus) {
      const target = page.locator(focus).first()
      await target.evaluate(node => node.scrollIntoView({ block: 'center' }))
      await expect(target).toBeInViewport()
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const dialog of await page.locator('[role="dialog"]:visible').all())
      await expect(dialog).toHaveCSS('opacity', '1')
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
}
async function fixture(page: Page, info: TestInfo) {
  if (process.env.TARGET_COST_RESUME_IDENTITIES) {
    const previous = JSON.parse(await readFile(process.env.TARGET_COST_RESUME_IDENTITIES, 'utf8'))
    const current = await readDetail(page, previous.a)
    const other = await readDetail(page, previous.b)
    expect(current.view.header.projectId).toBe(previous.projectId)
    expect(current.view.header.name).toBe(`原当前预算 ${previous.runId}`)
    expect(other.view.header.projectId).toBe(previous.projectId)
    expect(current.view.items).toHaveLength(8)
    const session = await (await page.request.get('/api/read/business-session')).json()
    expect(session.workspaceId).toBe(previous.session.workspaceId)
    expect(session.actorId).toBe(previous.session.actorId)
    await writeFile(info.outputPath('budget-identities.json'), JSON.stringify({ ...previous, resumedFrom: process.env.TARGET_COST_RESUME_IDENTITIES }))
    return { ...previous, session }
  }
  const runId = randomUUID()
  const output = info.outputPath('budget-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/target-cost-migration-source.ts'), output, runId])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(output, 'utf8'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const reset = await page.request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  for (const action of ['import', 'confirm']) {
    const response = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const mapped = (type: string, legacyId: string) => {
    const result = batch.mappings.find(row => row.entityType === type && row.legacyId === legacyId)?.serverId
    expect(result, `${type}/${legacyId}必须真实迁入`).toBeTruthy()
    return result!
  }
  const value = { runId, session, projectId: mapped('projects', 'budget-project'), supplierId: mapped('suppliers', 'budget-supplier'), a: mapped('target_cost_versions', 'budget-a'), b: mapped('target_cost_versions', 'budget-b') }
  await writeFile(info.outputPath('budget-identities.json'), JSON.stringify({ ...value, batchId: batch.batchId, sourceHash: source.sourceHash, snapshotSha256, byteLength }))
  return value
}
async function readDetail(page: Page, id: string) {
  const response = await page.request.get(`/api/read/target-costs/${encodeURIComponent(id)}`, { params: { origin: 'real' } })
  expect(response.ok(), await response.text()).toBe(true)
  return decodeTargetCostRead<TargetCostDetailRead>(await response.json(), 'detail', { origin: 'real' }, id)
}
async function updateHeader(page: Page, id: string, note: string) {
  const response = await page.request.get('/api/read/target-costs/form', { params: { id, origin: 'real' } })
  expect(response.ok(), await response.text()).toBe(true)
  const read = decodeTargetCostRead<TargetCostFormRead>(await response.json(), 'form', { origin: 'real' }, id)
  const { workspaceId, actorId, origin, sourceVersion } = read.context
  const command = { workspaceId, actorId, origin, sourceVersion, commandId: randomUUID(), requiredCapability: 'target-cost:write', targetCostId: id, action: { kind: 'save-header', draft: { ...read.draft, note }, saveAction: 'save' } }
  const saved = await page.request.post('/api/commands/target-costs', { data: encodeTargetCostWire(command) })
  expect(saved.ok(), await saved.text()).toBe(true)
}

test('预算真实迁入、版本头与科目整份保存、原件、固定版本及来源往返', async ({ page }, info) => {
  test.setTimeout(600_000)
  const f = await fixture(page, info)
  const list = `/project/target-cost?origin=real&search=${encodeURIComponent(f.runId)}&status=submitted&pageSize=20&sort=name-asc`
  const detail = `/project/target-cost/${encodeURIComponent(f.a)}?origin=real&returnTo=${encodeURIComponent(list)}`
  await page.goto(detail)
  if (!process.env.TARGET_COST_RESUME_IDENTITIES) {
    await expect(page.getByRole('heading', { name: `原当前预算 ${f.runId}`, exact: true })).toBeVisible()
    await expect(page.getByText('未填写分项名称（历史记录）')).toBeVisible()
    await capture(page, info, 'migrated-null-and-zero')
    await page.getByText('查看版本来源与操作历史', { exact: false }).click()
    await expect(page.getByText('历史经办人', { exact: false })).toBeVisible()
    await capture(page, info, 'history-and-missing-original', '[aria-label="预算版本历史"]')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '原预算.pdf', exact: true }).click()
    const originalDownload = await download
    const originalPath = await originalDownload.path()
    expect(originalPath).toBeTruthy()
    expect(await readFile(originalPath!)).toEqual(Buffer.from('%PDF-1.7'))

    await test.step('空项目草稿补齐版本头、独立真零与真实附件', async () => {
      await page.goto(`/project/target-cost/form/${encodeURIComponent(f.b)}?origin=real`)
      await expect(page.locator('input[data-field="name"]')).toBeEditable()
      await expect(page.locator('input[data-field="contractRevenue"]')).toHaveValue('')
      await expect(page.locator('input[data-field="plannedProfit"]')).toHaveValue('0')
      await capture(page, info, 'empty-project-draft')
      await page.locator('input[data-field="name"]').fill(`新预算 ${f.runId}`)
      await page.getByRole('combobox', { name: '检索项目', exact: true }).fill(`预算验收工程 ${f.runId}`)
      await page.getByRole('option', { name: new RegExp(`预算验收工程 ${f.runId}`) }).click()
      await page.locator('input[data-field="contractRevenue"]').fill('0')
      await page.locator('input[data-field="taxInclusiveTotal"]').fill('2500')
      await page.getByLabel('选择预算附件').setInputFiles({ name: '本次预算原件.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-budget-new') })
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page).toHaveURL(/\/project\/target-cost\?origin=real/)
      const saved = await readDetail(page, f.b)
      expect(saved.view.header).toMatchObject({ projectId: f.projectId, contractRevenue: 0, taxInclusiveTotal: 2500, status: 'draft' })
      expect(saved.files).toContainEqual(expect.objectContaining({ fileName: '本次预算原件.pdf', payloadState: 'available' }))
    })

    await test.step('七科目新增、删除、顺序及空值整份保存，版本头不变', async () => {
      await page.goto(detail)
      await page.getByRole('button', { name: '编辑科目明细', exact: true }).click()
      await page.getByRole('button', { name: '保存科目明细', exact: true }).click()
      await expect(page.getByRole('textbox', { name: '分项名称，第 1 行', exact: true })).toBeFocused()
      await page.getByRole('textbox', { name: '分项名称，第 1 行', exact: true }).fill('保留历史空量')
      const categories = ['专业分包', '合同劳务', '材料', '机械', '工人工资', '费用报销', '其他']
      for (const [index, category] of categories.entries()) {
        await page.getByRole('button', { name: '添加行', exact: true }).click()
        const row = index + 2
        await page.getByRole('combobox', { name: `成本科目，第 ${row} 行`, exact: true }).selectOption(category)
        await page.getByRole('textbox', { name: `分项名称，第 ${row} 行`, exact: true }).fill(`${category} 人工预算`)
        await page.getByRole('spinbutton', { name: `目标金额，第 ${row} 行`, exact: true }).fill(String(index * 100))
      }
      await page.getByRole('button', { name: '第 8 行上移', exact: true }).click()
      await page.getByLabel('选择第 1 行', { exact: true }).check()
      await page.getByRole('button', { name: '复制选中', exact: true }).click()
      await page.getByLabel('选择第 2 行', { exact: true }).check()
      await page.getByRole('button', { name: '删除选中', exact: true }).click()
      await capture(page, info, 'seven-category-edit', '[data-ui="kit-edit-grid"]')
      await page.getByRole('button', { name: '保存科目明细', exact: true }).click()
      await expect(page.getByRole('button', { name: '编辑科目明细', exact: true })).toBeVisible()
      const saved = await readDetail(page, f.a)
      expect(saved.view.items.map(item => item.category)).toEqual(expect.arrayContaining(categories))
      expect(saved.view.header.status).toBe('submitted')
      await page.reload()
      await expect(page.getByText('材料 人工预算', { exact: true })).toBeVisible()
    })
  }

  await test.step('旁路写导致旧版本冲突，当前稿保留；明确放弃后载入最新', async () => {
    const workingDetail = `/project/target-cost/${encodeURIComponent(f.b)}?origin=real`
    await page.goto(`/project/target-cost/form/${encodeURIComponent(f.b)}?origin=real&returnTo=${encodeURIComponent(workingDetail)}`)
    await page.locator('input[data-field="name"]').fill(`当前保留稿 ${f.runId}`)
    await updateHeader(page, f.b, '另一个合法经办窗口更正')
    const rejected = page.waitForResponse(response => response.url().endsWith('/api/commands/target-costs') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const rejection = await rejected
    const originalCommand = rejection.request().postDataJSON()
    expect(rejection.status()).toBe(409)
    expect(originalCommand).toMatchObject({ targetCostId: f.b, action: { draft: { name: `当前保留稿 ${f.runId}` } } })
    expect(await rejection.json()).toMatchObject({ data: { code: 'stale-source', commandId: originalCommand.commandId, commandOutcome: 'not-applied' } })
    await expect(page.getByText(/来源.*变化|版本.*变化|资料.*变化/).first()).toBeVisible()
    await expect(page.locator('input[data-field="name"]')).toHaveValue(`当前保留稿 ${f.runId}`)
    await expect(page.getByRole('status', { name: '目标成本原提交待核对', exact: true })).toHaveCount(0)
    await capture(page, info, 'stale-header-retained')
    await page.getByRole('button', { name: '重新核对资料', exact: true }).click()
    await expect(page.getByRole('button', { name: '放弃修改并载入最新', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '放弃修改并载入最新', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改并载入', exact: true }).click()
    await expect(page.locator('input[data-field="name"]')).toHaveValue(`新预算 ${f.runId}`)
  })

  await test.step('真实已应用丢回执，原键恢复只提交一次', async () => {
    let intercepted: unknown = null
    let originalKey = ''
    await page.route('**/api/commands/target-costs', async (route) => {
      if (intercepted)
        return route.continue()
      intercepted = route.request().postDataJSON()
      originalKey = (intercepted as { commandId: string }).commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('failed')
    })
    await page.getByLabel('预算备注').fill('原键恢复验证')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交', exact: true })).toBeEnabled()
    await capture(page, info, 'unknown-header-retained')
    await page.unroute('**/api/commands/target-costs')
    const response = page.waitForResponse(response => response.url().endsWith('/api/commands/target-costs') && response.request().postDataJSON().commandId === originalKey)
    await page.getByRole('button', { name: '核对原提交', exact: true }).click()
    expect((await response).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: `新预算 ${f.runId}`, exact: true })).toBeVisible()
    expect((await readDetail(page, f.b)).view.header.note).toBe('原键恢复验证')
  })

  await test.step('真实合同来源与项目往返保同一预算版本及列表筛选', async () => {
    const existingResponse = await page.request.get('/api/read/subcontract-contracts', { params: { origin: 'real', projectId: f.projectId, search: `预算实际来源 ${f.runId}` } })
    expect(existingResponse.ok(), await existingResponse.text()).toBe(true)
    const existing = await existingResponse.json()
    if (!existing.items.length) {
      const ownId = await createVerifiedSignatory(page, `目标成本已核实签约主体 ${f.runId}`)
      const adoption = await verifiedSignatoryAdoption(page, ownId)
      const response = await page.request.post('/api/commands/subcontract-contracts', { data: { workspaceId: f.session.workspaceId, actorId: f.session.actorId, requiredCapability: 'subcontract-contract:write', commandId: randomUUID(), baseVersion: null, action: 'submit', attachments: {}, draft: { ...adoption, name: `预算实际来源 ${f.runId}`, projectId: f.projectId, supplierId: f.supplierId, subKind: '专业', content: '已定施工范围', signDate: '2026-09-01', amount: 1000 } } })
      expect(response.ok(), await response.text()).toBe(true)
    }
    await page.goto(detail)
    await page.getByRole('tab', { name: /成本对比/ }).click()
    await capture(page, info, 'actual-source-completeness')
    await page.locator('a[href^="/contract/subcontract?"]').filter({ hasText: '查看正式合同' }).first().click()
    await expect(page.getByRole('link', { name: `预算实际来源 ${f.runId}`, exact: true })).toBeVisible()
    await capture(page, info, 'source-return')
    await page.getByRole('link', { name: `返回预算版本 · 原当前预算 ${f.runId}`, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/project/target-cost/${encodeURIComponent(f.a)}`))
    await page.getByRole('button', { name: '查看项目', exact: true }).click()
    await page.getByRole('link', { name: '返回预算版本', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/project/target-cost/${encodeURIComponent(f.a)}`))
    await page.getByRole('button', { name: '返回目标成本列表', exact: true }).click()
    await expect(page.getByPlaceholder('搜索版本名或项目')).toHaveValue(f.runId)
    await expect(page).toHaveURL(/pageSize=20/)
    await capture(page, info, 'filtered-version-list')
  })

  await test.step('A/B真实页签保独立科目草稿，取消关闭保留输入和焦点', async () => {
    await page.goto(detail)
    await page.getByRole('button', { name: '编辑科目明细', exact: true }).click()
    await page.getByRole('textbox', { name: '分项名称，第 1 行', exact: true }).fill('A页签未保存草稿')
    await page.getByRole('link', { name: '目标成本', exact: true }).click()
    await page.getByPlaceholder('搜索版本名或项目').fill(`新预算 ${f.runId}`)
    await page.getByRole('link', { name: `新预算 ${f.runId}`, exact: true }).click()
    await page.getByRole('button', { name: '编辑科目明细', exact: true }).click()
    await page.getByRole('button', { name: '添加行', exact: true }).click()
    await page.getByRole('textbox', { name: '分项名称，第 1 行', exact: true }).fill('B页签未保存草稿')
    const tabs = page.getByRole('navigation', { name: '已打开页面', exact: true })
    await tabs.getByRole('button', { name: `原当前预算 ${f.runId}`, exact: true }).click()
    await expect(page.getByRole('textbox', { name: '分项名称，第 1 行', exact: true })).toHaveValue('A页签未保存草稿')
    await capture(page, info, 'parallel-version-drafts', '[data-ui="kit-edit-grid"]')
    await tabs.getByRole('button', { name: `关闭 原当前预算 ${f.runId}`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '分项名称，第 1 行', exact: true })).toHaveValue('A页签未保存草稿')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
    await tabs.getByRole('button', { name: `新预算 ${f.runId}`, exact: true }).click()
    await expect(page.getByRole('textbox', { name: '分项名称，第 1 行', exact: true })).toHaveValue('B页签未保存草稿')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
  })

  await test.step('基线原子切换，删除取消与恢复不覆盖另一版本', async () => {
    await page.getByRole('button', { name: '编辑版本', exact: true }).click()
    for (const field of ['contractRevenue', 'plannedProfit', 'signedContractSum', 'taxInclusiveTotal', 'taxExclusiveTotal', 'taxAmount'])
      await page.locator(`input[data-field="${field}"]`).fill(field === 'taxInclusiveTotal' ? '2500' : '0')
    await expect(page.getByLabel('预算税价勾稽提示')).toContainText('2,500.00')
    await page.getByLabel('设为当前对比基线').check()
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect(page.getByRole('heading', { name: `新预算 ${f.runId}`, exact: true })).toBeVisible()
    expect((await readDetail(page, f.a)).view.header.isBaseline).toBe(false)
    expect((await readDetail(page, f.b)).view.header).toMatchObject({ isBaseline: true, status: 'submitted' })
    await capture(page, info, 'current-baseline')
    await page.getByRole('button', { name: '返回目标成本列表', exact: true }).click()
    await page.getByPlaceholder('搜索版本名或项目').fill(`新预算 ${f.runId}`)
    const action = async (name: '删除' | '恢复') => {
      await page.getByRole('button', { name: `新预算 ${f.runId}目标成本操作`, exact: true }).click()
      await page.getByRole('menuitem', { name, exact: true }).click()
    }
    await action('删除')
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    expect((await readDetail(page, f.b)).deletedAt).toBeNull()
    await action('删除')
    await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
    await page.getByLabel('查看已删除版本').check()
    await expect(page.getByRole('link', { name: `新预算 ${f.runId}`, exact: true })).toBeVisible()
    await action('恢复')
    await page.getByRole('dialog').getByRole('button', { name: '恢复', exact: true }).click()
    await page.getByLabel('查看已删除版本').uncheck()
    await expect(page.getByRole('link', { name: `新预算 ${f.runId}`, exact: true })).toBeVisible()
    expect((await readDetail(page, f.b)).deletedAt).toBeNull()
    expect((await readDetail(page, f.a)).view.header.isBaseline).toBe(false)
    await capture(page, info, 'restored-baseline-list')
  })
})
