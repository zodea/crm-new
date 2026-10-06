import type { BusinessSession } from '../../server/utils/business-session'
import type { TransactionDb } from '~/lib/db/coordinator'
import type { ProjectManagementFeeRead } from '~/lib/project/management-fee'
import { describe, expect, it, vi } from 'vitest'
import { isProjectManagementFeeRead, managementFeeSource, projectManagementFees } from '~/lib/project/management-fee'
import { loadProjectManagementFees, loadProjectPayrollEvidence } from '../../server/utils/project-management-fee'
import { createPayrollAFeeAdjustmentFixture } from '../helpers/payroll-a-fee-adjustment-fixture'

const asOf = '2026-10-04T12:00:00.000Z'
const session: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'project:list:read'] }
const check = (value: unknown) => isProjectManagementFeeRead(value, { projectId: 'p', dataOrigin: 'real', asOf })

describe('管理费只引用可证明的原实际成本', () => {
  it('p5真实普通工资1000排除，管理工资500与退款-80只计420，不加费用配置1500或未实付更正', async () => {
    const f = await createPayrollAFeeAdjustmentFixture()
    try {
      await f.db.execute('UPDATE house_type_template_items SET field_qty=CASE item_id WHEN \'wall\' THEN 400 WHEN \'floor\' THEN 200 ELSE field_qty END')
      const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
      await f.prices()
      const ordinary = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      await f.release(ordinary.statementId!, 1000)
      const managed = await (await f.management()).start()
      await f.release(managed.statementId!, 500)
      const first = await loadProjectPayrollEvidence(f.db, 'p', session, asOf)
      expect(first.payrollActual.netAmount.value).toBe(1500)
      expect(first.managementFees.actualCost).toMatchObject({ value: null, knownValue: '500.00', status: 'partial', participatingCount: null, missingCount: null })
      expect(first.managementFees.sources[0]).toMatchObject({ state: 'complete', missingCount: 0, actualCost: { value: '500.00', status: 'complete' } })
      expect(first.managementFees.sources[0]!.rows.map(row => row.originalStatementIds)).toEqual([[managed.statementId]])
      expect(JSON.stringify(first.managementFees)).not.toContain(ordinary.statementId!)
      expect(check(first.managementFees)).toBe(true)

      const correction = await f.correct(managed.statementId!, (basis) => {
        const wall = basis.fees!.components.find(component => component.quantity === 400)
        if (!wall)
          throw new Error('真实墙砖400的原费用依据缺失')
        wall.unitPrice = 2.25
      })
      expect(correction.adjustment.delta).toBe(-80)
      // A confirmed change is not an actual payment; use a real independent refund of the confirmed balance.
      expect((await loadProjectManagementFees(f.db, 'p', session, asOf)).actualCost.knownValue).toBe('500.00')
      await f.pay(correction.adjustment.id, -80)
      const refunded = await loadProjectPayrollEvidence(f.db, 'p', session, asOf)
      expect(refunded.payrollActual.netAmount.value).toBe(1420)
      expect(refunded.managementFees.sources[0]!.actualCost.value).toBe('420.00')
      expect(refunded.managementFees.actualCost).toMatchObject({ value: null, knownValue: '420.00', status: 'partial' })
      expect(refunded.managementFees.sources[0]!.rows).toHaveLength(2)
      expect(refunded.managementFees.sources[0]!.rows.find(row => row.ref.kind === 'actual-event')).toMatchObject({ ref: { kind: 'actual-event' }, originalStatementIds: [managed.statementId], amount: '-80.00' })
      expect(refunded.managementFees.sources[0]!.sourceVersion).not.toBe(first.managementFees.sources[0]!.sourceVersion)
      expect(check(refunded.managementFees)).toBe(true)
      // Reads preserve frozen documents, original journal receipts and source rows.
      expect((await f.service.aOutput({ origin: 'real' }, ordinary.statementId!)).document?.actualAmount).toBe(1000)
      expect((await f.service.aOutput({ origin: 'real' }, managed.statementId!)).document?.actualAmount).toBe(500)
    }
    finally { await f.close() }
  }, 30_000)

  it('完整独立管理簿空集合证明真实零，但其他来源未接时管理费总额仍未知；用途不明旧工资不能排成零', async () => {
    const f = await createPayrollAFeeAdjustmentFixture()
    try {
      const empty = await loadProjectManagementFees(f.db, 'p', session, asOf)
      expect(empty.sources[0]).toMatchObject({ state: 'complete', rows: [], actualCost: { value: '0.00', knownValue: '0.00', participatingCount: 0, missingCount: 0 } })
      expect(empty.actualCost).toMatchObject({ value: null, knownValue: '0.00', status: 'partial' })
      await f.db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,format_family,month,quantity_source,status,actual_amount) VALUES(\'unproved-old\',\'p\',\'crew\',\'w\',\'A\',\'2026-07\',\'field\',\'released\',200)')
      const unknown = await loadProjectManagementFees(f.db, 'p', session, asOf)
      expect(unknown.sources[0]).toMatchObject({ state: 'partial', rows: [], missingCount: 1, actualCost: { value: null, knownValue: '0.00' } })
      expect(unknown.sources[0]!.reasons.join(' ')).toContain('归属尚不能证明')
      expect(check(unknown)).toBe(true)
    }
    finally { await f.close() }
  }, 30_000)

  it('没有实际来源权限时不查询数据库，不能泄露原工资或管理簿稳定身份', async () => {
    const select = vi.fn(() => {
      throw new Error('不得查询')
    })
    const denied = await loadProjectManagementFees({ select } as unknown as TransactionDb, 'p', { ...session, capabilities: ['project:list:read'] }, asOf)
    expect(select).not.toHaveBeenCalled()
    expect(denied.sources[0]).toMatchObject({ state: 'forbidden', sourceVersion: null, asOf: null, rows: [], actualCost: { value: null, knownValue: null } })
    expect(check(denied)).toBe(true)
  })

  it('独立解码保护总额未知、正确小计、原身份去重和明确来源；不依赖服务实现重算预期', () => {
    const rows = [{ identity: 'real:payroll:released:original', ref: { kind: 'released-statement' as const, statementId: 'original' }, originalStatementIds: ['original'], managementBookId: 'book', amount: '100.00', knownValue: '100.00', occurredOn: '2026-10-01', sourceVersion: 'original-v1' }]
    const source = managementFeeSource({ key: 'management-payroll', state: 'complete', sourceVersion: 'p5-v1', asOf, reasons: [], missingCount: 0, rows }, asOf)
    const read = projectManagementFees('p', 'real', asOf, source)
    expect(read.actualCost.knownValue).toBe('100.00')
    expect(check(read)).toBe(true)
    const invalid: Array<(read: ProjectManagementFeeRead) => void> = [
      (read) => {
        read.actualCost.value = '100.00'
        read.actualCost.status = 'complete'
        read.actualCost.missingSources = []
      },
      (read) => { read.actualCost.knownValue = '200.00' },
      (read) => { read.sources[0]!.rows.push(structuredClone(read.sources[0]!.rows[0]!)) },
      (read) => { read.sources[0]!.rows[0]!.originalStatementIds = [] },
      (read) => { read.sources[0]!.sourceVersion = null },
      (read) => { read.sources[0]!.state = 'forbidden' },
      (read) => { read.projectId = 'another-project' },
      (read) => { read.dataOrigin = 'demo' },
    ]
    for (const mutate of invalid) {
      const copy = structuredClone(read)
      mutate(copy)
      expect(check(copy)).toBe(false)
    }
    expect(check({ ...read, sources: read.sources.map(source => Object.fromEntries(Object.entries(source).reverse())) })).toBe(true)
  })
})
