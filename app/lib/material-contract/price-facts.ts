import type { DataOriginDTO, ReadMetaDTO } from '../../types/read-model'
import type { MaterialContractDetailSource, MaterialContractFactSources } from './read-contract'
import { isISODateDTO } from '../../types/read-model'
import { isEffectiveExpenditureContract } from '../contract/effective-status'
import { convertOriginalPrice } from '../material/price-comparison'
import { hasConsistentReadMeta } from '../read-model/meta'
import { materialContractProblem, MaterialContractRepositoryProblem } from './read-contract'

export interface ContractPriceFact {
  dataOrigin: DataOriginDTO
  contractId: string
  lineId: string
  parentContractId: string | null
  contractName: string
  contractNo: string
  supplierId: string | null
  supplierName: string | null
  projectId: string | null
  projectName: string | null
  date: string | null
  materialName: string
  spec: string
  materialGrade: string
  unit: string
  quantity: number | null
  taxInclusiveUnitPrice: number | null
  applicableTaxRate: number | null
}

export interface ContractPriceRead {
  dataOrigin: DataOriginDTO
  items: ContractPriceFact[]
  asOf: string
  sourceVersion: string | null
  capabilities: string[]
  meta: ReadMetaDTO
}

const known = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value : null

/** Only projects the original owner rows; it never creates a second editable price store. */
export function buildContractPriceFacts(contracts: readonly MaterialContractDetailSource[], facts: MaterialContractFactSources): ContractPriceFact[] {
  const parents = new Map(contracts.filter(row => row.kind === '材采' && isEffectiveExpenditureContract(row.status)).map(row => [`${row.dataOrigin}:${row.id}`, row]))
  return facts.lineItems.flatMap((line) => {
    const parent = parents.get(`${line.dataOrigin}:${line.contractId}`)
    const supplement = facts.supplements?.find(row => row.dataOrigin === line.dataOrigin && row.id === line.contractId && isEffectiveExpenditureContract(row.status))
    const original = supplement ? parents.get(`${supplement.dataOrigin}:${supplement.contractId}`) : parent
    if (!original || !line.id || !line.materialName.trim())
      return []
    return [{ dataOrigin: line.dataOrigin, contractId: line.contractId, lineId: line.id, parentContractId: supplement?.contractId ?? null, contractName: supplement?.name ?? original.name, contractNo: supplement?.no ?? original.no, supplierId: original.supplierReferenceState === 'forbidden' ? null : original.supplierId, supplierName: original.supplierReferenceState === 'resolved' ? original.supplierName : null, projectId: original.projectReferenceState === 'forbidden' ? null : original.projectId, projectName: original.projectReferenceState === 'resolved' ? original.projectName : null, date: supplement?.signDate ?? original.signDate, materialName: line.materialName, spec: line.spec, materialGrade: line.materialGrade ?? '', unit: line.unit, quantity: known(line.qty), taxInclusiveUnitPrice: known(line.taxInclusiveUnitPrice), applicableTaxRate: known(line.applicableTaxRate) }]
  })
}

const strings = ['contractId', 'lineId', 'contractName', 'contractNo', 'materialName', 'spec', 'materialGrade', 'unit'] as const
export function decodeContractPriceRead(value: unknown, origin: DataOriginDTO): ContractPriceRead {
  const object = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input)
  const invalid = (): never => {
    throw new MaterialContractRepositoryProblem(materialContractProblem('internal-error', '合同约定价来源、身份或税点响应无效'))
  }
  if (!object(value) || value.dataOrigin !== origin || !Array.isArray(value.items) || !hasConsistentReadMeta(value, 'material-contract-prices-v1', origin))
    return invalid()
  const ids = new Set<string>()
  for (const row of value.items) {
    if (!object(row) || row.dataOrigin !== origin || strings.some(key => typeof row[key] !== 'string')
      || !row.contractId || !row.lineId || ['parentContractId', 'supplierId', 'supplierName', 'projectId', 'projectName'].some(key => row[key] !== null && typeof row[key] !== 'string')
      || !(row.date === null || isISODateDTO(row.date))
      || ['quantity', 'taxInclusiveUnitPrice', 'applicableTaxRate'].some(key => row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || Number(row[key]) < 0))) {
      return invalid()
    }
    const key = JSON.stringify([row.dataOrigin, row.contractId, row.lineId])
    if (ids.has(key))
      return invalid()
    ids.add(key)
  }
  return value as unknown as ContractPriceRead
}

export interface ContractPriceConversion {
  unit: string
  factor: number
  basis: string
}
/** 1 original unit = factor comparison units; unknown quantity and zero remain distinct. */
export function compareContractPrice(fact: ContractPriceFact, conversion?: ContractPriceConversion) {
  return { original: fact, ...convertOriginalPrice({ unit: fact.unit, quantity: fact.quantity, unitPrice: fact.taxInclusiveUnitPrice }, conversion) }
}

export function contractPriceSourceLink(row: ContractPriceFact, native = false) {
  if (native && row.parentContractId)
    return `/contract/material/form/${encodeURIComponent(row.contractId)}?supplement=1`
  const query = new URLSearchParams()
  if (!native) {
    query.set('contractKind', 'material')
    query.set('origin', row.dataOrigin)
  }
  if (row.parentContractId) {
    query.set('tab', 'supplements')
    query.set('supplementId', row.contractId)
  }
  return `/contract/${encodeURIComponent(row.parentContractId ?? row.contractId)}${query.size ? `?${query}` : ''}`
}
