import type { QuantityHollowCommand, QuantityHollowCommandResult, QuantityHollowRead, QuantityHollowRecord } from '../../app/lib/quantity/central-hollow-contract'

export const hollowIdentity = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['quantity:read', 'quantity:write'] }
export const hollowQuery = { projectId: 'project', unitId: 'unit', origin: 'real' as const, includeDemo: false }
export const hollowTarget = { unitId: 'unit', assignmentId: 'assignment', roomId: 'room', itemId: 'item' }
export const hollowInput = { inspectedOn: '2026-09-01', count: 19, note: '厨房墙砖原检查' }
const location = { projectId: 'project', buildingId: 'building', floorId: 'floor', unitId: 'unit', templateId: 'template', templateLineId: 'template-line', roomId: 'room', itemId: 'item', buildingName: '一栋', floorName: '37楼', unitName: '3702户', roomName: '厨房', itemName: '墙砖', locationLabel: '一栋 / 37楼 / 3702户 / 厨房 / 墙砖' }
const source = { navigation: null, reasons: ['测试不提供来源导航'] }
const allowed = { allowed: true, reasons: [] }

/** 仅隔离客户端交互和提交状态；来源证明及 SQL 用公开服务 fixture 单独验收。 */
export function hollowRead(records: QuantityHollowRecord[] = [], sourceVersion = 'quantity-v1'): QuantityHollowRead {
  return { data: { projectId: 'project', unitId: 'unit', targets: [{ target: hollowTarget, originalParty: { kind: 'worker', workerId: 'worker' }, originalPartyName: '原施工人', location, source, create: allowed }], records, unavailable: [] }, context: structuredClone(hollowIdentity), capabilities: [...hollowIdentity.capabilities], dataOrigin: 'real', sourceVersion, asOf: '2026-09-15T00:00:00Z' }
}

export function hollowResult(command: QuantityHollowCommand): QuantityHollowCommandResult {
  return { commandId: command.commandId, id: 'record', logIds: ['log'], sourceVersion: 'quantity-v2', hollow: { kind: command.action.kind, recordId: 'record', unitId: 'unit', revisionId: 'revision', rectificationId: null, logId: 'log', proof: { recordId: 'record', revisionId: 'revision', headLogId: 'log', rectificationIds: [], fingerprint: 'a'.repeat(64) } } }
}

export function hollowRecord(command: QuantityHollowCommand): QuantityHollowRecord {
  const input = command.action.kind === 'rectify-hollow-inspection' ? hollowInput : command.action.input
  const revision = { revisionId: 'revision', previousRevisionId: null, input: structuredClone(input), reason: null, commandId: command.commandId, logId: 'log', actorId: command.actorId, createdAt: '2026-09-15T00:00:00Z' }
  return { recordId: 'record', target: hollowTarget, originalParty: { kind: 'worker', workerId: 'worker' }, originalPartyName: '原施工人', ownershipKey: JSON.stringify(['project', 'unit', 'assignment', 'room', 'item']), location, inspection: revision, revisions: [revision], rectifications: [], rectifiedCount: 0, remainingCount: input.count, proof: hollowResult(command).hollow.proof, source, eligibility: { revise: allowed, rectify: allowed } }
}
