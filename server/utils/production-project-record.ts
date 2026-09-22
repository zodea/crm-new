import type { FormAttachment, ProjectFormDraft } from '../../app/lib/master-data/forms'
import type { ProjectListSourceRow } from '../../app/lib/project/repository'
import { decodeProjectFormDraft } from '../../app/lib/project/command-validation'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

export function projectFailure(code: Parameters<typeof projectProblem>[0], message: string): never {
  throw new ProjectRepositoryProblem(projectProblem(code, message))
}
export interface ProjectRow { id: string, name: string, code: string, customer_id: string | null, secondary_customer_id: string | null, draft_json: string, version: number, updated_at: string, deleted_at: string | null }
export function normalizedProject(draft: ProjectFormDraft): ProjectFormDraft {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => key !== 'id' && value !== undefined).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
}
export function projectDraft(row: ProjectRow): ProjectFormDraft & { id: string } {
  try {
    const draft = decodeProjectFormDraft(JSON.parse(row.draft_json))
    if (draft.id !== undefined || (draft.name ?? '') !== row.name || (draft.code ?? '') !== row.code
      || (draft.customerId || null) !== row.customer_id || (draft.secondaryCustomerId || null) !== row.secondary_customer_id
      || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.updated_at))) {
      throw new Error('invalid record')
    }
    return { ...draft, id: row.id }
  }
  catch { return projectFailure('unavailable', '项目持久记录损坏，请核对备份，不能重建空记录。') }
}
export function projectListRow(row: ProjectRow, names: ReadonlyMap<string, string>, customerAllowed: boolean): ProjectListSourceRow {
  const draft = projectDraft(row)
  return {
    dataOrigin: 'real',
    id: row.id,
    name: row.name,
    code: row.code,
    status: draft.status || '筹备中',
    contractAmount: draft.contractAmount ?? null,
    operationType: draft.operationType ?? '',
    startDate: draft.startDate || null,
    plannedEnd: draft.plannedEnd || null,
    actualEnd: draft.actualEnd || null,
    plannedDuration: draft.plannedDuration ?? null,
    manager: draft.manager ?? '',
    execManager: draft.execManager ?? '',
    builder: draft.builder ?? '',
    customerId: row.customer_id,
    customerName: row.customer_id ? names.get(row.customer_id) ?? null : null,
    customerPermission: customerAllowed ? 'allowed' : 'forbidden',
    secondaryCustomerId: row.secondary_customer_id,
    secondaryCustomerName: row.secondary_customer_id ? names.get(row.secondary_customer_id) ?? null : null,
    secondaryCustomerPermission: customerAllowed ? 'allowed' : 'forbidden',
    contractName: draft.contractName ?? '',
    contractor: draft.contractor ?? '',
    region: draft.region ?? '',
    riskLevel: draft.riskLevel ?? '',
    address: draft.address ?? '',
    income: null,
    budget: null,
    updatedAt: row.updated_at,
    incomeMissingSource: 'production-receipts-not-ready',
  }
}
export function projectAttachment(row: Record<string, unknown>): FormAttachment {
  return { id: String(row.id), ownerType: 'project', ownerId: String(row.owner_id), fileName: String(row.file_name), filePath: '', fileSize: Number(row.file_size), mimeType: String(row.mime_type), category: String(row.category), uploader: String(row.uploader), uploadedAt: String(row.uploaded_at), deletedAt: row.deleted_at === null ? null : String(row.deleted_at) }
}
