import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { OtherSettlementSourceDocument } from '../../app/lib/other-settlement/contract'
import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { approvalAmountLabel, readApprovalAmount } from '../../app/lib/finance/approval-amount'
import { isCoreMigrationMoney } from '../../app/lib/migration/core-contract'

function money(value: unknown): string | null {
  if (value == null)
    return null
  const result = typeof value === 'number' ? value.toFixed(2) : value
  if (!isCoreMigrationMoney(result))
    throw auxiliaryProblem('validation-failed', '源单金额无效')
  return result
}
export function migratedSettlementSource(entity: CoreMigrationServerEntityDTO, entities: CoreMigrationServerEntityDTO[]): OtherSettlementSourceDocument {
  const kind = entity.attributes.kind
  if (kind !== 'application' && kind !== 'payment')
    throw auxiliaryProblem('validation-failed', '付款源单类型无效')
  const a = entity.attributes
  const approvalValue = money(a.approvedAmount)
  const approval = readApprovalAmount(approvalValue === null ? null : Number(approvalValue), a.approvedAmountOrigin === 'user-entry' ? 'user-entry' : 'legacy')
  if (kind === 'application' && entity.references.contractId) {
    const contract = entities.find(e => e.entityType === 'auxiliary_contracts' && !e.deletedAt && e.id === entity.references.contractId && e.attributes.kind === 'other_expense')
    if (!contract || contract.references.projectId !== entity.references.projectId || contract.references.supplierId !== entity.references.supplierId)
      throw auxiliaryProblem('relationship-mismatch', '付款申请的合同、项目或分供方不一致')
  }
  const fields = kind === 'application'
    ? { biz_type: '付款业务类型', applicant: '申请人', invoice_state: '发票状态', pay_content: '付款内容', approvedAmount: '批复金额', approvedAmountStatus: '批复金额说明', prepay_note: '预付款扣回说明', approval_note: '批复说明', external_ref: '外部编号', note: '备注', created_at: '创建时间', updated_at: '更新时间' }
    : { payee_name: '收款人', payment_method: '支付方式', purpose: '用途', voucher_no: '凭证号', bank_serial_no: '银行流水号', handler: '经办人', confirmed_by: '确认人', confirmed_at: '确认时间', note: '备注', created_at: '创建时间', updated_at: '更新时间' }
  const allocations: unknown = JSON.parse(String(a.allocationsJson ?? '[]'))
  if (!Array.isArray(allocations))
    throw auxiliaryProblem('validation-failed', '源单分配事实无效')
  const files: unknown = JSON.parse(String(a.filesJson ?? '[]'))
  if (!Array.isArray(files) || !files.every(f => f && typeof f.id === 'string' && typeof f.fileName === 'string' && Number.isSafeInteger(f.fileSize) && f.fileSize >= 0))
    throw auxiliaryProblem('validation-failed', '源单附件元数据无效')
  const seen = new Set<string>()
  return {
    id: entity.id,
    kind,
    no: String(a.no ?? ''),
    name: entity.name,
    status: String(a.status ?? ''),
    amount: money(entity.amount),
    date: String(a[kind === 'application' ? 'apply_date' : 'payment_date'] ?? '') || null,
    projectId: entity.references.projectId ?? null,
    contractId: entity.references.contractId ?? null,
    supplierId: entity.references.supplierId ?? null,
    fields: Object.entries(fields).map(([key, label]) => ({ label: label!, value: key === 'approvedAmount' ? money(approval.amount) : key === 'approvedAmountStatus' ? approvalAmountLabel(approval.state) : a[key] == null ? null : String(a[key]) })),
    allocations: allocations.map((raw) => {
      if (!raw || typeof raw.id !== 'string' || !raw.id || seen.has(raw.id) || typeof raw.targetId !== 'string')
        throw auxiliaryProblem('validation-failed', '源单分配身份无效或重复')
      seen.add(raw.id)
      const target = entities.find(row => !row.deletedAt && (kind === 'application' ? row.entityType === 'other_settlements' && row.legacyId === raw.targetId : row.entityType === 'other_settlement_sources' && row.legacyId === `application:${raw.targetId}`))
      if (target && ['projectId', 'supplierId', 'contractId'].some(key => entity.references[key as keyof typeof entity.references] && entity.references[key as keyof typeof entity.references] !== target.references[key as keyof typeof target.references]))
        throw auxiliaryProblem('relationship-mismatch', '源单与分配目标的项目、分供方或合同关系不一致')
      return { id: raw.id, targetId: target?.id ?? null, kind: kind === 'application' ? 'settlement' : 'application', amount: money(raw.amount), effective: raw.deletedAt == null, unavailableReason: target ? null : '该分配目标尚无有效中央身份' }
    }),
    files: files.filter(f => f.deletedAt == null).map(f => ({ id: `${entity.id}:${f.id}`, fileName: f.fileName, fileSize: f.fileSize, uploader: String(f.uploader ?? ''), uploadedAt: String(f.uploadedAt ?? '') })),
  }
}
export function penaltySettlementSource(penalty: OwnerCommercialDocumentSource): OtherSettlementSourceDocument {
  const origins: Record<string, string> = { project: '项目罚扣', inspection: '巡检', owner_notice: '甲方通知', acceptance: '验收' }
  if (penalty.projectPermission === 'forbidden' || penalty.supplierPermission === 'forbidden' || penalty.contractPermission === 'forbidden')
    throw auxiliaryProblem('forbidden', '无权访问关联罚扣源单')
  return {
    id: penalty.id,
    kind: 'penalty',
    no: penalty.no,
    name: penalty.name,
    status: penalty.status,
    amount: money(penalty.amount),
    date: penalty.applicationDate,
    projectId: penalty.projectId,
    contractId: penalty.contractId,
    supplierId: penalty.supplierId ?? null,
    fields: [{ label: '罚扣来源', value: origins[penalty.penaltyFacts?.origin ?? ''] ?? penalty.penaltyFacts?.origin ?? null }, { label: '罚扣原因', value: penalty.penaltyReason || penalty.name }, { label: '通知单号', value: penalty.noticeNo || null }, { label: '整改期限', value: penalty.penaltyFacts?.deadline ?? null }, { label: '整改说明', value: penalty.penaltyFacts?.rectificationNote ?? null }, { label: '扣款方式', value: penalty.penaltyFacts?.deductionMethod ?? null }, { label: '备注', value: penalty.note }, { label: '创建时间', value: penalty.createdAt }, { label: '更新时间', value: penalty.updatedAt }],
    allocations: (penalty.penaltyDeductions ?? []).map(d => ({ id: d.id, targetId: d.settlementId, kind: 'settlement', amount: money(d.amount), effective: true, unavailableReason: null })),
    files: penalty.files.filter(f => !f.deletedAt).map(f => ({ id: f.id, fileName: f.fileName, fileSize: f.fileSize, uploader: f.uploader, uploadedAt: f.uploadedAt ?? '' })),
  }
}
