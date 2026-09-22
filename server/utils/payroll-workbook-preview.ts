import type { PayrollWorkbookInput, PayrollWorkbookPreview, PayrollWorkbookRosterRef } from '../../app/lib/payroll/central-workbook-contract'
import type { PayrollWorkbookGroup } from '../../app/lib/payroll/complete-workbook'
import type { WorkerRosterArchive } from '../../app/lib/worker-roster/contract'
import type { PayrollWorkbookReaders } from './payroll-workbook-service'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollWorkbookSubjectKey, payrollWorkbookSubjectLabel } from '../../app/lib/payroll/workbook-subject'
import { WORKER_PRIVATE_READ } from '../../app/lib/worker-roster/contract'
import { workbookHash } from './payroll-workbook-storage'

export const workbookRosterHash = (archive: WorkerRosterArchive) => workbookHash(Object.fromEntries(Object.entries(archive).filter(([key]) => key !== 'context')))
export async function verifyWorkbookRoster(readers: PayrollWorkbookReaders, input: PayrollWorkbookInput, expected?: PayrollWorkbookRosterRef | null) {
  if (!input.rosterArchiveId)
    return null
  const archive = await readers.roster().archive(input.projectId, input.rosterArchiveId)
  if (!archive.context.capabilities.includes(WORKER_PRIVATE_READ) || archive.scope.projectId !== input.projectId || archive.id !== input.rosterArchiveId
    || workbookHash([...archive.scope.statementIds].sort()) !== workbookHash(input.statementIds)) {
    throw payrollProblem('relationship-mismatch', '名册版本必须属于同项目及完全相同的原工资范围')
  }
  const reference: PayrollWorkbookRosterRef = { id: archive.id, version: archive.version, registeredOn: archive.scope.registeredOn, sourceVersion: archive.sourceVersion, contentHash: workbookRosterHash(archive) }
  if (expected && workbookHash(reference) !== workbookHash(expected))
    throw payrollProblem('unavailable', '固定名册版本与目录摘要不一致，输出已停止')
  for (const member of archive.members) {
    for (const photo of member.photos.filter(photo => photo.state === 'available')) {
      const file = await readers.roster().file({ projectId: input.projectId, archiveId: archive.id, workerId: member.workerId, assetId: photo.id })
      if (file.asset.sha256 !== photo.sha256 || file.asset.workerId !== member.workerId || file.asset.id !== photo.id)
        throw payrollProblem('unavailable', '固定照片原件与名册关系不一致，输出已停止')
    }
  }
  return { archive, reference }
}

/** 在同一个工作区事务中组合原工资/实际账/独立名册；不新建任何来源事实。 */
export async function previewPayrollWorkbook(readers: PayrollWorkbookReaders, input: PayrollWorkbookInput): Promise<PayrollWorkbookPreview> {
  const query = { origin: 'real' as const, projectId: input.projectId }
  const listing = await readers.payroll.list(query)
  const rows = input.statementIds.map(id => listing.rows.find(row => row.id === id))
  if (rows.some(row => !row || row.projectId !== input.projectId || row.status !== 'released' || row.hidden || row.deletedAt || !['A', 'C1', 'C2'].includes(row.formatFamily)))
    throw payrollProblem('relationship-mismatch', '输出范围只能包含同项目的可见已发 A/C1/C2 原工资')
  const selected = rows.filter(row => !!row)
  if (input.mode === 'leader-cycle' && new Set(selected.map(payrollWorkbookSubjectKey)).size !== 1)
    throw payrollProblem('validation-failed', '全周期一册须选择同一负责人、格式及普通或管理请款簿')
  const groups: PayrollWorkbookGroup[] = []
  const gaps: PayrollWorkbookPreview['gaps'] = []
  const deliveryGaps: PayrollWorkbookPreview['deliveryGaps'] = []
  const issues: PayrollWorkbookPreview['issues'] = []
  const keys = [...new Set(selected.map(row => input.mode === 'project-month' ? row.month : payrollWorkbookSubjectKey(row)))].sort()
  for (const key of keys) {
    const members = selected.filter(row => (input.mode === 'project-month' ? row.month : payrollWorkbookSubjectKey(row)) === key).sort((a, b) => `${a.month}:${a.releasedAt}:${a.id}`.localeCompare(`${b.month}:${b.releasedAt}:${b.id}`))
    const entries: PayrollWorkbookGroup['entries'] = []
    for (const row of members) {
      const read = await readers.payroll.numbering(query, { projectId: input.projectId, statementId: row.id })
      if (read.document)
        entries.push({ row, document: read.document })
      else gaps.push({ statementId: row.id, month: row.month, formatFamily: row.formatFamily, reason: '缺少可证明的原冻结工资正文；不能按当前来源补表' })
      if (read.issue && read.eligibility.canDownload)
        issues.push(read.issue)
      else deliveryGaps.push({ kind: 'numbering', statementId: row.id, reason: '原工资尚无可证明的正式编号；请从原单正式出具，目录保存不会发号' })
    }
    const actualLedger = await readers.payroll.actualLedger(query, { projectId: input.projectId, originalStatementIds: members.map(row => row.id) })
    groups.push({ key, label: input.mode === 'project-month' ? key : payrollWorkbookSubjectLabel(members[0]!), entries, actualLedger })
    if (actualLedger.status !== 'complete')
      deliveryGaps.push({ kind: 'actual', statementId: null, reason: `${key} 实际收付仍有不可证明部分，金额保持原未知状态` })
  }
  const rosterRead = await verifyWorkbookRoster(readers, input)
  if (!rosterRead) {
    deliveryGaps.push({ kind: 'roster', statementId: null, reason: '未关联独立有日期的名册版本，工资资料不代表实名及照片齐全' })
  }
  else {
    for (const reason of rosterRead.archive.members.flatMap(member => member.diagnostics))
      deliveryGaps.push({ kind: 'roster', statementId: null, reason })
  }
  const roster = rosterRead ? { id: rosterRead.archive.id, version: rosterRead.archive.version, projectId: input.projectId, registeredOn: rosterRead.archive.scope.registeredOn, createdAt: rosterRead.archive.createdAt, statementIds: rosterRead.archive.scope.statementIds, memberCount: rosterRead.archive.members.length, gapCount: rosterRead.archive.members.reduce((sum, member) => sum + member.diagnostics.length, 0) } : null
  const base = { input, projectName: groups.flatMap(group => group.entries)[0]?.document.projectName ?? selected[0]?.projectName ?? input.projectId, groups, gaps, deliveryGaps, issues, roster, rosterRef: rosterRead?.reference ?? null }
  const reasons = [...(!listing.context.capabilities.includes('payroll:write') ? ['当前身份只能阅读输出目录'] : []), ...(!groups.some(group => group.entries.length) ? ['没有可用的冻结工资正文'] : [])]
  const sourceVersion = workbookHash(Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'roster')))
  return { ...base, sourceVersion, context: { ...listing.context, readonly: !listing.context.capabilities.includes('payroll:write'), sourceVersion }, eligibility: { canSave: reasons.length === 0, reasons } }
}
