import type { WorkerRosterArchiveSummary } from '../worker-roster/contract'
import type { PayrollQuery, PayrollWritableContext } from './central-contract'
import type { PayrollOfficialIssue } from './central-numbering-contract'
import type { PayrollWorkbookGap, PayrollWorkbookGroup } from './complete-workbook'

export interface PayrollWorkbookInput {
  projectId: string
  mode: 'leader-cycle' | 'project-month'
  statementIds: string[]
  rosterArchiveId: string | null
}
/** 工资正文缺口与文件交付缺口分开，缺照片不能抹去可证明的公式金额。 */
export interface PayrollWorkbookDeliveryGap {
  kind: 'numbering' | 'roster' | 'actual'
  statementId: string | null
  reason: string
}
export interface PayrollWorkbookRosterRef {
  id: string
  version: number
  registeredOn: string
  sourceVersion: string
  /** 不含会话 context 的固定名册正文摘要；公开目录不包含私密正文。 */
  contentHash: string
}
export interface PayrollWorkbookPreview {
  context: PayrollWritableContext
  input: PayrollWorkbookInput
  sourceVersion: string
  projectName: string
  groups: PayrollWorkbookGroup[]
  gaps: PayrollWorkbookGap[]
  deliveryGaps: PayrollWorkbookDeliveryGap[]
  issues: PayrollOfficialIssue[]
  roster: WorkerRosterArchiveSummary | null
  rosterRef: PayrollWorkbookRosterRef | null
  eligibility: { canSave: boolean, reasons: string[] }
}
/** 不可变输出目录。保存只证明目录已固定，不证明文件已成功下载。 */
export interface PayrollWorkbookArchive {
  /** manifestHash 仍标识原目录；本代身份由服务器完整迁入证明映射。 */
  migration?: { originalId: string, originalContentHash: string }
  context: PayrollWritableContext
  schemaVersion: 1
  id: string
  version: number
  createdAt: string
  createdBy: string
  sourceVersion: string
  input: PayrollWorkbookInput
  projectName: string
  groups: PayrollWorkbookGroup[]
  gaps: PayrollWorkbookGap[]
  deliveryGaps: PayrollWorkbookDeliveryGap[]
  issues: PayrollOfficialIssue[]
  rosterRef: PayrollWorkbookRosterRef | null
  manifestHash: string
  completeness: 'complete' | 'partial'
}
export interface PayrollWorkbookArchiveSummary {
  id: string
  version: number
  mode: PayrollWorkbookInput['mode']
  projectId: string
  statementIds: string[]
  createdAt: string
  completeness: PayrollWorkbookArchive['completeness']
  rosterRef: PayrollWorkbookRosterRef | null
}
export interface PayrollWorkbookCommand {
  schemaVersion: 1
  commandId: string
  workspaceId: string
  actorId: string
  origin: 'real'
  requiredCapability: 'payroll:write'
  sourceVersion: string
  input: PayrollWorkbookInput
  action: 'archive'
}
export interface PayrollWorkbookResult { commandId: string, archiveId: string, version: number, manifestHash: string }
export type PayrollWorkbookResolution = { state: 'applied', result: PayrollWorkbookResult } | { state: 'not-applied' }
export interface PayrollWorkbookRepository {
  workbookPreview: (query: PayrollQuery, input: PayrollWorkbookInput) => Promise<PayrollWorkbookPreview>
  workbookArchives: (query: PayrollQuery, input: { projectId: string }) => Promise<PayrollWorkbookArchiveSummary[]>
  workbookArchive: (query: PayrollQuery, input: { projectId: string, archiveId: string }) => Promise<PayrollWorkbookArchive>
  executeWorkbook: (command: PayrollWorkbookCommand) => Promise<PayrollWorkbookResult>
  resolveWorkbook: (commandId: string, projectId: string) => Promise<PayrollWorkbookResolution>
}
