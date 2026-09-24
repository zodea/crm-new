import type { QuantityHollowAction, QuantityHollowCommand, QuantityHollowInspectionInput, QuantityHollowTarget } from './central-hollow-contract'
import { isISODateDTO } from '../../types/read-model'
import { hollowCount, hollowId, hollowInvalid, hollowKeys, hollowObject } from './central-hollow-primitives'

export function isQuantityHollowActionKind(value: unknown): value is QuantityHollowAction['kind'] {
  return value === 'create-hollow-inspection' || value === 'revise-hollow-inspection' || value === 'rectify-hollow-inspection'
}
export function isQuantityHollowTarget(value: unknown): value is QuantityHollowTarget {
  return hollowKeys(value, ['unitId', 'assignmentId', 'roomId', 'itemId']) && Object.values(value).every(hollowId)
}
export function isQuantityHollowInspectionInput(value: unknown): value is QuantityHollowInspectionInput {
  return hollowKeys(value, ['inspectedOn', 'count', 'note']) && isISODateDTO(value.inspectedOn) && hollowCount(value.count) && typeof value.note === 'string'
}
export function parseQuantityHollowAction(value: unknown): QuantityHollowAction {
  if (!hollowObject(value))
    return hollowInvalid('空鼓动作格式无效')
  if (value.kind === 'create-hollow-inspection' && hollowKeys(value, ['kind', 'target', 'input']) && isQuantityHollowTarget(value.target) && isQuantityHollowInspectionInput(value.input))
    return structuredClone(value) as unknown as QuantityHollowAction
  if (value.kind === 'revise-hollow-inspection' && hollowKeys(value, ['kind', 'recordId', 'expectedRevisionId', 'input', 'reason']) && hollowId(value.recordId) && hollowId(value.expectedRevisionId) && isQuantityHollowInspectionInput(value.input) && hollowId(value.reason))
    return structuredClone(value) as unknown as QuantityHollowAction
  if (value.kind === 'rectify-hollow-inspection' && hollowKeys(value, ['kind', 'recordId', 'expectedRevisionId', 'rectifiedOn', 'count', 'note']) && hollowId(value.recordId) && hollowId(value.expectedRevisionId) && isISODateDTO(value.rectifiedOn) && hollowCount(value.count, true) && typeof value.note === 'string')
    return structuredClone(value) as unknown as QuantityHollowAction
  return hollowInvalid('空鼓动作身份、日期或处数无效；整改必须为正整数，修订须说明依据')
}
export function parseQuantityHollowCommand(value: unknown): QuantityHollowCommand {
  if (!hollowKeys(value, ['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'origin', 'projectId', 'action']) || !['workspaceId', 'actorId', 'commandId', 'baseVersion', 'projectId'].every(key => hollowId(value[key])) || value.requiredCapability !== 'quantity:write' || value.origin !== 'real')
    return hollowInvalid('空鼓命令身份、来源或版本无效')
  return { ...value, action: parseQuantityHollowAction(value.action) } as QuantityHollowCommand
}
