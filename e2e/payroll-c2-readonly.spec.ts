import type { Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { payrollC2Repository, payrollC2Workspace, preparePayrollC2Fixture } from './helpers/payroll-c2-workspace'

test.use({ actionTimeout: 15000 })
async function capture(page: Page, name: string, selector?: string) {
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    if (selector)
      await page.locator(selector).scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), { message: `${name} @ ${width}px` }).toBe(true)
  }
}

test('旧 C2 缺原快照保留原金额与资料，禁止伪完整工资及签工输出', async ({ page }, info) => {
  await preparePayrollC2Fixture(page, info)
  const repository = payrollC2Repository(page)
  const list = await repository.list({ origin: 'real' })
  const legacy = list.rows.find(row => row.legacyId === 'c2-history-missing')
  expect(legacy, '需要本用例真实迁入的旧缺损头').toBeTruthy()
  expect(legacy!.snapshot.state).toBe('missing')
  expect(legacy!.actualAmount).toBeNull()
  const before = await repository.detail({ origin: 'real' }, legacy!.id)
  expect(before.statement.stored.head.actual_amount).toBe(100)
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/commands/'))
      writes.push(request.url())
  })
  await page.goto(`/subcontract/payroll/${legacy!.id}?origin=real&format=C2&month=2026-07`)
  await expect(page.getByRole('region', { name: '发放快照证据', exact: true })).toContainText('原资料未保留发放原文。')
  const workspace = page.getByRole('region', { name: 'C2工资核对与发放', exact: true })
  await expect(workspace).toContainText('原记录标为已发放，本页只读；逐日来源或发放证据不完整，不能生成配对输出。')
  await expect(workspace).not.toContainText('本次工资与签工已冻结')
  await expect(workspace).not.toContainText('请选择负责人')
  await expect(page.getByRole('region', { name: '工资金额与状态', exact: true })).not.toContainText('100.00')
  await expect(page.getByRole('button', { name: '确认实际发放', exact: true }).and(page.locator(':enabled'))).toHaveCount(0)
  await expect(page.getByRole('button', { name: '下载工资与签工表', exact: true })).toHaveCount(0)
  await capture(page, 'legacy-c2-missing-snapshot', '[aria-label="发放快照证据"]')
  await page.getByText('查看原表与关系历史', { exact: true }).click()
  await expect(page.locator('dl[aria-label="原工资头业务记录"]')).toContainText('100.00')
  await capture(page, 'legacy-c2-original-amount', '[aria-label="原工资头业务记录"]')
  const output = await repository.c2Output({ origin: 'real' }, legacy!.id)
  expect(output.state).toBe('unavailable')
  expect(await repository.detail({ origin: 'real' }, legacy!.id)).toEqual(before)
  expect(writes).toEqual([])
  await writeFile(info.outputPath('legacy-readonly.json'), JSON.stringify({ id: legacy!.id, originalActual: 100, verifiedActual: null, snapshot: legacy!.snapshot.state, outputState: output.state, writes }, null, 2))
})

test('C2 来源拒权不能沿旧读保存，重读后仍保原项目及草稿编号', async ({ page }, info) => {
  const { project, leader } = await payrollC2Workspace(page, '2026-09', info)
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/commands/'))
      writes.push(request.url())
  })
  await page.route('**/api/read/payroll/c2-form', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ data: { code: 'forbidden', message: '验收：当前身份没有 C2 工资读取权限', retryable: false, fieldErrors: {}, traceId: null } }) }))
  await page.goto(`/subcontract/payroll/new?${new URLSearchParams({ format: 'C2', origin: 'real', project: project.id, month: '2026-09', crew: leader.crewId || '', draftKey: 'c2-denied-original-draft' })}`)
  await expect(page.getByText('验收：当前身份没有 C2 工资读取权限', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存工资草稿', exact: true }).and(page.locator(':enabled'))).toHaveCount(0)
  await capture(page, 'c2-denied-read-retains-scope')
  expect(new URL(page.url()).searchParams.get('project')).toBe(project.id)
  expect(new URL(page.url()).searchParams.get('draftKey')).toBe('c2-denied-original-draft')
  await page.unroute('**/api/read/payroll/c2-form')
  await page.getByRole('button', { name: '重新读取', exact: true }).first().click()
  await expect(page.getByRole('combobox', { name: '工资项目', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存工资草稿', exact: true })).toBeDisabled()
  expect(writes).toEqual([])
})

test('显式演示 C2 新稿及签工新稿保持不可写，不切到正式来源', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/commands/'))
      writes.push(request.url())
  })
  await page.goto('/subcontract/payroll/new?origin=demo&format=C2&month=2026-09')
  await expect(page.getByText('请选择正式工资来源，从台账进入有效的 C2 工资草稿。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存工资草稿', exact: true }).and(page.locator(':enabled'))).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('origin')).toBe('demo')
  await capture(page, 'c2-demo-write-unavailable')
  await page.goto('/subcontract/daywork/new?origin=demo&month=2026-09')
  await expect(page.getByText('请从正式签工台账打开有效记录。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存并确认', exact: true }).and(page.locator(':enabled'))).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('origin')).toBe('demo')
  await capture(page, 'daywork-demo-write-unavailable')
  expect(writes).toEqual([])
})
