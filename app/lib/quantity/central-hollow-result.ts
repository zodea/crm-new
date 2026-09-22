import type { QuantityHollowCommand, QuantityHollowCommandResult, QuantityHollowProofRef } from './central-hollow-contract'
import { hollowId, hollowIds, hollowInvalid, hollowKeys } from './central-hollow-primitives'

export function isQuantityHollowProofRef(value: unknown): value is QuantityHollowProofRef {
  return hollowKeys(value, ['recordId', 'revisionId', 'headLogId', 'rectificationIds', 'fingerprint']) && hollowId(value.recordId) && hollowId(value.revisionId) && hollowId(value.headLogId) && hollowIds(value.rectificationIds) && typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint)
}
export function decodeQuantityHollowCommand(value: unknown, command: QuantityHollowCommand): QuantityHollowCommandResult {
  if (!hollowKeys(value, ['commandId', 'id', 'logIds', 'sourceVersion', 'hollow']) || value.commandId !== command.commandId || !hollowId(value.id) || !hollowIds(value.logIds) || value.logIds.length !== 1 || !hollowId(value.sourceVersion))
    return hollowInvalid('空鼓回执身份或来源版本不完整')
  const receipt = value.hollow
  if (!hollowKeys(receipt, ['kind', 'recordId', 'unitId', 'revisionId', 'rectificationId', 'logId', 'proof']) || receipt.kind !== command.action.kind || receipt.recordId !== value.id || !hollowId(receipt.unitId) || !hollowId(receipt.revisionId) || receipt.logId !== value.logIds[0] || !isQuantityHollowProofRef(receipt.proof) || receipt.proof.recordId !== receipt.recordId || receipt.proof.revisionId !== receipt.revisionId || receipt.proof.headLogId !== receipt.logId)
    return hollowInvalid('空鼓回执原记录或修订不一致')
  const action = command.action
  if (action.kind === 'create-hollow-inspection') {
    if (receipt.unitId !== action.target.unitId || receipt.rectificationId !== null || receipt.proof.rectificationIds.length)
      return hollowInvalid('新检查回执不是原目标初版')
  }
  else if (receipt.recordId !== action.recordId) {
    return hollowInvalid('空鼓回执指向另一检查')
  }
  if (action.kind === 'revise-hollow-inspection' && (receipt.revisionId === action.expectedRevisionId || receipt.rectificationId !== null))
    return hollowInvalid('检查修订回执未指向新版本')
  if (action.kind === 'rectify-hollow-inspection' && (receipt.revisionId !== action.expectedRevisionId || !hollowId(receipt.rectificationId) || !receipt.proof.rectificationIds.includes(receipt.rectificationId)))
    return hollowInvalid('整改回执未包含原事件')
  return structuredClone(value) as unknown as QuantityHollowCommandResult
}
