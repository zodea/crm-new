import type { CustomerListSourceRow } from '../../app/lib/customer/repository'
import type { CustomerFormDraft, FormAttachment } from '../../app/lib/master-data/forms'
import { customerProblem, CustomerRepositoryProblem } from '../../app/lib/customer/repository'

export const CUSTOMER_FIELDS = {
  name: 'name',
  taxNo: 'tax_no',
  legalRep: 'legal_rep',
  registeredAddress: 'registered_address',
  invoiceName: 'invoice_name',
  bank: 'bank',
  bankAccount: 'bank_account',
  contact: 'contact',
  contactPhone: 'contact_phone',
  status: 'status',
  note: 'note',
} as const
export function customerFailure(code: Parameters<typeof customerProblem>[0], message: string): never {
  throw new CustomerRepositoryProblem(customerProblem(code, message))
}
export type CustomerRow = Record<string, unknown> & { id: string, version: number, updated_at: string, deleted_at: string | null }
export function normalizedCustomer(value: CustomerFormDraft): CustomerFormDraft {
  return { ...Object.fromEntries(Object.keys(CUSTOMER_FIELDS).map(field => [field, String(value[field as keyof typeof CUSTOMER_FIELDS] ?? '').trim()])), aliases: (value.aliases ?? []).map(v => v.trim()).filter(Boolean), status: value.status?.trim() || 'active' }
}
export function customerDraft(row: CustomerRow): CustomerFormDraft & { id: string } {
  try {
    const aliases: unknown = JSON.parse(String(row.aliases))
    if (!Array.isArray(aliases) || !aliases.every(v => typeof v === 'string') || Object.values(CUSTOMER_FIELDS).some(field => typeof row[field] !== 'string') || !Number.isSafeInteger(row.version) || row.version < 1)
      throw new Error('invalid record')
    return { id: row.id, ...Object.fromEntries(Object.entries(CUSTOMER_FIELDS).map(([field, column]) => [field, row[column]])), aliases }
  }
  catch { return customerFailure('unavailable', '客户持久记录损坏，请核对备份，不能重建空记录。') }
}
export function customerListRow(row: CustomerRow): CustomerListSourceRow {
  return { ...customerDraft(row), dataOrigin: 'real', updatedAt: row.updated_at } as CustomerListSourceRow
}
export function customerAttachment(row: Record<string, unknown>): FormAttachment {
  return { id: String(row.id), ownerType: 'customer', ownerId: String(row.owner_id), fileName: String(row.file_name), filePath: '', fileSize: Number(row.file_size), mimeType: String(row.mime_type), category: String(row.category), uploader: String(row.uploader), uploadedAt: String(row.uploaded_at), deletedAt: row.deleted_at === null ? null : String(row.deleted_at) }
}
