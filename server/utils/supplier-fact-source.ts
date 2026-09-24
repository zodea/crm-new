import type { AuxiliaryContractDTO } from '../../app/lib/auxiliary-contract/contract'
import type { MaterialContractDetailSource, MaterialContractFactSources } from '../../app/lib/material-contract/repository'
import type { OtherSettlementDTO } from '../../app/lib/other-settlement/contract'
import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { SubcontractContractDetailSource, SubcontractContractFactSources } from '../../app/lib/subcontract-contract/repository'
import type { SupplierContractSourceRow, SupplierSettlementSourceRow } from '../../app/lib/supplier/repository'
import { round2 } from '../../app/lib/util/number'
import { auxiliaryContractInstance } from './auxiliary-contract-runtime'
import { resolveBusinessSession } from './business-session'
import { materialContractCommandTestInstance } from './material-contract-command-test-instance'
import { otherSettlementInstance } from './other-settlement-runtime'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { subcontractContractCommandTestInstance } from './subcontract-contract-command-test-instance'

interface SupplierFactSources {
  material: readonly Pick<MaterialContractDetailSource, 'dataOrigin' | 'id' | 'supplierId' | 'projectId' | 'no' | 'name' | 'kind' | 'amount' | 'supplementAmount' | 'signDate' | 'status'>[]
  materialFacts: Pick<MaterialContractFactSources, 'settlements'>
  subcontract: readonly Pick<SubcontractContractDetailSource, 'dataOrigin' | 'id' | 'supplierId' | 'projectId' | 'no' | 'name' | 'kind' | 'amount' | 'signDate' | 'status'>[]
  subcontractFacts: Pick<SubcontractContractFactSources, 'supplements'>
  auxiliary: readonly (Pick<AuxiliaryContractDTO, 'dataOrigin' | 'id' | 'kind' | 'draft'> & { amounts: Pick<AuxiliaryContractDTO['amounts'], 'contract' | 'changed'> })[]
  ownerDocuments: readonly Pick<OwnerCommercialDocumentSource, 'dataOrigin' | 'id' | 'kind' | 'supplierId' | 'projectId' | 'contractId' | 'no' | 'name' | 'documentType' | 'amount' | 'applicationDate' | 'status'>[]
  otherSettlements: readonly (Pick<OtherSettlementDTO, 'dataOrigin' | 'id' | 'draft'> & { amounts: Pick<OtherSettlementDTO['amounts'], 'total'> })[]
}

function numeric(value: string | number | null | undefined): number | null {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value)
}

