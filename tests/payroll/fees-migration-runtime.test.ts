import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '../../app/lib/payroll/central-adjustment-contract'
import { afterEach, expect, it } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { hasPayrollAFeesDocument, hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { PAYROLL_A_FEES_MIGRATION_COLUMNS, PAYROLL_A_FEES_MIGRATION_TABLES, payrollAFeesPrimaryKey } from '../../app/lib/payroll/central-a-fees-schema'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollFeesMigrationReferences } from '../../server/utils/payroll-fees-migration-references'
import { loadPayrollMigratedFees } from '../../server/utils/payroll-migrated-fees'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollFeesMigrationFixture } from '../helpers/payroll-fees-migration-fixture'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

it('同人同月普通工资和管理簿可以分别建立并发放，再完整迁入', async () => {
  const f = await createPayrollFeesMigrationFixture({ sameMonth: true })
  try {
    expect(f.ordinaryId).not.toBe(f.managedId)
  }
  finally { await f.original.close() }
})

it.each(['unchanged', 'fee-zero', 'book-soft-delete', 'scope-damaged', 'statement-month', 'negative-zero', 'claim-damaged'] as const)('费用六表恢复保全原图并拒绝日常变化：%s', async (kind) => {
  const f = await createPayrollFeesMigrationFixture()
  try {
    const read = () => f.instance.withWorkspaceTransaction(async tx => Object.fromEntries(await Promise.all(PAYROLL_A_FEES_MIGRATION_TABLES.map(async table => [table, await tx.select(`SELECT * FROM ${table} ORDER BY rowid`)]))))
    const mutations = { 'fee-zero': 'UPDATE payroll_a_fee_revisions SET unit_price=0 WHERE id=(SELECT id FROM payroll_a_fee_revisions LIMIT 1)', 'book-soft-delete': 'UPDATE payroll_a_management_books SET deleted_at=\'2026-09-15T00:00:00.000Z\'', 'scope-damaged': 'UPDATE payroll_a_management_book_revisions SET scope_json=\'{}\'', 'statement-month': 'UPDATE payroll_a_statement_books SET month=\'2026-10\' WHERE book_purpose=\'management\'', 'negative-zero': 'UPDATE payroll_a_negative_lines SET quantity=0', 'claim-damaged': 'UPDATE payroll_a_management_ownership SET proof_json=\'{}\'' }
    if (kind !== 'unchanged')
      await f.instance.withWorkspaceTransaction(tx => tx.execute(mutations[kind]))
    const before = await read()
    const rollback = () => coreMigrationTestInstance.rollback({ ...f.envelope('fees-rollback'), batchId: f.batch.batchId }, f.session)
    if (kind === 'unchanged') {
      await rollback()
      expect(coreMigrationTestInstance.snapshot(f.session).authority).toBe('local')
      expect(Object.values(await read()).every(rows => rows.length === 0)).toBe(true)
    }
    else {
      await expect(rollback()).rejects.toThrow('工资迁移：迁入后工资或来源已有日常变更；恢复会丢失当前事实，已整批拒绝')
      expect(await read()).toEqual(before)
      expect(coreMigrationTestInstance.snapshot(f.session).authority).toBe('central')
    }
  }
  finally { await f.original.close() }
})

it('缓存不能掩盖原管理工资新增负价子行；费用JSON引用覆盖未完成范围与原领取证据', async () => {
  const f = await createPayrollFeesMigrationFixture()
  try {
    const before = await f.service.aOutput({ origin: 'real' }, f.managedId)
    expect(before.state).toBe('available')
    const refs = await payrollFeesMigrationReferences(f.original.db)
    expect(refs.has(JSON.stringify(['unit_assignments', 'fee-assignment']))).toBe(true)
    expect(refs.has(JSON.stringify(['unit_assignment_scopes', 'fee-scope-wall']))).toBe(true)
    expect(refs.has(JSON.stringify(['wage_statements', f.originalManagedId]))).toBe(true)
    await f.instance.withWorkspaceTransaction(async (tx) => {
      const [row] = await tx.select<Record<string, unknown>>('SELECT * FROM payroll_a_negative_lines WHERE statement_id=?', [f.managedId])
      const extra = { ...row, id: 'unproven-added-negative', revision: 2, quantity: 0, signed_amount_fen: 0 }
      await tx.execute(`INSERT INTO payroll_a_negative_lines(${Object.keys(extra).join(',')}) VALUES(${Object.keys(extra).map(() => '?').join(',')})`, Object.values(extra))
    })
    await expect(f.service.aOutput({ origin: 'real' }, f.managedId)).rejects.toThrow('迁入工资 payroll_a_negative_lines 的原成员、分配或处理集合已变化，不能沿用原证明')
  }
  finally { await f.original.close() }
})

