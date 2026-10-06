import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { FinanceReferenceResolver, FinanceReferenceTable } from '../../app/lib/finance/reference'
import type { BusinessSession } from './business-session'
import { financeFailure, financeProblemFromUnknown } from '../../app/lib/finance/central-contract'

export interface ProductionFinanceReferenceOwners {
  workers?: (id: string) => Promise<Record<string, unknown> | null>
  contracts?: (id: string) => Promise<Record<string, unknown> | null>
  expenditure_settlements?: (id: string) => Promise<Record<string, unknown> | null>
  invoices?: (id: string) => Promise<Record<string, unknown> | null>
  workerCandidates?: () => Promise<Array<{ id: string, name: string }>>
  settlementCandidates?: () => Promise<Array<Record<string, unknown>>>
  contractCandidates?: () => Promise<Array<Record<string, unknown>>>
  invoiceCandidates?: () => Promise<Array<Record<string, unknown>>>
}

const capability: Record<FinanceReferenceTable, string> = {
  projects: 'project:list:read',
  customers: 'customer:list:read',
  suppliers: 'supplier:list:read',
  workers: 'worker:list:read',
  contracts: 'material-contract:read',
  expenditure_settlements: 'other-settlement:read',
  invoices: 'finance-invoice:read',
}

/** No developer instance and no name matching participate in a production transaction. */
export function productionFinanceReferences(tx: TransactionDb, actor: BusinessSession, owners: ProductionFinanceReferenceOwners = {}): FinanceReferenceResolver {
  async function read<T>(table: FinanceReferenceTable, id: string): Promise<T | null> {
    if (table === 'contracts' ? !['material-contract:read', 'construction-contract:read', 'subcontract-contract:read', 'auxiliary-contract:read'].some(cap => actor.capabilities.includes(cap)) : !actor.capabilities.includes(capability[table]))
      financeFailure('forbidden', '当前身份无权读取所选财务关联来源。')
    let row: Record<string, unknown> | null
    if (table === 'projects' || table === 'customers') {
      row = (await tx.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`, [id]))[0] ?? null
    }
    else if (table === 'suppliers') {
      const found = (await tx.select<{ id: string, draft_json: string }>('SELECT id,draft_json FROM suppliers WHERE id=?', [id]))[0]
      const draft = found ? JSON.parse(found.draft_json) : null
      row = found && !draft.deletedAt ? { ...draft, id: found.id, name: draft.name, deleted_at: null } : null
    }
    else if (owners[table]) {
      try {
        row = await owners[table]!(id)
      }
      catch (cause) { throw financeProblemFromUnknown(cause) }
    }
    else if (table === 'contracts') {
      if (!actor.capabilities.includes('material-contract:read'))
        financeFailure('unavailable', '所选类型的正式合同来源尚未接通。')
      const found = (await tx.select<{ id: string, record_json: string }>('SELECT id,record_json FROM material_contract_records WHERE id=? AND parent_id IS NULL', [id]))[0]
      const record = found ? JSON.parse(found.record_json) : null
      row = record && !record.deletedAt ? { id: found!.id, project_id: record.draft.projectId ?? null, supplier_id: record.draft.supplierId ?? null, customer_id: null, kind: '材采', sub_kind: null, name: record.draft.name, status: record.draft.status } : null
      if (!row)
        financeFailure('unavailable', '所选合同尚无可核实的正式合同来源；不能借用开发数据关联。')
    }
    else {
      financeFailure('unavailable', '所选财务关联的正式来源尚未接通，请保留历史冻结依据。')
    }
    if (row && (row.id !== id || row.deleted_at))
      financeFailure('unavailable', '财务关联来源的稳定身份或当前状态不一致。')
    if (row && table === 'contracts') {
      const cap = row.kind === '施工' ? 'construction-contract:read' : row.kind === '分包' ? 'subcontract-contract:read' : row.kind === '材采' ? 'material-contract:read' : 'auxiliary-contract:read'
      if (!actor.capabilities.includes(cap))
        financeFailure('forbidden', '当前身份无所选实际合同的读取权限。')
    }
    return row as T | null
  }
  return { read }
}
