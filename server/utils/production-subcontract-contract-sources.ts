import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { isEffectiveExpenditureContract } from '../../app/lib/contract/effective-status'
import { subcontractFailure as fail, validateProductionSubcontractState } from './production-subcontract-contract-record'

/** No coordinator re-entry: the caller already owns the actual transaction. */
export async function readSubcontractContractScopeFacts(tx: Pick<TransactionDb, 'select'>, actor: BusinessSession) {
  if (!actor.capabilities.includes('subcontract-contract:read'))
    return fail('forbidden', '无真实分包合同来源读取权限')
  const { state } = await validateProductionSubcontractState(tx, actor)
  const parents = await tx.select<{ id: string, deleted_at: string | null, project_deleted_at: string | null, retired: number }>(`SELECT c.id,c.deleted_at,p.deleted_at AS project_deleted_at,
    EXISTS(SELECT 1 FROM subcontract_contract_import_restores r WHERE r.import_id=json_extract(c.record_json,'$.migrationBatchId')) AS retired
    FROM subcontract_contract_records c LEFT JOIN projects p ON p.id=c.project_id`)
  return state.contracts.map((record) => {
    const parent = parents.find(row => row.id === record.draft.id)!
    const values = state.supplements.filter(row => row.contractId === record.draft.id && isEffectiveExpenditureContract(row.status) && !('deletedAt' in row && row.deletedAt !== null)).map(row => row.amount)
    return { id: record.draft.id, projectId: record.draft.projectId ?? null, supplierId: record.draft.supplierId ?? null, name: record.draft.name ?? '', no: record.draft.no ?? '', status: record.draft.status ?? '草稿', deletedAt: parent.deleted_at, retired: Boolean(parent.retired), amount: record.draft.amount ?? null, supplementAmount: values.includes(null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0), eligible: parent.deleted_at === null && parent.project_deleted_at === null && !parent.retired && !!record.draft.projectId && !!record.draft.supplierId }
  })
}
