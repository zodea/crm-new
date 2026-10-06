import type { DataOriginDTO, NavigationIntentDTO } from '../../types/read-model'
import type { ConstructionManagementFeeConfiguration } from '../construction-contract/management-fee'
import type { ConstructionContractDetailSource } from '../construction-contract/read-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { decodeConstructionManagementFee, emptyConstructionManagementFee } from '../construction-contract/management-fee'

export interface ProjectConstructionManagementFeeRead {
  projectId: string
  dataOrigin: DataOriginDTO
  state: 'complete' | 'forbidden' | 'unavailable'
  sourceVersion: string | null
  asOf: string | null
  reason: string | null
  contracts: Array<{
    id: string
    no: string
    name: string
    status: string
    configuration: ConstructionManagementFeeConfiguration
    navigation: NavigationIntentDTO
  }>
}

export function unavailableProjectConstructionManagementFees(projectId: string, dataOrigin: DataOriginDTO, state: 'forbidden' | 'unavailable' = 'unavailable'): ProjectConstructionManagementFeeRead {
  return { projectId, dataOrigin, state, sourceVersion: null, asOf: null, reason: state === 'forbidden' ? '无总合同配置查看权限' : '总合同配置来源尚未接入当前读取服务', contracts: [] }
}

/** 每份总合同独立呈现配置及冻结证据；不合成实际成本或现金。 */
export function projectConstructionManagementFees(input: { projectId: string, dataOrigin: DataOriginDTO, sourceVersion: string, asOf: string, contracts: readonly Pick<ConstructionContractDetailSource, 'id' | 'no' | 'name' | 'kind' | 'projectId' | 'projectPermission' | 'dataOrigin' | 'status' | 'managementFee'>[] }): ProjectConstructionManagementFeeRead {
  if (!input.sourceVersion || !isISODateTimeDTO(input.asOf))
    throw new Error('项目总合同管理费配置来源证明无效')
  return {
    projectId: input.projectId,
    dataOrigin: input.dataOrigin,
    state: 'complete',
    sourceVersion: input.sourceVersion,
    asOf: input.asOf,
    reason: null,
    contracts: input.contracts.filter(row => row.kind === '施工' && row.projectId === input.projectId && row.projectPermission === 'allowed' && row.dataOrigin === input.dataOrigin).map(row => ({
      id: row.id,
      no: row.no,
      name: row.name,
      status: row.status,
      configuration: row.managementFee ? decodeConstructionManagementFee(row.managementFee) : emptyConstructionManagementFee(),
      navigation: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'contract', id: row.id, label: row.name, no: row.no || null }, variant: 'detail', view: null, filters: { dataOrigin: row.dataOrigin, contractKind: '施工' } } satisfies NavigationIntentDTO,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  }
}

export function isProjectConstructionManagementFeeRead(value: unknown, projectId: string, dataOrigin: DataOriginDTO): value is ProjectConstructionManagementFeeRead {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const read = value as ProjectConstructionManagementFeeRead
  if (read.projectId !== projectId || read.dataOrigin !== dataOrigin || !['complete', 'forbidden', 'unavailable'].includes(read.state) || !Array.isArray(read.contracts))
    return false
  if (read.state !== 'complete')
    return read.contracts.length === 0 && read.sourceVersion === null && read.asOf === null && typeof read.reason === 'string' && !!read.reason
  if (!read.sourceVersion || !isISODateTimeDTO(read.asOf) || read.reason !== null)
    return false
  const seen = new Set<string>()
  try {
    for (const row of read.contracts) {
      if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id) || !['no', 'name', 'status'].every(key => typeof row[key as keyof typeof row] === 'string'))
        return false
      seen.add(row.id)
      decodeConstructionManagementFee(row.configuration)
      const target = row.navigation
      if (target.kind !== 'entity-detail' || target.subject.state !== 'resolved' || target.subject.entity !== 'contract' || target.subject.id !== row.id
        || target.subject.label !== row.name || target.subject.no !== (row.no || null) || target.variant !== 'detail' || target.view !== null
        || target.filters?.dataOrigin !== dataOrigin || target.filters?.contractKind !== '施工') {
        return false
      }
    }
    return true
  }
  catch { return false }
}
