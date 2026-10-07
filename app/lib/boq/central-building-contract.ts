export const BOQ_BUILDING_WRITE_CAPABILITY = 'owner-document:write' as const

export interface BoqBuildingQuery {
  projectId: string
  contractId: string
  origin: 'real' | 'demo'
}

/** 只由受控原始 BOQ 导出或签证确认生成；浏览器更正命令不可提供来源资格。 */
export interface BoqLineSource {
  boqFileId: string | null
  changeOrderId: string | null
  traceKey: string | null
  sourceSheet: string | null
  sourceRow: number | null
  confirmed: boolean
}

export interface BoqBuildingOption { id: string, code: string, name: string, version?: string }
export interface BoqBuildingEvidence { quantityVersion: string, buildings: BoqBuildingOption[] }
export interface BoqBuildingLine {
  version?: string
  id: string
  itemName: string
  unit: string
  qty: number | null
  unitPrice: number | null
  effectiveQty: number | null
  effectiveUnitPrice: number | null
  building: string | null
  sourceKind: 'confirmed-import' | 'change-addition' | 'unknown'
  readOnlyReason: string | null
}
export interface BoqBuildingAudit {
  id: string
  tableName: 'boq_lines'
  lineId: string
  projectId: string
  contractId: string
  commandId: string
  actorId: string
  occurredAt: string
  reason: string
  beforeBuilding: string | null
  building: string
  buildingId: string
  sourceVersion: string
  source: BoqLineSource
}
export interface BoqBuildingContext extends BoqBuildingQuery {
  contractVersion?: string
  workspaceId: string
  actorId: string
  contractName: string
  sourceVersion: string
  capabilities: string[]
  buildings: BoqBuildingOption[]
  lines: BoqBuildingLine[]
  audit: BoqBuildingAudit[]
}
export interface BoqBuildingCommand extends BoqBuildingQuery {
  lineVersion?: string
  buildingVersion?: string
  contractVersion?: string
  commandId: string
  workspaceId: string
  actorId: string
  requiredCapability: typeof BOQ_BUILDING_WRITE_CAPABILITY
  sourceVersion: string
  lineId: string
  buildingId: string
  reason: string
}
export interface BoqBuildingResult {
  commandId: string
  projectId: string
  contractId: string
  lineId: string
  buildingId: string
  building: string
  sourceVersion: string
  auditId: string
}
