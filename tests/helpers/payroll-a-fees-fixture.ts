import type { PayrollABookRef, PayrollAFeeConfigRead, PayrollAFeeDraft, PayrollAFeesAction, PayrollAFeesCommand, PayrollAFeesFormRead } from '../../app/lib/payroll/central-a-fees-contract'
import { loadPayrollAManagementScopeFacts } from '../../server/utils/payroll-management-scope-facts'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollAServiceFixture } from './payroll-a-service-fixture'

/** P5 原量、原责任与所有发放均经真实 SQLite/公开工资服务建立。 */
export async function createPayrollAFeesFixture() {
  const f = await createPayrollAServiceFixture({ quantityFacts: loadPayrollAQuantityFacts, managementScopeFacts: loadPayrollAManagementScopeFacts })
  await f.config()
  await f.db.execute('INSERT INTO buildings(id,project_id,code,name) VALUES(\'fee-building\',\'p\',\'A\',\'一栋\')')
  await f.db.execute('INSERT INTO floors(id,building_id,code,name) VALUES(\'fee-floor\',\'fee-building\',\'1\',\'一层\')')
  await f.db.execute('INSERT INTO house_type_templates(id,project_id,code,name) VALUES(\'fee-template\',\'p\',\'T\',\'户型\')')
  await f.db.execute('INSERT INTO rooms(id,template_id,code,name) VALUES(\'fee-room\',\'fee-template\',\'R\',\'客厅\')')
  await f.db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(\'fee-unit\',\'fee-floor\',\'fee-template\',\'101\')')
  await f.db.execute('INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES(\'fee-stage\',\'p\',\'S\',\'完成\',\'泥工\')')
  await f.db.execute('INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES(\'fee-assignment\',\'fee-unit\',\'泥工\',\'w\')')
  for (const [id, name, quantity, unit] of [['wall', '墙砖', 100, '㎡'], ['floor', '地砖', 50, '㎡'], ['shower', '淋浴板', 30, '套']] as const) {
    await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(?,?,?, ?,?,?)', [id, 'p', id, name, '泥工', unit])
    await f.db.execute('INSERT INTO house_type_template_items(id,room_id,item_id,field_qty) VALUES(?,?,?,?)', [`fee-line-${id}`, 'fee-room', id, quantity])
    await f.db.execute('INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES(?,?,?,1)', [`fee-stage-${id}`, 'fee-stage', id])
    await f.db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,?,?)', [`fee-scope-${id}`, 'fee-assignment', 'fee-room', id])
  }
  await f.db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(\'fee-completion\',\'fee-unit\',\'fee-stage\',\'fee-assignment\',\'completed\',\'2026-08-05\')')
  const ordinary: PayrollABookRef = { bookPurpose: 'ordinary', managementBookId: null }
  let sequence = 0
  const feeConfig = (book: PayrollABookRef = ordinary, month = '2026-08') => f.service.aFeeConfig({ origin: 'real' }, { projectId: 'p', crewId: 'crew', leaderWorkerId: 'w', month, book })
  const feeCommand = (read: PayrollAFeeConfigRead | PayrollAFeesFormRead, action: PayrollAFeesAction): PayrollAFeesCommand => ({ commandId: `fee-command-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'p', statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, book: 'scope' in read ? read.scope.book : read.book!, action })
  const fee = (overrides: Partial<PayrollAFeeDraft> = {}): PayrollAFeeDraft => ({ ...ordinary, kind: 'housing', feeId: null, baseRevisionId: null, name: '房补', enabled: true, unitPrice: 1.3, unit: '㎡', basis: { kind: 'completed-field-quantity', itemIds: ['wall'], scope: { kind: 'project' } }, effectiveMonth: '2026-08', adoptedDefault: null, ...overrides } as PayrollAFeeDraft)
  const saveFees = async (fees: PayrollAFeeDraft[], book: PayrollABookRef = ordinary, month = '2026-08') => {
    const read = await feeConfig(book, month)
    return f.service.executeFees(feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees, remove: [] }))
  }
  const prices = async () => f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: ['wall', 'floor', 'shower'].map(itemId => ({ priceId: null, itemId, unit: itemId === 'shower' ? '套' : '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: itemId === 'wall' ? 36 : 0, scope: { kind: 'project' } })) }))
  const management = async (month = '2026-08') => {
    const read = await feeConfig(ordinary, month)
    const scope = { assignments: read.responsibilityOptions.map(o => ({ assignmentId: o.assignmentId, scopeIds: o.scopeIds, cells: o.cells })) }
    const saved = await f.service.executeFees(feeCommand(read, { kind: 'save-a-management-book', baseVersion: read.baseVersion, management: { managementBookId: null, baseRevisionId: null, managerWorkerId: 'w', effectiveMonth: month, managementMode: 'crew-managed', scope, initialPayRatio: 0.8, evidenceNote: '明确管理上述原责任范围' } }))
    const book: PayrollABookRef = { bookPurpose: 'management', managementBookId: saved.managementBookId! }
    await saveFees([fee({ ...book, kind: 'management', name: '管理费', unitPrice: 2.5, effectiveMonth: month, basis: { kind: 'completed-field-quantity', itemIds: ['wall', 'floor'], scope: { kind: 'project' } } })], book, month)
    const start = async (period = month) => {
      const selected = await feeConfig(book, period)
      return f.service.executeFees(feeCommand(selected, { kind: 'start-a-management-draft', baseVersion: selected.baseVersion, managementBookId: book.managementBookId!, managementRevisionId: selected.managementBooks.find(m => m.book.id === book.managementBookId)!.revision!.id, month: period, periodKind: 'monthly' }))
    }
    return { book, scope, start }
  }
  const release = async (statementId: string, amount: number) => {
    const read = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    const current = await read()
    await f.service.execute(f.command(current, { kind: 'release-a', release: { actualAmount: amount, allocations: current.members.map(m => ({ workerId: m.id, amount: m.id === current.draft.leaderWorkerId ? amount : 0 })) } }))
  }
  return { ...f, ordinary, feeConfig, feeCommand, fee, saveFees, prices, management, release }
}
