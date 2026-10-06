import { isISODateTimeDTO } from '../../types/read-model'

export interface ConstructionManagementFeeSnapshot {
  version: string
  amount: number | null
  basis: string
  contractVersion: string
  adoptedAt: string
  actorId: string | null
  commandId: string | null
}

export interface ConstructionManagementFeeConfiguration {
  amount: number | null
  basis: string
  version: string | null
  history: ConstructionManagementFeeSnapshot[]
}

export function emptyConstructionManagementFee(): ConstructionManagementFeeConfiguration {
  return { amount: null, basis: '', version: null, history: [] }
}

export function validateConstructionManagementFee(amount: unknown, basis: unknown): void {
  if (!(amount === null || (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)))
    throw new Error('总合同管理费金额必须为非负有限数值或 null')
  if (typeof basis !== 'string')
    throw new Error('总合同管理费依据必须是文本')
}

/** 只保存合同明确配置，不推导成本、现金或工资。省略字段的旧请求保全既有配置。 */
export function adoptConstructionManagementFee(
  prior: ConstructionManagementFeeConfiguration,
  input: { managementFeeAmount?: number | null, managementFeeBasis?: string },
  evidence: Omit<ConstructionManagementFeeSnapshot, 'amount' | 'basis'>,
): ConstructionManagementFeeConfiguration {
  const amount = input.managementFeeAmount === undefined ? prior.amount : input.managementFeeAmount
  const basis = input.managementFeeBasis === undefined ? prior.basis : input.managementFeeBasis
  validateConstructionManagementFee(amount, basis)
  if (amount === prior.amount && basis === prior.basis)
    return structuredClone(prior)
  const snapshot = { ...evidence, amount, basis }
  if (!evidence.version || prior.history.some(row => row.version === evidence.version)
    || !evidence.contractVersion || !isISODateTimeDTO(evidence.adoptedAt)) {
    throw new Error('总合同管理费采用版本或时间无效')
  }
  return { amount, basis, version: evidence.version, history: [...structuredClone(prior.history), snapshot] }
}

export function decodeConstructionManagementFee(value: unknown): ConstructionManagementFeeConfiguration {
  const object = (row: unknown): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row)
  const fail = (): never => {
    throw new Error('总合同管理费配置或冻结历史无效')
  }
  if (!object(value) || Object.keys(value).length !== 4 || !['amount', 'basis', 'version', 'history'].every(key => key in value)
    || !(value.version === null || (typeof value.version === 'string' && !!value.version)) || !Array.isArray(value.history)) {
    return fail()
  }
  validateConstructionManagementFee(value.amount, value.basis)
  const seen = new Set<string>()
  for (const row of value.history) {
    if (!object(row) || Object.keys(row).length !== 7
      || !['version', 'amount', 'basis', 'contractVersion', 'adoptedAt', 'actorId', 'commandId'].every(key => key in row)
      || typeof row.version !== 'string' || !row.version || seen.has(row.version)
      || typeof row.contractVersion !== 'string' || !row.contractVersion || !isISODateTimeDTO(row.adoptedAt)
      || !(row.actorId === null || (typeof row.actorId === 'string' && !!row.actorId))
      || !(row.commandId === null || (typeof row.commandId === 'string' && !!row.commandId))) {
      return fail()
    }
    validateConstructionManagementFee(row.amount, row.basis)
    seen.add(row.version)
  }
  const current = value.history.find(row => object(row) && row.version === value.version)
  if (value.version === null ? (value.amount !== null || value.basis !== '') : (!object(current) || current.amount !== value.amount || current.basis !== value.basis))
    return fail()
  return structuredClone(value) as unknown as ConstructionManagementFeeConfiguration
}
