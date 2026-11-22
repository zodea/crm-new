import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { FinanceReferenceResolver, FinanceReferenceTable } from '../../app/lib/finance/reference'
import type { BusinessSession } from './business-session'
import { financeFailure, financeProblemFromUnknown } from '../../app/lib/finance/central-contract'
import { validateProductionSubcontractState } from './production-subcontract-contract-record'
import { readSubcontractContractScopeFacts } from './production-subcontract-contract-sources'

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

export function hasProductionSettlementRead(actor: BusinessSession): boolean {
  return ['other-settlement:read', 'subcontract-document:read'].some(cap => actor.capabilities.includes(cap))
}

export function productionSettlementReadCapability(row: Record<string, unknown>): string | null {
  if (row.document_owner === 'business')
    return 'subcontract-document:read'
  if (row.document_owner === 'other' || (row.document_owner == null && ['机械', '其他', '其他支出'].includes(String(row.biz_type))))
    return 'other-settlement:read'
  return null
}

/** No developer instance and no name matching participate in a production transaction. */
export function productionFinanceReferences(tx: TransactionDb, actor: BusinessSession, owners: ProductionFinanceReferenceOwners = {}): FinanceReferenceResolver {
  async function read<T>(table: FinanceReferenceTable, id: string): Promise<T | null> {
    if (table === 'contracts' ? !['material-contract:read', 'construction-contract:read', 'subcontract-contract:read', 'auxiliary-contract:read'].some(cap => actor.capabilities.includes(cap)) : table === 'expenditure_settlements' ? !hasProductionSettlementRead(actor) : !actor.capabilities.includes(capability[table]))
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
      const participant = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'subcontract-contracts\''))[0]
      const subcontract = participant?.schema_version === 1
        ? (await tx.select<{ id: string }>('SELECT id FROM subcontract_contract_records WHERE id=?', [id]))[0]
        : null
      if (subcontract) {
        if (!actor.capabilities.includes('subcontract-contract:read'))
          financeFailure('forbidden', '当前身份无所选真实分包合同读取权限。')
        if ((await tx.select('SELECT id FROM material_contract_records WHERE id=? AND parent_id IS NULL', [id])).length)
          financeFailure('unavailable', '相同合同稳定身份被多个正式 owner 占用，不能按名称或类型猜接。')
        const { state } = await validateProductionSubcontractState(tx, actor)
        const original = state.contracts.find(record => record.draft.id === id)
        const fact = (await readSubcontractContractScopeFacts(tx, actor)).find(record => record.id === id)
        if (!original || !fact?.eligible)
          financeFailure('unavailable', '真实分包合同已归档或原关系不可用，保留历史依据。')
        row = { id, project_id: fact.projectId, supplier_id: fact.supplierId, kind: '分包', sub_kind: original.draft.subKind ?? null, no: fact.no, name: fact.name, amount: fact.amount, status: fact.status, deleted_at: null, version: String(original.version) }
      }
      else {
        if (!actor.capabilities.includes('material-contract:read'))
          financeFailure('unavailable', '所选类型的正式合同来源尚未接通。')
        const found = (await tx.select<{ id: string, record_json: string }>('SELECT id,record_json FROM material_contract_records WHERE id=? AND parent_id IS NULL', [id]))[0]
        const record = found ? JSON.parse(found.record_json) : null
        row = record && !record.deletedAt ? { id: found!.id, project_id: record.draft.projectId ?? null, supplier_id: record.draft.supplierId ?? null, customer_id: null, kind: '材采', sub_kind: null, no: record.draft.no, name: record.draft.name, amount: record.draft.amount ?? null, status: record.draft.status } : null
        if (!row)
          financeFailure('unavailable', '所选合同尚无可核实的正式合同来源；不能借用开发数据关联。')
      }
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
    if (row && table === 'expenditure_settlements') {
      const cap = productionSettlementReadCapability(row)
      if (!cap)
        financeFailure('unavailable', '结算的真实 owner 尚未证明，不能按其他类型猜接。')
      if (!actor.capabilities.includes(cap))
        financeFailure('forbidden', '当前身份无所选结算实际 owner 的读取权限。')
    }
    return row as T | null
  }
  return { read }
}
