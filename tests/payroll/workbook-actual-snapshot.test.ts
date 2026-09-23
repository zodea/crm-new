import type { PayrollWorkbookCommand, PayrollWorkbookInput, PayrollWorkbookPreview } from '../../app/lib/payroll/central-workbook-contract'
import { expect, it } from 'vitest'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createPayrollWorkbookService } from '../../server/utils/payroll-workbook-service'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'
import { numberingCommand } from '../helpers/payroll-numbering-fixture'

it('已保存目录固定当时实际账；后来真实退款只进入新目录版本且旧预览拒绝提交', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const session = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] }
    const query = { origin: 'real' as const, projectId: 'p' }
    const numbered = () => f.service.numbering(query, { projectId: 'p', statementId: f.statementId })
    await f.service.executeNumbering(numberingCommand(await numbered(), 'start', { kind: 'initialize', nextNumber: 1, evidenceNote: '经核对首号' }))
    await f.service.executeNumbering(numberingCommand(await numbered(), 'issue', { kind: 'issue' }))
    const service = createPayrollWorkbookService({
      session: () => session,
      transaction: work => f.withTransaction(work),
      payroll: db => createPayrollService({ session: () => session, identities: () => f.source, transaction: work => work(db, session) }),
      roster: () => { throw new Error('未选名册不能私读') },
    })
    const input: PayrollWorkbookInput = { projectId: 'p', mode: 'leader-cycle', statementIds: [f.statementId], rosterArchiveId: null }
    const preview = () => service.workbookPreview(query, input)
    const command = (read: PayrollWorkbookPreview, commandId: string): PayrollWorkbookCommand => ({ schemaVersion: 1, commandId, ...session, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.sourceVersion, input: read.input, action: 'archive' })
    const first = await preview()
    // Context-only capabilities are deliberately not command fields.
    const clean = (read: PayrollWorkbookPreview, key: string) => {
      const value = command(read, key)
      return { schemaVersion: value.schemaVersion, commandId: value.commandId, workspaceId: value.workspaceId, actorId: value.actorId, origin: value.origin, requiredCapability: value.requiredCapability, sourceVersion: value.sourceVersion, input: value.input, action: value.action }
    }
    const original = await service.executeWorkbook(clean(first, 'first-directory'))
    expect(first.groups[0]!.actualLedger.netAmount.value).toBe(1000)
    const correction = await f.correct(900)
    await f.refund(correction.adjustment.id, 40)
    await expect(service.executeWorkbook(clean(first, 'stale-preview'))).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    const current = await preview()
    expect(current.groups[0]!.actualLedger.netAmount.value).toBe(960)
    expect(current.groups[0]!.actualLedger.rows).toContainEqual(expect.objectContaining({ kind: 'refund', signedAmount: expect.objectContaining({ value: -40 }) }))
    expect(current.groups[0]!.entries[0]!.document.actualAmount).toBe(1000)
    const newer = await service.executeWorkbook(clean(current, 'new-directory'))
    expect(newer.version).toBe(2)
    const older = await service.workbookArchive(query, { projectId: 'p', archiveId: original.archiveId })
    expect(older.groups[0]!.actualLedger.netAmount.value).toBe(1000)
    expect(older.manifestHash).toBe(original.manifestHash)
    expect((await service.workbookArchive(query, { projectId: 'p', archiveId: newer.archiveId })).groups[0]!.actualLedger.netAmount.value).toBe(960)
    expect((await numbered()).issue?.number).toBe('1')
    expect((await numbered()).settings?.nextNumber).toBe(2)
  }
  finally { await f.close() }
}, 30_000)
