import type { OwnerCommercialDocumentCommandTestInstanceOptions } from '../../server/utils/owner-commercial-document-command-test-instance'
import { describe, expect, it } from 'vitest'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'

const session = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['project:list:read', 'construction-contract:read', 'owner-document:read', 'owner-document:write', 'quantity:read'] }
const query = { projectId: 'project', contractId: 'contract', origin: 'real' as const }
const evidence = { quantityVersion: 'quantity:project:0', buildings: [{ id: 'building', code: 'B1', name: '一栋' }] }

function owner(options: Partial<OwnerCommercialDocumentCommandTestInstanceOptions> = {}) {
  return createOwnerCommercialDocumentCommandTestInstance({
    now: () => '2026-09-12T00:00:00.000Z',
    projects: [{ id: 'project', name: '项目', customerId: null }],
    contracts: [{ id: 'contract', projectId: 'project', customerId: null, no: 'C1', name: '施工合同' }],
    boqLines: [{ id: 'line', projectId: 'project', contractId: 'contract', itemName: '腻子', unit: '㎡', qty: 10, unitPrice: 2, building: null, autoQty: 0, missingQtyCount: 0, source: { boqFileId: 'file', changeOrderId: null, traceKey: 'sheet:1', sourceSheet: '清单', sourceRow: 1, confirmed: true } }],
    ...options,
  })
}

describe('中央导入 BOQ 楼栋证据', () => {
  it('公开读取可更正的已确认导入原始行，并保持原始量价', () => {
    const context = owner().boqBuildingContext(query, session, evidence)
    expect(context.lines).toEqual([expect.objectContaining({ id: 'line', sourceKind: 'confirmed-import', readOnlyReason: null, qty: 10, unitPrice: 2, effectiveQty: 10, effectiveUnitPrice: 2, building: null })])
    expect(context.buildings).toEqual(evidence.buildings)
  })

  it('更正只更新原始行的楼栋，同提交重试不再写审计，固定版本和提交内容不容替换', () => {
    const source = owner()
    const context = source.boqBuildingContext(query, session, evidence)
    const command = { ...query, commandId: 'correct-1', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'owner-document:write' as const, sourceVersion: context.sourceVersion, lineId: 'line', buildingId: 'building', reason: '按已核清单补充楼栋' }
    const before = source.quantityBoqFacts('project')
    const result = source.correctBoqBuilding(command, session, evidence)
    expect(result).toMatchObject({ commandId: command.commandId, lineId: 'line', building: 'B1' })
    expect(source.quantityBoqFacts('project')).toMatchObject({ lines: [expect.objectContaining({ id: 'line', qty: 10, unitPrice: 2, approvedDeltaQty: 0, effectiveUnitPrice: 2, building: 'B1' })] })
    expect(source.quantityBoqFacts('project').sourceVersion).not.toBe(before.sourceVersion)
    expect(source.correctBoqBuilding(command, session, evidence)).toEqual(result)
    const after = source.boqBuildingContext(query, session, evidence)
    expect(after.audit).toEqual([expect.objectContaining({ tableName: 'boq_lines', lineId: 'line', actorId: 'actor', beforeBuilding: null, building: 'B1', reason: command.reason })])
    expect(() => source.correctBoqBuilding({ ...command, reason: '替换了提交内容' }, session, evidence)).toThrow(/提交编号/)
    expect(() => source.correctBoqBuilding({ ...command, commandId: 'stale' }, session, evidence)).toThrow(/已变化/)
  })

  it.each(['unknown', 'pending', 'change-addition'] as const)('%s 来源不能伪装为已确认导入行', (kind) => {
    const line = { id: 'line', projectId: 'project', contractId: 'contract', itemName: '腻子', unit: '㎡', qty: null, unitPrice: 0, autoQty: 0, missingQtyCount: 0 }
    const source = owner({ boqLines: [{ ...line, source: kind === 'unknown' ? undefined : { boqFileId: kind === 'pending' ? 'file' : null, changeOrderId: kind === 'change-addition' ? 'change' : null, traceKey: null, sourceSheet: null, sourceRow: null, confirmed: kind === 'change-addition' } }] })
    const context = source.boqBuildingContext(query, session, evidence)
    expect(context.lines[0]!.readOnlyReason).toBeTruthy()
    const command = { ...query, commandId: kind, workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'owner-document:write' as const, sourceVersion: context.sourceVersion, lineId: 'line', buildingId: 'building', reason: '请求更正' }
    expect(() => source.correctBoqBuilding(command, session, evidence)).toThrow(/不可直接/)
    expect(source.boqBuildingContext(query, session, evidence).audit).toEqual([])
  })

  it.each([{ qty: 999 }, { source: { confirmed: true } }])('拒绝越权、跨项目楼栋、来源资格和量价字段注入：%j', (patch) => {
    const source = owner()
    const context = source.boqBuildingContext(query, session, evidence)
    const command = { ...query, commandId: 'guard', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'owner-document:write' as const, sourceVersion: context.sourceVersion, lineId: 'line', buildingId: 'building', reason: '请求更正' }
    const input = { ...command, ...patch }
    expect(() => source.correctBoqBuilding(input, session, evidence)).toThrow(/只允许更正/)
    expect(() => source.correctBoqBuilding({ ...command, buildingId: 'other-project-building' }, session, evidence)).toThrow(/不属于当前项目/)
    expect(() => source.correctBoqBuilding(command, { ...session, capabilities: session.capabilities.filter(cap => cap !== 'owner-document:write') }, evidence)).toThrow(/无权/)
    expect(() => source.correctBoqBuilding({ ...command, actorId: 'other-actor' }, session, evidence)).toThrow(/无权/)
    expect(() => source.correctBoqBuilding({ ...command, origin: 'demo' }, session, evidence)).toThrow(/无权/)
    expect(source.boqBuildingContext(query, session, evidence).audit).toEqual([])
  })
})
