import type { ScheduleBindingRead } from './central-binding-contract'
import { scheduleProblem } from './central-contract'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(row => typeof row === 'string')
const quantity = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))
function measure(value: unknown): boolean {
  return object(value) && quantity(value.value) && quantity(value.knownValue) && typeof value.unitMissing === 'boolean'
    && Number.isSafeInteger(value.sourceCount) && Number(value.sourceCount) >= 0 && Number.isSafeInteger(value.missingCount)
    && Number(value.missingCount) >= 0 && Number(value.missingCount) <= Number(value.sourceCount)
    && (value.completeness === 'complete' ? value.value !== null && value.missingCount === 0 && !value.unitMissing : value.completeness === 'partial' && value.value === null)
}
function preview(value: unknown, projectId: string, groupId: string, contractId: string): boolean {
  if (!object(value) || value.projectId !== projectId || value.groupId !== groupId || value.contractId !== contractId
    || !['groupName', 'contractName', 'contractNo'].every(key => typeof value[key] === 'string')
    || !texts(value.blockers) || !texts(value.warnings) || value.canBind !== (value.blockers.length === 0)
    || !Array.isArray(value.buildings) || !Array.isArray(value.extraContractBuildings) || !Array.isArray(value.items)) {
    return false
  }
  if (![...value.buildings, ...value.extraContractBuildings].every(row => object(row) && typeof row.id === 'string' && row.id && typeof row.code === 'string' && typeof row.name === 'string'
    && typeof row.covered === 'boolean' && Number.isSafeInteger(row.contractLineCount) && Number(row.contractLineCount) >= 0)) {
    return false
  }
  const seen = new Set<string>()
  return value.items.every((row) => {
    if (!object(row) || !['id', 'code', 'name', 'unit'].every(key => typeof row[key] === 'string') || !row.id || typeof row.mapped !== 'boolean'
      || !measure(row.provisional) || !measure(row.contract) || !quantity(row.differenceQty) || !texts(row.reasons) || !texts(row.floorPlanIds) || !texts(row.contractLineIds)) {
      return false
    }
    const key = JSON.stringify([row.id, row.unit])
    if (seen.has(key))
      return false
    seen.add(key)
    const left = row.provisional as { value: number | null, unitMissing: boolean }
    const right = row.contract as { value: number | null, unitMissing: boolean }
    if (left.unitMissing !== (String(row.unit).trim() === '') || right.unitMissing !== (String(row.unit).trim() === ''))
      return false
    return row.differenceQty === null || (left.value !== null && right.value !== null && row.differenceQty === right.value - left.value)
  })
}

/** 身份及完整性一起解码，拒绝串组、单位缺失却伪装确定差值的响应。 */
export function decodeScheduleBindingRead(value: unknown, projectId: string, groupId: string, contractId: string): ScheduleBindingRead {
  const invalid = () => {
    throw scheduleProblem('unavailable', '绑定服务返回了错配或不完整事实，请保留选择并重新读取')
  }
  if (!object(value) || !object(value.group) || value.group.id !== groupId || value.group.projectId !== projectId || typeof value.group.name !== 'string'
    || !Array.isArray(value.contracts) || value.contracts.some(row => !object(row) || row.projectId !== projectId || typeof row.id !== 'string')) {
    return invalid()
  }
  if (value.state === 'unbound') {
    if (value.group.scopeBasis !== 'provisional' || value.group.contractId !== null || value.binding !== null
      || (contractId ? !preview(value.preview, projectId, groupId, contractId) : value.preview !== null)) {
      return invalid()
    }
  }
  else if (value.state === 'bound') {
    const binding = value.binding
    if (value.group.scopeBasis !== 'contract' || typeof value.group.contractId !== 'string' || !value.group.contractId || (contractId && value.group.contractId !== contractId)
      || value.preview !== null || !object(binding) || binding.contractId !== value.group.contractId || typeof binding.contractName !== 'string' || typeof binding.contractNo !== 'string'
      || !['boundAt', 'actorId', 'sourceVersion'].every(key => binding[key] === null || typeof binding[key] === 'string')
      || typeof binding.legacyDetailMissing !== 'boolean' || (binding.legacyDetailMissing ? binding.preview !== null : !preview(binding.preview, projectId, groupId, binding.contractId as string))) {
      return invalid()
    }
  }
  else { return invalid() }
  return structuredClone(value) as unknown as ScheduleBindingRead
}
