import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export const ACCEPTANCE_LIFECYCLE = [
  'draft',
  'submitted',
  'accepted',
  'warranty',
  'expired',
] as const

export type AcceptanceLifecycleStatus = typeof ACCEPTANCE_LIFECYCLE[number]

export interface ProjectAcceptanceLifecycleRow {
  id: string
  projectId: string
  contractId: string
  documentNo: string
  type: string
  name: string
  contractName: string
  documentDate: string
  contractEstimate: number
  effectiveEstimate: number
  acceptor: string
  warrantyOwner: string
  conclusion: string
  status: AcceptanceLifecycleStatus
  statusLabel: string
  lifecycleStage: number
  attachmentCount: number
  sourcePath: string
}

const STATUS_LABELS: Record<AcceptanceLifecycleStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  accepted: '已验收',
  warranty: '保修中',
  expired: '保修到期',
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

export async function loadProjectAcceptanceLifecycle(
  db: SoftDb,
): Promise<ProjectAcceptanceLifecycleRow[]> {
  const [acceptanceRows, attachmentRows] = await Promise.all([
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('project_acceptances', 'contracts')}
      SELECT acceptance.*, COALESCE(contract.name, '') AS contract_name
      FROM project_acceptances AS acceptance
      LEFT JOIN contracts AS contract
        ON contract.id = acceptance.contract_id
       AND contract.project_id = acceptance.project_id
       AND contract.kind = '施工'
       AND ${visibleCond('contracts', 'contract')}
      WHERE ${visibleCond('project_acceptances', 'acceptance')}
        AND acceptance.project_id IS NOT NULL
        AND (acceptance.contract_id IS NULL OR contract.id IS NOT NULL)
      ORDER BY acceptance.document_date DESC, acceptance.created_at DESC, acceptance.id
    `),
    db.select<Record<string, unknown>>(`
      SELECT file.owner_id, COUNT(*) AS attachment_count
      FROM file_refs AS file
      WHERE file.owner_type = 'project_acceptance'
        AND file.deleted_at IS NULL
      GROUP BY file.owner_id
    `),
  ])

  const attachmentCount = new Map(
    attachmentRows.map(row => [text(row.owner_id), number(row.attachment_count)]),
  )

  return acceptanceRows.map((row) => {
    const id = text(row.id)
    const status = text(row.status) as AcceptanceLifecycleStatus
    const lifecycleStage = ACCEPTANCE_LIFECYCLE.indexOf(status)
    const contractEstimate = number(row.contract_estimate)
    return {
      id,
      projectId: text(row.project_id),
      contractId: text(row.contract_id),
      documentNo: text(row.no),
      type: row.type === 'warranty' ? '保修确认' : '竣工验收',
      name: text(row.name),
      contractName: text(row.contract_name),
      documentDate: text(row.document_date),
      contractEstimate,
      effectiveEstimate: status === 'draft' ? 0 : contractEstimate,
      acceptor: text(row.acceptor),
      warrantyOwner: text(row.warranty_owner),
      conclusion: text(row.conclusion),
      status,
      statusLabel: STATUS_LABELS[status],
      lifecycleStage,
      attachmentCount: attachmentCount.get(id) ?? 0,
      sourcePath: `/owner/acceptance/${id}`,
    }
  })
}