/** 按各领域未分页读源组合；跨类型的同名、同号记录不用于建立关系。 */
export function projectSupplierFacts(source: SupplierFactSources): { contracts: SupplierContractSourceRow[], settlements: SupplierSettlementSourceRow[] } {
  const contracts: SupplierContractSourceRow[] = source.material.filter(row => row.supplierId).map(row => ({
    dataOrigin: row.dataOrigin,
    id: row.id,
    supplierId: row.supplierId,
    projectId: row.projectId,
    no: row.no,
    name: row.name,
    kind: row.kind,
    amount: row.amount,
    supplementAmount: row.supplementAmount,
    signDate: row.signDate,
    status: row.status,
  }))
  for (const row of source.subcontract.filter(row => row.supplierId)) {
    const supplements = source.subcontractFacts.supplements.filter(fact => fact.dataOrigin === row.dataOrigin && fact.contractId === row.id
      && !['draft', '草稿', '无效', '作废', 'cancelled'].includes(fact.status))
    contracts.push({
      dataOrigin: row.dataOrigin,
      id: row.id,
      supplierId: row.supplierId,
      projectId: row.projectId,
      no: row.no,
      name: row.name,
      kind: row.kind,
      amount: row.amount,
      supplementAmount: supplements.some(fact => fact.amount === null) ? null : round2(supplements.reduce((sum, fact) => sum + fact.amount!, 0)),
      signDate: row.signDate,
      status: row.status,
    })
  }
  for (const row of source.auxiliary.filter(row => row.kind === 'other_expense' && row.draft.supplierId)) {
    const base = numeric(row.amounts.contract)
    const changed = numeric(row.amounts.changed)
    contracts.push({
      dataOrigin: row.dataOrigin,
      id: row.id,
      supplierId: row.draft.supplierId ?? null,
      projectId: row.draft.projectId ?? null,
      no: row.draft.no ?? '',
      name: row.draft.name ?? '',
      kind: row.kind,
      amount: base,
      supplementAmount: base === null || changed === null ? null : round2(changed - base),
      signDate: row.draft.signDate || null,
      status: row.draft.status ?? '草稿',
    })
  }
  const settlements: SupplierSettlementSourceRow[] = []
  for (const row of source.materialFacts.settlements) {
    const contract = contracts.find(contract => contract.kind === '材采' && contract.id === row.contractId && contract.dataOrigin === row.dataOrigin)
    if (contract?.supplierId) {
      settlements.push({
        dataOrigin: row.dataOrigin,
        id: row.id,
        supplierId: contract.supplierId,
        projectId: contract.projectId,
        contractId: contract.id,
        no: row.no,
        name: row.name,
        settlementType: '材料采购结算',
        totalAmount: row.amount,
        settlementDate: row.date,
        status: row.status,
      })
    }
  }
  for (const row of source.ownerDocuments.filter(row => row.kind === 'sub_settlement' && row.supplierId)) {
    // 已保存的三方身份才进入供应商事实；不根据供应商名称或编号补关系。
    const contract = contracts.find(contract => contract.kind === '分包' && contract.id === row.contractId && contract.dataOrigin === row.dataOrigin
      && contract.supplierId === row.supplierId && contract.projectId === row.projectId)
    if (contract) {
      settlements.push({
        dataOrigin: row.dataOrigin,
        id: row.id,
        supplierId: row.supplierId!,
        projectId: row.projectId,
        contractId: row.contractId,
        no: row.no,
        name: row.name,
        settlementType: row.documentType,
        totalAmount: row.amount,
        settlementDate: row.applicationDate,
        status: row.status,
      })
    }
  }
  for (const row of source.otherSettlements.filter(row => row.draft.supplierId)) {
    const contract = contracts.find(contract => contract.kind === 'other_expense' && contract.id === row.draft.contractId && contract.dataOrigin === row.dataOrigin
      && contract.supplierId === row.draft.supplierId && contract.projectId === row.draft.projectId)
    if (contract) {
      settlements.push({
        dataOrigin: row.dataOrigin,
        id: row.id,
        supplierId: row.draft.supplierId!,
        projectId: row.draft.projectId ?? null,
        contractId: row.draft.contractId ?? null,
        no: row.draft.no ?? '',
        name: row.draft.name ?? '',
        settlementType: row.draft.settlementType ?? '其他支出结算',
        totalAmount: numeric(row.amounts.total),
        settlementDate: row.draft.settlementDate || null,
        status: row.draft.status ?? 'draft',
      })
    }
  }
  return { contracts, settlements }
}

export function supplierFactSource(sessionId?: string | null) {
  const workspaceId = resolveBusinessSession().workspaceId
  const auxiliary = auxiliaryContractInstance(sessionId).supplierReadSource(workspaceId)
  const other = otherSettlementInstance(sessionId).supplierReadSource(workspaceId)
  return {
    ...projectSupplierFacts({
      material: materialContractCommandTestInstance.rows(sessionId),
      materialFacts: materialContractCommandTestInstance.facts(sessionId),
      subcontract: subcontractContractCommandTestInstance.rows(),
      subcontractFacts: subcontractContractCommandTestInstance.facts(),
      auxiliary: auxiliary.rows,
      ownerDocuments: ownerCommercialDocumentCommandTestInstance.rows(sessionId),
      otherSettlements: other.rows,
    }),
    sourceVersion: [materialContractCommandTestInstance.sourceVersion(sessionId), subcontractContractCommandTestInstance.sourceVersion(), auxiliary.sourceVersion, ownerCommercialDocumentCommandTestInstance.sourceVersion(sessionId), other.sourceVersion].join(':'),
  }
}
