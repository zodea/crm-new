import type { TransactionDb } from '~/lib/db/coordinator'
import { generateId } from '~/lib/util/id'

export type SupplierAuditAction
  = | 'create'
    | 'update'
    | 'delete'
    | 'restore'
    | 'credential_review'
    | 'taxpayer_verification'

export interface SupplierAuditInput {
  supplierId: string
  action: SupplierAuditAction
  outcome?: string
  sourceCategory?: string
  changedFields?: readonly string[]
  notePresent?: boolean
  createdAt?: string
}

export async function writeSupplierAudit(
  tx: Pick<TransactionDb, 'execute'>,
  input: SupplierAuditInput,
): Promise<string> {
  const id = generateId('supplier_audit')
  await tx.execute(
    `INSERT INTO supplier_audits (
       id, supplier_id, action, outcome, source_category,
       changed_fields, note_present, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.supplierId,
      input.action,
      input.outcome?.trim() ?? '',
      input.sourceCategory?.trim() ?? '',
      JSON.stringify([...new Set(input.changedFields ?? [])].sort()),
      input.notePresent ? 1 : 0,
      input.createdAt ?? new Date().toISOString(),
    ],
  )
  return id
}
