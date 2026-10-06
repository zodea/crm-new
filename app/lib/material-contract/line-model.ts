import type { ContractDeductionDraft, ContractLineItemDraft, ProjectContractFormDraft } from '../contract/forms'
import { round2 } from '../util/number'

/** 缺量价与真实零分别保留；协议原行变更只读取文书明确增额。 */
export function materialLineAmount(line: ContractLineItemDraft, supplement = false): number | null {
  if (supplement && line.originalLineId)
    return line.changeAmount ?? null
  if (line.qty == null || line.taxInclusiveUnitPrice == null)
    return null
  return round2(line.qty * line.taxInclusiveUnitPrice)
}

export function materialContractTotal(
  lines: readonly ContractLineItemDraft[],
  deductions: readonly ContractDeductionDraft[],
  supplement = false,
): number | null {
  const amounts = lines.map(line => materialLineAmount(line, supplement))
  if (amounts.some(value => value == null) || deductions.some(row => row.amount == null))
    return null
  return round2(amounts.reduce<number>((sum, amount) => sum + amount!, 0)
    - deductions.reduce((sum, row) => sum + row.amount!, 0))
}

export function validateMaterialDetails(
  lines: readonly ContractLineItemDraft[],
  deductions: readonly ContractDeductionDraft[],
  options: { formal: boolean, supplement: boolean, originalLineIds?: ReadonlySet<string> },
): void {
  const rowIds = lines.flatMap(row => row.id ? [row.id] : [])
  if (new Set(rowIds).size !== rowIds.length)
    throw new Error('采购明细行 ID 不能重复')
  for (const [index, row] of lines.entries()) {
    const label = `采购明细第 ${index + 1} 行`
    if (options.formal && (!row.materialName?.trim() || row.qty == null || row.taxInclusiveUnitPrice == null))
      throw new Error(`${label}不完整`)
    if (row.qty != null && (!Number.isFinite(row.qty) || row.qty <= 0))
      throw new Error(`${label}数量必须大于 0`)
    if (row.taxInclusiveUnitPrice != null && (!Number.isFinite(row.taxInclusiveUnitPrice) || row.taxInclusiveUnitPrice < 0))
      throw new Error(`${label}含税单价不能为负数`)
    if (row.applicableTaxRate != null && (!Number.isFinite(row.applicableTaxRate) || row.applicableTaxRate < 0))
      throw new Error(`${label}本行适用税点必须为非负有限数值`)
    if (row.qty != null && row.taxInclusiveUnitPrice != null && !Number.isFinite(row.qty * row.taxInclusiveUnitPrice))
      throw new Error(`${label}量价计算超出有效金额范围`)
    if (row.originalLineId) {
      if (!options.supplement || !options.originalLineIds?.has(row.originalLineId))
        throw new Error(`${label}原明细不属于选定主合同`)
      if (row.changeAmount != null && (!Number.isFinite(row.changeAmount) || row.changeAmount < 0))
        throw new Error(`${label}本次增额必须为非负有限金额`)
      if (options.formal && (row.changeAmount == null || !row.changeBasis?.trim()))
        throw new Error(`${label}须填写核实的本次增额及依据`)
    }
    else if (row.changeAmount != null) {
      throw new Error(`${label}新材料金额由数量和单价计算，不另填增额`)
    }
    if (row.source && (!row.source.quantityUnitVerified || !row.unit?.trim() || !row.source.priceUnit.trim()
      || row.unit.trim() !== row.source.priceUnit.trim())) {
      throw new Error(`${label}来源数量、单位及计价单位尚未核实`)
    }
  }
  const deductionIds = deductions.flatMap(row => row.id ? [row.id] : [])
  if (new Set(deductionIds).size !== deductionIds.length)
    throw new Error('减项 ID 不能重复')
  for (const [index, row] of deductions.entries()) {
    if (row.amount != null && (!Number.isFinite(row.amount) || row.amount <= 0))
      throw new Error(`减项第 ${index + 1} 行扣减金额必须大于 0`)
    if (options.formal && (!row.name?.trim() || row.amount == null || !row.basis?.trim()))
      throw new Error(`减项第 ${index + 1} 行须填写名称、扣减金额及依据`)
  }
}

/** 新来源或来源更正必须对上本合同实际保存的原件；未变旧证据继续保全。 */
export function validateMaterialSourceOriginals(lines: readonly ContractLineItemDraft[], prior: readonly ContractLineItemDraft[], originals: readonly { fileName: string, sha256: string }[]): void {
  for (const [index, line] of lines.entries()) {
    if (!line.source)
      continue
    const previous = line.id ? prior.find(row => row.id === line.id) : null
    if (previous?.source && JSON.stringify(previous.source) === JSON.stringify(line.source))
      continue
    if (!originals.some(original => original.fileName === line.source!.fileName && original.sha256 === line.source!.sourceHash))
      throw new Error(`采购明细第 ${index + 1} 行来源摘要与本合同实际原件不一致`)
  }
}

/** 读回只承接原提交得到的稳定行身份，后来的字段、增删与顺序全部保留。 */
export function reconcileMaterialDraftIdentities(current: ProjectContractFormDraft, submitted: ProjectContractFormDraft, persistedId: string, receipt: { id: string, lineIds?: string[], deductionIds?: string[] }): ProjectContractFormDraft {
  const lineIds = new Map((submitted.lineItems ?? []).flatMap((row, index) => row.id && receipt.lineIds?.[index] ? [[row.id, receipt.lineIds[index]!]] : []))
  const deductionIds = new Map((submitted.deductions ?? []).flatMap((row, index) => row.id && receipt.deductionIds?.[index] ? [[row.id, receipt.deductionIds[index]!]] : []))
  return {
    ...current,
    id: persistedId,
    lineItems: current.lineItems?.map(row => ({ ...row, ...(row.id && lineIds.has(row.id) ? { id: lineIds.get(row.id)! } : {}) })),
    deductions: current.deductions?.map(row => ({ ...row, ...(row.id && deductionIds.has(row.id) ? { id: deductionIds.get(row.id)! } : {}) })),
  }
}
