import type { QuantityMeasureTotal } from '../quantity/totals'
import type { ScheduleReadContext } from './central-contract'
import type { ScheduleContractBindingBuilding } from './contract-binding'
import type { ScheduleContractOption, ScheduleScopeBasis } from './read-model'

export interface ScheduleBindingItem {
  id: string
  code: string
  name: string
  unit: string
  mapped: boolean
  provisional: QuantityMeasureTotal
  contract: QuantityMeasureTotal
  differenceQty: number | null
  reasons: string[]
  floorPlanIds: string[]
  contractLineIds: string[]
}

export interface ScheduleBindingPreview {
  groupId: string
  groupName: string
  projectId: string
  contractId: string
  contractNo: string
  contractName: string
  buildings: ScheduleContractBindingBuilding[]
  extraContractBuildings: ScheduleContractBindingBuilding[]
  items: ScheduleBindingItem[]
  blockers: string[]
  warnings: string[]
  canBind: boolean
}

export interface ScheduleBindingRecord {
  contractId: string
  contractNo: string
  contractName: string
  boundAt: string | null
  actorId: string | null
  sourceVersion: string | null
  /** 绑定当时冻结的比较；旧历史未保存时为 null，禁止用当前资料补造。 */
  preview: ScheduleBindingPreview | null
  legacyDetailMissing: boolean
}

export interface ScheduleBindingRead extends ScheduleReadContext {
  group: { id: string, name: string, projectId: string, scopeBasis: ScheduleScopeBasis, contractId: string | null }
  contracts: ScheduleContractOption[]
  state: 'unbound' | 'bound'
  preview: ScheduleBindingPreview | null
  binding: ScheduleBindingRecord | null
}

export interface ScheduleBindingResult {
  groupId: string
  contractId: string
  logId: string
  binding: ScheduleBindingRecord
}