it('迁入后管理配置只用映射原责任，后月延续负价与已领，重复迁入保留新发放', async () => {
  const f = await createPayrollFeesMigrationFixture()
  try {
    const book = { bookPurpose: 'management' as const, managementBookId: f.mappedId('payroll_a_management_books', f.originalBook.managementBookId!) }
    const scope = { projectId: f.projectId, crewId: f.mappedId('crews', 'crew'), leaderWorkerId: f.mappedId('workers', 'w'), month: '2026-10', book }
    const projected = await f.instance.withWorkspaceTransaction(tx => loadPayrollMigratedFees(tx, f.projectId))
    expect(projected.unavailableIds.size).toBe(0)
    expect([...projected.managementOwnership.values()][0]!.proof.fact.assignmentId).toBe(f.mappedId('unit_assignments', 'fee-assignment'))
    let config = await f.service.aFeeConfig({ origin: 'real' }, scope)
    const oldFee = config.fees.find(fee => fee.kind === 'management')!
    await f.service.executeFees({ commandId: 'migrated-fee-new-revision', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId: f.projectId, statementId: null, draftKey: null, configScope: scope, book, action: { kind: 'save-a-fees', baseVersion: config.baseVersion, fees: [{ ...book, kind: 'management', feeId: oldFee.feeId, baseRevisionId: oldFee.id, name: oldFee.name, enabled: true, unitPrice: 3, unit: oldFee.unit, basis: oldFee.basis, effectiveMonth: scope.month, adoptedDefault: null }], remove: [] } })
    config = await f.service.aFeeConfig({ origin: 'real' }, scope)
    const revision = config.managementBooks.find(row => row.book.id === book.managementBookId)!.revision!
    expect(revision.scope.assignments[0]!.assignmentId).toBe(f.mappedId('unit_assignments', 'fee-assignment'))
    const saved = await f.service.executeFees({ commandId: 'migrated-management-next', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId: f.projectId, statementId: null, draftKey: null, configScope: scope, book, action: { kind: 'start-a-management-draft', baseVersion: config.baseVersion, managementBookId: book.managementBookId, managementRevisionId: revision.id, month: scope.month, periodKind: 'monthly' } })
    const id = saved.statementId!
    const read = () => f.service.aForm({ origin: 'real' }, { statementId: id })
    const form = await read()
    expect(form.totals.grossAmount.value).toBe(60)
    expect(hasPayrollAFeesForm(form) && form.fees!.totals.negativeAmount.value).toBe(-20)
    const command = (read: typeof form, commandId: string, action: Parameters<typeof f.service.execute>[0]['action']) => ({ commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: f.projectId, statementId: id, draftKey: null, configScope: null, action })
    await f.service.execute(command(form, 'next-management-check', { kind: 'check-a' }))
    const checked = await read()
    expect({ status: checked.status, needsRecheck: checked.needsRecheck, eligibility: checked.eligibility, blockers: checked.blockers }).toMatchObject({ status: 'checked', needsRecheck: false, eligibility: { canRelease: true }, blockers: [] })
    await f.service.execute(command(checked, 'next-management-release', { kind: 'release-a', release: { actualAmount: 60, allocations: checked.members.map(member => ({ workerId: member.id, amount: member.id === checked.draft.leaderWorkerId ? 60 : 0 })) } }))
    expect((await f.service.aOutput({ origin: 'real' }, id)).state).toBe('available')
    const repeated = await f.instance.prepareMigrationSnapshot(coreMigrationTestInstance.snapshot(f.session))
    repeated.commit()
    expect((await f.service.aOutput({ origin: 'real' }, id)).state).toBe('available')
    // V4 来源现在可识别，因此按真实引用而非未知格式拒绝整批撤回。
    await expect(coreMigrationTestInstance.rollback({ ...f.envelope('fees-after-new-rollback'), batchId: f.batch.batchId }, f.session)).rejects.toThrow('工资迁移：独立工资配置、来源、回执或历史仍引用待撤身份')
    expect((await f.service.aOutput({ origin: 'real' }, id)).state).toBe('available')
  }
  finally { await f.original.close() }
}, 30_000)

