import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { payrollAdjustmentWorkspace } from './helpers/payroll-adjustment-workspace'

test('跨月退款范围金额、个人未知说明与完整详情往返', async ({ page }, info) => {
  test.setTimeout(240000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const f = await payrollAdjustmentWorkspace(page, info)
  const septemberId = await f.checked('2026-09')
  await f.repository.executeC2(f.c2Command(await f.repository.c2Form(f.query, { statementId: septemberId }), { kind: 'release-c2', release: { actualAmount: 1000, allocations: [{ workerId: f.workerId, amount: 1000 }, { workerId: f.zeroId, amount: 0 }] } }))
  async function correct(statementId: string, unitRate: number) {
    const target = { adjustmentId: null, draftKey: randomUUID(), originalStatementId: statementId }
    const original = await f.repository.adjustmentForm(f.query, { target })
    if (original.draft.basis?.formatFamily !== 'C2')
      throw new Error('必须读取原 C2 依据')
    const draft = { ...original.draft, reason: '跨月实额核对单价', evidenceNote: '按各原工资核对，不改原签收', basis: { ...original.draft.basis, unitRate } }
    const read = await f.repository.adjustmentForm(f.query, { target, draft })
    const saved = await f.repository.executeAdjustment({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, sourceVersion: read.context.sourceVersion, origin: 'real', requiredCapability: 'payroll:write', projectId: f.projectId, target, action: { kind: 'save-adjustment-draft', draft } })
    const confirmed = await f.repository.adjustmentForm(f.query, { target: { adjustmentId: saved.adjustmentId! } })
    await f.repository.executeAdjustment({ commandId: randomUUID(), workspaceId: confirmed.context.workspaceId, actorId: confirmed.context.actorId, sourceVersion: confirmed.context.sourceVersion, origin: 'real', requiredCapability: 'payroll:write', projectId: f.projectId, target: confirmed.target, action: { kind: 'confirm-adjustment' } })
    return saved.adjustmentId!
  }
  const augustAdjustment = await correct(f.statementId, 900)
  const septemberAdjustment = await correct(septemberId, 800)
  const target = { kind: 'actual-payment' as const, draftKey: randomUUID(), adjustmentIds: [augustAdjustment, septemberAdjustment] }
  const original = await f.repository.actualPaymentForm(f.query, { target })
  const payment = { kind: 'refund' as const, occurredOn: '2026-09-05', amount: -150, evidenceNote: '八月退40，九月退110；两人共退150，未登记各月个人分配矩阵', allocations: [{ workerId: f.workerId, amount: -50 }, { workerId: f.zeroId, amount: -100 }], applications: original.balances.map(balance => ({ adjustmentId: balance.adjustmentId, balanceVersion: balance.balanceVersion, amount: balance.adjustmentId === augustAdjustment ? -40 : -110 })) }
  const read = await f.repository.actualPaymentForm(f.query, { target, draft: payment })
  await f.repository.executeAdjustment({ commandId: randomUUID(), workspaceId: read.context.workspaceId, actorId: read.context.actorId, sourceVersion: read.context.sourceVersion, origin: 'real', requiredCapability: 'payroll:write', projectId: f.projectId, target, action: { kind: 'confirm-actual-payment', payment } })
  const scopedPath = `/subcontract/payroll/payments?${new URLSearchParams({ origin: 'real', project: f.projectId, statementId: f.statementId })}`
  await page.goto(scopedPath)
  const section = page.getByRole('region', { name: '工资实际收付', exact: true })
  await expect(section).toContainText('960.00', { timeout: 60000 })
  await expect(section).toContainText('按原工资范围计入')
  await expect(section).toContainText('各原工资的个人分配未完整记录')
  const refund = section.getByRole('row').filter({ hasText: '实际退款' })
  await expect(refund).toContainText('-40.00')
  await expect(refund).not.toContainText('-150.00')
  await expect(refund.getByRole('link', { name: '核实错记冲销' })).toHaveCount(0)
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const scroll = page.getByLabel('工资实际收付明细表', { exact: true })
    if (width === 390) {
      await scroll.focus()
      await expect(scroll).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => scroll.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    }
  }
  await page.reload()
  await expect(section).toContainText('960.00')
  await section.getByRole('link', { name: '实际退款', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工资实际退款详情', exact: true })).toBeVisible()
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: '实际退款' })).toContainText('-150.00')
  await expect(page.getByRole('link', { name: '核实错记冲销', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回来源', exact: true }).click()
  await expect(section).toContainText('960.00')
  await page.goto(`/subcontract/payroll/payments?${new URLSearchParams({ origin: 'real', project: f.projectId })}`)
  await expect(section).toContainText('1,850.00')
  expect(errors).toEqual([])
})
