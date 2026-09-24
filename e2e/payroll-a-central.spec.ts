import type { Page, TestInfo } from '@playwright/test'
import type { CoreMigrationBatchDTO } from '../app/lib/migration/core-contract'
import type { PayrollAAction, PayrollACommandRead, PayrollADraft, PayrollAStatementCommandResult } from '../app/lib/payroll/central-a-contract'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createPayrollRepository } from '../app/lib/payroll/central-repository'

test.use({ actionTimeout: 15_000 })
function repository(page: Page) {
  return createPayrollRepository(async (path, options) => {
    const response = await page.request.fetch(path, { method: options?.method || 'GET', params: options?.query ? Object.fromEntries(Object.entries(options.query).map(([key, value]) => [key, String(value)])) : undefined, data: options?.body })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  })
}
async function command(page: Page, read: PayrollACommandRead, action: PayrollAAction) {
  return repository(page).execute({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'scope' in read ? read.scope.projectId : read.draft.projectId!, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
}
async function capture(page: Page, info: TestInfo, name: string, selector?: string, horizontal?: string) {
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15_000 })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    if (selector) {
      const target = page.locator(selector).first()
      await target.evaluate(node => node.scrollIntoView({ block: 'center' }))
      await expect(target).toBeInViewport()
    }
    if (horizontal) {
      const scroller = page.locator(horizontal).locator('.vxe-table--body-inner-wrapper').first()
      await scroller.evaluate(node => node.scrollLeft = node.scrollWidth - node.clientWidth)
      if (width < 1024)
        await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    const sourceCard = page.locator('#section-source:visible')
    if (await sourceCard.count()) {
      const sourceBounds = await sourceCard.evaluate((card) => {
        const bounds = card.getBoundingClientRect()
        const elements = [...card.querySelectorAll<HTMLElement>(':scope > [data-ui="section-header"], :scope > [data-ui="section-header"] span, [data-payroll-source-description], [data-payroll-source-summary], [data-payroll-source-summary] *')]
        return elements.map((element) => {
          const rect = element.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(element)
          const textInside = [...range.getClientRects()].every(text => text.left >= bounds.left - 1 && text.right <= bounds.right + 1)
          return { text: element.textContent, withinCard: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, noClipping: element.scrollWidth <= element.clientWidth + 1, textInside }
        })
      })
      expect(sourceBounds.every(row => row.withinCard && row.noClipping && row.textInside), JSON.stringify(sourceBounds)).toBe(true)
      if (width === 390) {
        const descriptionWraps = await sourceCard.locator('[data-payroll-source-description]').evaluate(element => element.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(element).lineHeight))
        expect(descriptionWraps).toBe(true)
      }
    }
    if (new URL(page.url()).pathname === '/subcontract/payroll/config') {
      const controlsInside = await page.locator('#section-prices input, #section-prices select').evaluateAll(elements => elements.every((element) => {
        const card = element.closest('[aria-label="待保存工资单价"]')?.getBoundingClientRect()
        const rect = element.getBoundingClientRect()
        return !card || (rect.left >= card.left && rect.right <= card.right)
      }))
      expect(controlsInside).toBe(true)
    }
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
}
async function fixture(page: Page, info: TestInfo) {
  const runId = randomUUID()
  const output = info.outputPath('payroll-a-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/payroll-a-migration-source.ts'), output, runId])
  const prepared = JSON.parse(await readFile(output, 'utf8'))
  const { source, snapshotSha256, byteLength } = prepared
  const session = await (await page.request.get('/api/read/business-session')).json()
  const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: randomUUID(), requiredCapability: 'core:migration:write' })
  const preflight = await page.request.post('/api/migrations/core/preflight', { data: { ...envelope(), source, backup: null } })
  expect(preflight.ok(), await preflight.text()).toBe(true)
  const dry = await page.request.post('/api/migrations/core/dry-run', { data: { ...envelope(), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: new Date().toISOString(), immutable: true } } })
  expect(dry.ok(), await dry.text()).toBe(true)
  const batch: CoreMigrationBatchDTO = await dry.json()
  await writeFile(info.outputPath('migration-batch.json'), JSON.stringify(batch, null, 2))
  for (const action of ['import', 'confirm']) {
    const response = await page.request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(), batchId: batch.batchId } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const mapped = (entityType: string, legacyId: string) => {
    const rows = batch.mappings.filter(row => row.entityType === entityType && row.legacyId === legacyId)
    expect(rows, legacyId).toHaveLength(1)
    expect(rows[0]!.serverId).toBeTruthy()
    return rows[0]!.serverId!
  }
  const quantity = mapped('quantity_projects', 'pa-project')
  const result = { runId, project: mapped('projects', 'pa-project'), crew: mapped('crews', 'pa-crew-current'), worker: mapped('workers', 'pa-worker-other'), oldWorker: mapped('workers', 'pa-worker-old'), multiWorker: mapped('workers', 'pa-worker-multi'), multiUnitTwo: `${quantity}:units:pa-unit-multi-two`, zero: mapped('workers', 'pa-worker-zero'), item: `${quantity}:items:pa-item`, unit: `${quantity}:units:pa-unit-other`, building: `${quantity}:buildings:pa-building`, batchId: batch.batchId, sourceHash: source.sourceHash, snapshotSha256, byteLength }
  await writeFile(info.outputPath('payroll-a-identities.json'), JSON.stringify(result, null, 2))
  return result
}
async function openDraft(page: Page, scope: { project: string, crew: string, worker: string, zero: string }, month = '2026-08') {
  await page.goto(`/subcontract/payroll/new?${new URLSearchParams({ origin: 'real', draftKey: randomUUID(), project: scope.project, month, crew: scope.crew })}`)
  await expect(page.getByRole('heading', { name: '新建 A 工资草稿', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('combobox', { name: '请款负责人', exact: true }).selectOption(scope.worker)
  await expect(page.getByRole('combobox', { name: '请款负责人', exact: true })).toBeEnabled()
  await page.getByRole('checkbox', { name: '零收款成员', exact: true }).check()
  await page.getByRole('button', { name: '核对完成量与单价', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '请款负责人', exact: true })).toBeEnabled()
}
async function saveDraft(page: Page) {
  const received = page.waitForResponse(response => response.url().endsWith('/api/commands/payroll-a') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存工资草稿', exact: true }).click()
  const response = await received
  expect(response.ok(), await response.text()).toBe(true)
  const result: PayrollAStatementCommandResult = await response.json()
  await expect(page).toHaveURL(new RegExp(`/subcontract/payroll/${result.statementId}\\?`))
  await expect(page.getByRole('region', { name: 'A工资处理', exact: true })).toBeVisible()
  return result.statementId
}

test('A工资真实迁入、配置保稿、实际核对发放、跨月重核与冻结输出完整旅程', async ({ page }, info) => {
  test.setTimeout(480_000)
  const f = await fixture(page, info)
  const repo = repository(page)
  const query = { origin: 'real' as const }
  await test.step('纯工程量项目首张工资可进入，历史台账为空也不隐藏入口', async () => {
    expect((await repo.list(query)).rows).toHaveLength(0)
    const quantity = `/subcontract/quantity?${new URLSearchParams({ origin: 'real', project: f.project, building: f.building, month: '2026-08', view: 'crew', trade: '油漆工', assignee: `worker:${f.worker}` })}`
    await page.goto(quantity)
    const entry = page.getByRole('link', { name: '按实际完成量新建 A 工资', exact: true })
    await expect(entry).toBeVisible({ timeout: 30_000 })
    await capture(page, info, 'first-payroll-from-quantity')
    await entry.click()
    await expect(page.getByRole('heading', { name: '新建 A 工资草稿', exact: true })).toBeVisible()
    const back = new URL(new URL(page.url()).searchParams.get('returnTo')!, 'https://test.invalid')
    expect(back.searchParams.get('assignee')).toBe(`worker:${f.worker}`)
    expect(back.searchParams.get('view')).toBe('crew')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    const expectedQuantity = new URL(quantity, 'https://test.invalid')
    await expect(page).toHaveURL(url => url.pathname === expectedQuantity.pathname && JSON.stringify([...url.searchParams].sort()) === JSON.stringify([...expectedQuantity.searchParams].sort()))
  })
  await test.step('旧责任8/null/0保持缺口，来源与另一主体分开', async () => {
    await openDraft(page, { ...f, worker: f.oldWorker })
    await expect(page.getByRole('region', { name: '工资来源缺口', exact: true })).toContainText(/现场量|未知|缺/)
    const invalid = await repo.aForm(query, { statementId: null, draftKey: randomUUID(), draft: { projectId: f.project, month: '2026-08', crewId: f.crew, leaderWorkerId: f.oldWorker, memberWorkerIds: [f.oldWorker], payRatio: 0.8 } })
    expect(invalid.facts.map(row => row.fieldQty).sort()).toEqual([0, 8, null].sort())
    expect(invalid.eligibility.canCheck).toBe(false)
    await capture(page, info, 'quantity-missing-zero', '[aria-label="工资来源缺口"]')
    await capture(page, info, 'original-quantity-sources', '[aria-label="A工资完成来源核对"] .vxe-table', '[aria-label="A工资完成来源核对"]')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
  })
  await test.step('同分项两户跨层聚合，第二来源往返精确回到第二完成记录', async () => {
    await openDraft(page, { ...f, worker: f.multiWorker })
    const source = page.getByRole('region', { name: 'A工资完成来源核对', exact: true }).getByRole('link', { name: /查看来源/ }).filter({ hasText: '查看来源' })
    await expect(source).toHaveCount(2)
    const targets = await source.evaluateAll(elements => elements.map(element => element.getAttribute('href')))
    const secondIndex = targets.findIndex(href => href && decodeURIComponent(new URL(href, 'https://test.invalid').pathname) === `/subcontract/quantity/${f.project}/${f.multiUnitTwo}`)
    expect(secondIndex).toBeGreaterThanOrEqual(0)
    const second = source.nth(secondIndex)
    const completion = await second.getAttribute('data-source-focus')
    expect(completion).toBeTruthy()
    const key = new URL(page.url()).searchParams.get('draftKey')
    await second.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(url => decodeURIComponent(url.pathname) === `/subcontract/quantity/${f.project}/${f.multiUnitTwo}`)
    await expect(page.locator('[data-payroll-stage]:focus')).toHaveCount(1)
    await page.getByRole('link', { name: '返回原工资', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('draftKey')).toBe(key)
    await expect.poll(() => new URL(page.url()).searchParams.get('focus')).toBe(completion)
    await expect(page.locator(`[data-source-focus="${completion}"]:focus`)).toHaveCount(1)
    await capture(page, info, 'second-floor-source-focus', '[aria-label="A工资完成来源核对"] .vxe-table', '[aria-label="A工资完成来源核对"]')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
  })
  await test.step('新建健康A、配置两区、返回仍保原备注和明确采纳', async () => {
    await openDraft(page, f)
    await page.getByRole('textbox', { name: '工资备注', exact: true }).fill('配置往返保留备注')
    await capture(page, info, 'draft-before-config')
    const draftPath = page.url()
    await page.getByRole('link', { name: '工资配置', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'A 工资配置', exact: true })).toBeVisible()
    await page.getByRole('spinbutton', { name: '首月支付比例', exact: true }).fill('80')
    await page.getByRole('button', { name: '保存首月比例', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存首月比例', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '新增工资单价', exact: true }).click()
    await page.getByRole('combobox', { name: '单价分项及单位', exact: true }).selectOption({ label: '腻子 · ㎡' })
    await page.getByRole('spinbutton', { name: '工资单价金额', exact: true }).fill('100')
    await capture(page, info, 'subject-price-configuration', '[aria-label="待保存工资单价"]')
    await page.getByRole('button', { name: '保存工资单价', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存工资单价', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '返回原工资', exact: true }).last().click()
    await expect(page).toHaveURL(draftPath)
    await expect(page.getByRole('textbox', { name: '工资备注', exact: true })).toHaveValue('配置往返保留备注')
    await page.getByRole('button', { name: '核对完成量与单价', exact: true }).click()
    await expect(page.getByRole('spinbutton', { name: '本次支付比例', exact: true })).toHaveValue('80')
    await capture(page, info, 'draft-config-return', '[aria-label="A工资完成来源核对"]')
  })
  await test.step('新稿完成户、工程量、人员和班组返回仍为原draftKey，备注与行焦点保留', async () => {
    const key = new URL(page.url()).searchParams.get('draftKey')
    await page.getByRole('region', { name: 'A工资完成来源核对', exact: true }).getByRole('link', { name: '查看来源 1', exact: true }).first().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: '工资原来源返回', exact: true })).toContainText('返回后保留原输入')
    await expect(page.locator('[data-payroll-stage]:focus')).toHaveCount(1)
    await capture(page, info, 'quantity-unit-source-return', '[aria-label="工资原来源返回"]')
    await page.getByRole('link', { name: '查看工程量管理', exact: true }).click()
    await expect(page.getByRole('link', { name: '返回原工资', exact: true })).toBeVisible()
    await capture(page, info, 'quantity-matrix-source-return', '[aria-label="工资原来源返回"]')
    await page.getByRole('link', { name: '返回原工资', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('draftKey')).toBe(key)
    await expect(page.getByRole('textbox', { name: '工资备注', exact: true })).toHaveValue('配置往返保留备注')
    await expect(page.locator('[data-source-focus]:focus')).toHaveCount(1)
    const people = page.locator('[aria-label="工资人员与班组来源"]')
    await people.getByRole('link', { name: '独立另一主体', exact: true }).click()
    await expect(page.getByRole('link', { name: '返回原工资', exact: true })).toBeVisible()
    await capture(page, info, 'worker-source-return', '[aria-label="工资原来源返回"]')
    await page.getByRole('link', { name: '返回原工资', exact: true }).click()
    await people.getByRole('link', { name: '查看请款班组', exact: true }).click()
    await expect(page.getByRole('link', { name: '返回原工资', exact: true })).toBeVisible()
    await capture(page, info, 'crew-source-return', '[aria-label="工资原来源返回"]')
    await page.getByRole('link', { name: '返回原工资', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('draftKey')).toBe(key)
    await expect(page.getByRole('textbox', { name: '工资备注', exact: true })).toHaveValue('配置往返保留备注')
    await page.getByRole('button', { name: '核对完成量与单价', exact: true }).click()
  })
  const august = await saveDraft(page)
  await page.getByRole('button', { name: '重新核对工资', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认实际发放', exact: true })).toBeEnabled()
  const augustRead = await repo.aForm(query, { statementId: august })
  expect(augustRead.totals.grossAmount.value).toBe(320)
  let september = ''
  await test.step('另一月份先核对，第一笔少发只记真实300，原回执丢失可恢复', async () => {
    const draft: PayrollADraft = { projectId: f.project, month: '2026-09', periodKind: 'settlement', crewId: f.crew, leaderWorkerId: f.worker, memberWorkerIds: [f.worker, f.zero], payRatio: 0.95, note: '先核对的结算单' }
    const preview = await repo.aForm(query, { statementId: null, draftKey: randomUUID(), draft })
    const result = await command(page, preview, { kind: 'save-a-draft', draft })
    expect(result.statementId).toBeTruthy()
    september = result.statementId!
    await command(page, await repo.aForm(query, { statementId: september }), { kind: 'check-a' })
    await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('spinbutton', { name: '零收款成员收款金额', exact: true })).toHaveValue('0')
    await dialog.getByRole('spinbutton', { name: '实际发放总额', exact: true }).fill('300')
    await dialog.getByRole('spinbutton', { name: '独立另一主体收款金额', exact: true }).fill('299.99')
    await expect(dialog.getByRole('button', { name: '确认实际发放', exact: true })).toBeDisabled()
    await capture(page, info, 'release-cent-mismatch', '[role="dialog"]')
    await dialog.getByRole('spinbutton', { name: '独立另一主体收款金额', exact: true }).fill('300')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
    await expect(dialog.getByRole('spinbutton', { name: '实际发放总额', exact: true })).toHaveValue('300')
    const staleResponse = page.waitForResponse(response => response.url().endsWith('/api/commands/payroll-a') && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: '确认实际发放', exact: true }).click()
    expect((await staleResponse).status()).toBe(409)
    await expect(dialog.getByRole('alert')).toContainText('来源或此前实付已变化')
    await expect(dialog.getByRole('spinbutton', { name: '实际发放总额', exact: true })).toHaveValue('300')
    await capture(page, info, 'stale-release-retained', '[role="dialog"]')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '重新读取资料', exact: true }).click()
    await expect(page.getByRole('button', { name: '确认实际发放', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
    await expect(dialog.getByRole('spinbutton', { name: '实际发放总额', exact: true })).toHaveValue('300')
    let original = ''
    await page.route('**/api/commands/payroll-a', async (route) => {
      if (!original && route.request().postDataJSON()?.action?.kind === 'release-a') {
        original = route.request().postDataJSON().commandId
        const committed = await route.fetch()
        expect(committed.ok(), await committed.text()).toBe(true)
        await route.abort('failed')
      }
      else {
        await route.continue()
      }
    })
    await dialog.getByRole('button', { name: '确认实际发放', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '核对原提交', exact: true })).toBeVisible()
    await capture(page, info, 'unknown-release-retained', '[role="dialog"]')
    const replay = page.waitForRequest(request => request.url().endsWith('/api/commands/payroll-a') && request.postDataJSON()?.commandId === original)
    await dialog.getByRole('button', { name: '核对原提交', exact: true }).click()
    await replay
    await page.unroute('**/api/commands/payroll-a')
    await expect(page.getByRole('button', { name: '打印冻结工资表', exact: true })).toBeVisible()
  })
  await test.step('冷读及真实xlsx/打印只用冻结金额与全成员', async () => {
    await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
    await page.reload()
    await expect(page.getByRole('button', { name: '打印冻结工资表', exact: true })).toBeVisible()
    const detail = await repo.detail(query, august)
    expect(detail.statement.snapshot.state).toBe('complete')
    expect(detail.statement.snapshot.issues).toEqual([])
    const frozen = await repo.aOutput(query, august)
    expect(frozen.state).toBe('available')
    if (frozen.state !== 'available')
      throw new Error('新A完整冻结输出应可用')
    expect(frozen.document.actualAmount).toBe(300)
    expect(frozen.document.allocations.map(row => row.amount)).toEqual([300, 0])
    await capture(page, info, 'released-frozen-output', '[aria-label="冻结工资输出"]')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载冻结工资表', exact: true }).click()
    const file = await download
    const output = info.outputPath(file.suggestedFilename())
    await file.saveAs(output)
    const book = XLSX.read(await readFile(output))
    expect(XLSX.utils.sheet_to_json(book.Sheets.发放汇总!)).toEqual([expect.objectContaining({ 本次实际发放: 300, 本次核算应发: 320 })])
    expect(XLSX.utils.sheet_to_json(book.Sheets.组内分配!)).toEqual([expect.objectContaining({ 实际收款金额: 300 }), expect.objectContaining({ 实际收款金额: 0 })])
    await page.getByRole('button', { name: '打印冻结工资表', exact: true }).click()
    await page.emulateMedia({ media: 'print' })
    const print = page.locator('[data-payroll-print-page]')
    await expect(print).toBeVisible()
    await expect(print).toContainText('本次实际发放¥300.00')
    await expect(print.locator('footer')).toContainText('班组长：')
    const pdf = await page.pdf({ path: info.outputPath('frozen-a-payroll.pdf'), printBackground: true, preferCSSPageSize: true })
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const printed = await getDocument({ data: new Uint8Array(pdf) }).promise
    const texts: string[] = []
    for (let index = 1; index <= printed.numPages; index++) {
      const content = await (await printed.getPage(index)).getTextContent()
      texts.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join(''))
    }
    const printedText = texts.join('').normalize('NFKC').replace(/\s+/g, '')
    for (const label of ['工资表', '本次实际发放', '300.00', '零收款成员', '0.00', '签字确认并按手印', '施工员'])
      expect(printedText).toContain(label)
    await writeFile(info.outputPath('print-validation.json'), JSON.stringify({ pageCount: printed.numPages, texts, checked: ['title', 'actual-300', 'zero-member', 'signature'] }, null, 2))
    await printed.destroy()
    await page.emulateMedia({ media: 'screen' })
    await writeFile(info.outputPath('frozen-document.json'), JSON.stringify(frozen.document, null, 2))
  })
  await test.step('第二已核对单实发时持久需重核，重核保75元并按此前实付300计算', async () => {
    await page.goto(`/subcontract/payroll/${september}?origin=real`)
    await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('spinbutton', { name: '实际发放总额', exact: true }).fill('75')
    await dialog.getByRole('spinbutton', { name: '独立另一主体收款金额', exact: true }).fill('75')
    await dialog.getByRole('button', { name: '确认实际发放', exact: true }).click()
    await expect(page.getByText('本工资已保存为需重新核对，暂不能确认实发。', { exact: true })).toBeVisible()
    expect((await repo.aForm(query, { statementId: september })).needsRecheck).toBe(true)
    await capture(page, info, 'second-statement-needs-recheck', '[aria-label="A工资处理"]')
    await page.getByRole('button', { name: '重新核对工资', exact: true }).click()
    await page.getByRole('button', { name: '确认实际发放', exact: true }).click()
    await expect(dialog.getByRole('spinbutton', { name: '实际发放总额', exact: true })).toHaveValue('75')
    await capture(page, info, 'rechecked-allocation-retained', '[role="dialog"]')
    await dialog.getByRole('button', { name: '确认实际发放', exact: true }).click()
    await expect(page.getByRole('button', { name: '打印冻结工资表', exact: true })).toBeVisible()
    const frozen = await repo.aOutput(query, september)
    expect(frozen.state).toBe('available')
    if (frozen.state === 'available') {
      expect(frozen.document.previouslyPaid).toBe(300)
      expect(frozen.document.grossAmount).toBe(80)
      expect(frozen.document.actualAmount).toBe(75)
    }
  })
  await writeFile(info.outputPath('verification.json'), JSON.stringify({ ...f, august, september, resets: 0, snapshotGeneratedFromRealCommands: true, actualXlsxParsed: true, printPdfGenerated: true, widths: [390, 768, 1024, 1280, 1440] }, null, 2))
})
