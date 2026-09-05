import type { MoneyDTO, NavigationIntentDTO } from '../../types/read-model'

export interface PenaltyDeductionSource {
  id: string
  penaltyId: string
  settlementId: string
  amount: number
  actorId: string
  occurredAt: string
  commandId: string
  note: string
}

export interface PenaltyDeductionDTO extends Omit<PenaltyDeductionSource, 'amount'> {
  amount: MoneyDTO
  settlementName: string
  navigation: NavigationIntentDTO
}

export interface PenaltyRectificationEvent {
  id: string
  actorId: string
  occurredAt: string
  deadline: string | null
  note: string
}

export function matchesPenaltySettlement(
  penalty: { projectId: string | null, supplierId?: string | null, contractId: string | null },
  settlement: { projectId: string | null, supplierId?: string | null, contractId: string | null, status: string },
): boolean {
  // 班组与结算没有 canonical 外键；仅同项目或班组身份不足以证明抵扣来源。
  return Boolean(penalty.projectId && (penalty.contractId || penalty.supplierId)
    && settlement.projectId && settlement.contractId && settlement.supplierId)
  && settlement.status === 'confirmed'
  && penalty.projectId === settlement.projectId
  && (!penalty.contractId || penalty.contractId === settlement.contractId)
  && (!penalty.supplierId || penalty.supplierId === settlement.supplierId)
}