it('迁入原费用依据仍可独立更正和实际退款，原签字输出不重写', async () => {
  const f = await createPayrollFeesMigrationFixture()
  try {
    const before = await f.service.aOutput({ origin: 'real' }, f.ordinaryId)
    const target = { adjustmentId: null, draftKey: 'migrated-fee-correction', originalStatementId: f.ordinaryId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'A' || !initial.draft.basis.fees)
      throw new Error('缺少原费用更正依据')
    expect(initial.draft.basis.source).toMatchObject({ schemaVersion: 4, ratioPlan: { itemRatios: expect.arrayContaining([expect.objectContaining({ ratio: 1 })]) } })
    expect(initial.original.book).toEqual({ bookPurpose: 'ordinary', managementBookId: null })
    const draft = { ...initial.draft, reason: '原补贴量核对为九十', evidenceNote: '按原墙砖责任核实，不改原签字', basis: { ...initial.draft.basis, fees: { ...initial.draft.basis.fees, components: initial.draft.basis.fees.components.map(component => ({ ...component, quantity: 90 })) } } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(preview.preview.delta.value).toBe(-13)
    const command = (read: PayrollAdjustmentFormRead, commandId: string, action: PayrollAdjustmentAction) => ({ commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: f.projectId, target: read.target, action })
    const saved = await f.service.executeAdjustment(command(preview, 'migrated-fee-correction-save', { kind: 'save-adjustment-draft', draft }))
    const confirmation = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: saved.adjustmentId! } })
    await f.service.executeAdjustment(command(confirmation, 'migrated-fee-correction-confirm', { kind: 'confirm-adjustment' }))
    const paymentTarget = { kind: 'actual-payment' as const, draftKey: 'migrated-fee-refund', adjustmentIds: [saved.adjustmentId!] }
    const payment = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget })
    const paymentDraft = { kind: 'refund' as const, occurredOn: '2026-10-03', amount: -5, evidenceNote: '原多发补贴已退五元', allocations: [{ workerId: f.mappedId('workers', 'w'), amount: -5 }], applications: [{ adjustmentId: saved.adjustmentId!, amount: -5, balanceVersion: payment.balances[0]!.balanceVersion }] }
    const paymentPreview = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget, draft: paymentDraft })
    await f.service.executeAdjustment({ commandId: 'migrated-fee-refund-confirm', workspaceId: paymentPreview.context.workspaceId, actorId: paymentPreview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: paymentPreview.context.sourceVersion, projectId: f.projectId, target: paymentTarget, action: { kind: 'confirm-actual-payment', payment: paymentDraft } })
    expect((await f.service.adjustmentDetail({ origin: 'real' }, saved.adjustmentId!)).balance.remainingDelta.value).toBe(-8)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: f.projectId })).netAmount.value).toBe(4009)
    expect((await f.service.aOutput({ origin: 'real' }, f.ordinaryId)).document).toEqual(before.document)
  }
  finally { await f.original.close() }
}, 30_000)

it('真实普通补贴与管理负价迁入后公开输出/已发详情可读，原六表JSON和签名逐字保留', async () => {
  const f = await createPayrollFeesMigrationFixture()
  try {
    for (const [oldId, id, amount] of [[f.originalOrdinaryId, f.ordinaryId, 3730], [f.originalManagedId, f.managedId, 284]] as const) {
      const before = await f.original.service.aOutput({ origin: 'real' }, oldId)
      const after = await f.service.aOutput({ origin: 'real' }, id)
      expect(after.state).toBe('available')
      if (before.state !== 'available' || after.state !== 'available' || !hasPayrollAFeesDocument(before.document) || !hasPayrollAFeesDocument(after.document))
        throw new Error('必须保留费用冻结输出')
      expect(after.document.actualAmount).toBe(amount)
      expect(after.document.listAmount).toBe(before.document.listAmount)
      expect(after.document.fees.totals).toEqual(before.document.fees.totals)
      expect(after.document.fees.lines[0]!.components[0]!.fact.sourceFingerprint).toBe(before.document.fees.lines[0]!.components[0]!.fact.sourceFingerprint)
      expect(after.document.fees.lines[0]!.components[0]!.fact.assignmentId).toBe(f.mappedId('unit_assignments', 'fee-assignment'))
      expect(decodePayrollARead(encodePayrollAWire(after), 'output', { origin: 'real' }, id)).toEqual(after)
      const form = await f.service.aForm({ origin: 'real' }, { statementId: id })
      expect(hasPayrollAFeesForm(form)).toBe(true)
      if (!hasPayrollAFeesForm(form))
        throw new Error('缺少费用详情')
      expect(form.eligibility.canSaveDraft).toBe(false)
      expect(form.fees!.totals).toEqual(after.document.fees.totals)
      expect(decodePayrollARead(encodePayrollAWire(form), 'form', { origin: 'real' }, { statementId: id })).toEqual(form)
      const [raw] = await f.original.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [oldId])
      const [mapped] = await f.instance.withWorkspaceTransaction(tx => tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [id]))
      expect(mapped!.snapshot_json).toBe(raw!.snapshot_json)
    }
    for (const table of PAYROLL_A_FEES_MIGRATION_TABLES) {
      const primary = payrollAFeesPrimaryKey(table)
      for (const row of await f.original.db.select<Record<string, string | number | null>>(`SELECT * FROM ${table}`)) {
        const [mapped] = await f.instance.withWorkspaceTransaction(tx => tx.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${primary}=?`, [f.mappedId(table, String(row[primary]))]))
        for (const column of PAYROLL_A_FEES_MIGRATION_COLUMNS[table].filter(column => column.endsWith('_json')))
          expect(mapped![column]).toBe(row[column])
      }
    }
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: f.projectId })).netAmount.value).toBe(4014)
  }
  finally { await f.original.close() }
})
