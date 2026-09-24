import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { createPayrollService } from '../../server/utils/payroll-service'
import { expect, it } from 'vitest'
import { hasPayrollAFeesDocument } from '../../app/lib/payroll/central-a-fees-contract'
import { collectWorkbookReferences } from '../../server/utils/payroll-workbook-references'
import { createPayrollWorkbookService } from '../../server/utils/payroll-workbook-service'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

async function workbook(f: { db: TransactionDb, service: ReturnType<typeof createPayrollService> }, projectId: string, statementId: string) {
  const service = createPayrollWorkbookService({
    session: () => ({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] }),
    transaction: work => work(f.db),
    payroll: () => f.service,
    roster: () => { throw new Error('公开目录不能读取私密名册') },
  })
  return service.workbookPreview({ origin: 'real' }, { projectId, statementIds: [statementId], mode: 'project-month', rosterArchiveId: null })
}

it('真实管理工资无普通施工行时仍保护管理范围、费用修订和每个原工程量身份', async () => {
  const f = await createPayrollAFeesFixture()
  try {
    const manager = await f.management()
    const saved = await manager.start()
    await f.release(saved.statementId!, 300)
    const preview = await workbook(f, 'p', saved.statementId!)
    const document = preview.groups[0]!.entries[0]!.document
    expect(document.formatFamily).toBe('A')
    if (document.formatFamily !== 'A' || !hasPayrollAFeesDocument(document))
      throw new Error('缺少真实管理工资原件')
    expect(document.lines).toHaveLength(0)
    const refs = collectWorkbookReferences(preview)
    for (const [tableName, recordId] of [
      ['unit_stage_completions', 'fee-completion'],
      ['unit_assignments', 'fee-assignment'],
      ['unit_assignment_scopes', 'fee-scope-wall'],
      ['house_type_template_items', 'fee-line-floor'],
      ['construction_stage_items', 'fee-stage-wall'],
      ['units', 'fee-unit'],
      ['rooms', 'fee-room'],
      ['payroll_a_management_book_revisions', document.fees.management!.revision.id],
      ['payroll_a_fee_revisions', document.fees.feeRevisions[0]!.id],
    ])
      expect(refs).toContainEqual({ tableName, recordId })
    expect(refs).not.toContainEqual({ tableName: 'workers', recordId: document.leaderName })
  }
  finally { await f.close() }
})

it('工资被空鼓全额扣完且后来全部整改，目录仍保护原检查、整改、起点和采用引用', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const draft = { ...f.draft, payRatio: 0.3 }
    const saved = await f.service.execute(f.command(await f.form({ payRatio: 0.3 }), { kind: 'save-a-draft', draft }))
    const statementId = saved.statementId!
    const read = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await read()).hollow!))
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 0, allocations: [{ workerId: draft.leaderWorkerId, amount: 0 }] } }))
    const before = await workbook(f, draft.projectId!, statementId)
    const hollow = before.groups[0]!.entries[0]!.document.hollow!
    const refs = collectWorkbookReferences(before)
    for (const [tableName, recordId] of [
      ['quantity_hollow_records', f.recordId],
      ['quantity_hollow_revisions', hollow.facts[0]!.revisions[0]!.revisionId],
      ['quantity_hollow_rectifications', hollow.facts[0]!.rectifications[0]!.id],
      ['quantity_hollow_logs', hollow.facts[0]!.rectifications[0]!.logId],
      ['payroll_hollow_starts', hollow.start!.id],
      ['payroll_hollow_adoptions', hollow.adoptions[0]!.id],
    ])
      expect(refs).toContainEqual({ tableName, recordId })
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 15, note: '后来修好不解除原件引用' }))
    expect(collectWorkbookReferences(await workbook(f, draft.projectId!, statementId))).toEqual(refs)
  }
  finally { await f.close() }
})
