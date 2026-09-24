import type { QuantityContext } from './central-contract'

/** 原始认可量和已批调量分别提供，调用方不得重复叠加。 */
export interface QuantityBoqLine {
  unitType?: string | null
  floorZone?: string | null
  id: string
  contractId: string
  contractName: string
  contractNo: string
  itemName: string
  unit: string
  qty: number | null
  unitPrice: number | null
  approvedDeltaQty: number
  effectiveUnitPrice: number | null
  building: string | null
  updatedAt: string | null
}

export interface QuantityBoqWorkspace {
  projectId: string
  lines: QuantityBoqLine[]
}

export type QuantityBoqSource = (projectId: string, context: QuantityContext) => Promise<QuantityBoqWorkspace & { sourceVersion: string }>
