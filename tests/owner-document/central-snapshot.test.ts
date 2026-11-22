import type { OwnerCommercialDocumentSnapshot } from '../../server/utils/owner-commercial-document-command-test-instance'
import type { OwnerCommercialDocumentCommandRequestDTO } from '~/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentSource } from '~/lib/owner-document/central-repository'
import { describe, expect, it } from 'vitest'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'

const session = { workspaceId: 'workspace-pg11', actorId: 'actor-pg11', capabilities: ['owner-document:read', 'owner-document:write', 'subcontract-document:read', 'subcontract-document:write'] }
const sources = {
  strictSources: true,
  projects: [{ id: 'project-pg11', name: '真实项目', customerId: 'customer-pg11' }],
  customers: [{ id: 'customer-pg11', name: '真实甲方' }],
  suppliers: [{ id: 'supplier-pg11', name: '真实分供方' }],
  contracts: [{ id: 'contract-pg11', no: 'SG-PG11', name: '真实施工合同', projectId: 'project-pg11', customerId: 'customer-pg11', amount: 10000 }],
  subcontractContracts: [{ id: 'subcontract-pg11', no: 'FB-PG11', name: '真实分包合同', projectId: 'project-pg11', supplierId: 'supplier-pg11', amount: 2000 }],
  now: () => '2026-10-07T03:00:00.000Z',
}
const blankAttachments = { add: [], removeIds: [], restoreIds: [] }
function command(kind: OwnerCommercialDocumentSource['kind'], commandId: string, fields: Record<string, unknown>): OwnerCommercialDocumentCommandRequestDTO {
  return { ...session, requiredCapability: ['sub_change', 'sub_settlement', 'project_penalty'].includes(kind) ? 'subcontract-document:write' : 'owner-document:write', kind, commandId, action: 'save', id: null, baseVersion: null, attachments: blankAttachments, ...fields } as OwnerCommercialDocumentCommandRequestDTO
}
async function penaltyGraph() {
  const owner = createOwnerCommercialDocumentCommandTestInstance(sources)
  const penalty = await owner.execute(command('project_penalty', 'penalty-submit-pg11', { action: 'submit', draft: { projectId: 'project-pg11', supplierId: 'supplier-pg11', contractId: 'subcontract-pg11', penaltyDate: '2026-10-07', reason: '成品保护整改', amount: 1000 } }), session)
  const settlement = await owner.execute(command('sub_settlement', 'settlement-submit-pg11', { action: 'submit', draft: { projectId: 'project-pg11', supplierId: 'supplier-pg11', contractId: 'subcontract-pg11', settlementDate: '2026-10-07', name: '真实结算', totalAmount: 2000 } }), session)
  const rectified = await owner.execute(command('project_penalty', 'rectify-pg11', { action: 'rectify-penalty', id: penalty.id, baseVersion: penalty.version, deadline: '2026-10-12', note: '第一次复验' }), session)
  const deduction = command('project_penalty', 'deduct-pg11', { action: 'deduct-penalty', id: penalty.id, baseVersion: rectified.version, settlementId: settlement.id, settlementVersion: settlement.version, amount: 400, note: '第一笔部分抵扣' })
  const deducted = await owner.execute(deduction, session)
  return { owner, penalty, settlement, deducted, deduction }
}

describe('pG-11 商务 owner 完整图与实际来源', () => {
  it('恢复独立抵扣、整改及原命令，拒绝同键异文并核对双方当前版本', async () => {
    const { owner, penalty, settlement, deduction, deducted } = await penaltyGraph()
    const original = JSON.parse(JSON.stringify(owner.snapshot())) as OwnerCommercialDocumentSnapshot
    const restored = createOwnerCommercialDocumentCommandTestInstance({ ...sources, snapshot: original })
    expect(restored.snapshot()).toEqual(original)
    expect(restored.rows().find(row => row.id === penalty.id)).toMatchObject({ amount: 1000, penaltyDeductions: [expect.objectContaining({ amount: 400, settlementId: settlement.id })], penaltyRectifications: [expect.objectContaining({ note: '第一次复验' })] })
    expect(restored.form('sub_settlement', settlement.id, session).version).toBe('2')
    expect(restored.resolve('deduct-pg11', 'project_penalty', session)).toEqual({ outcome: 'applied', result: deducted })
    expect(await restored.execute(deduction, session)).toEqual(deducted)
    await expect(restored.execute({ ...deduction, amount: 401 } as OwnerCommercialDocumentCommandRequestDTO, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(restored.execute({ ...deduction, commandId: 'stale-after-restore' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(restored.rows().find(row => row.id === penalty.id)?.penaltyDeductions).toHaveLength(1)
  })

  it('未应用原键封存经 JSON 恢复后仍拒绝迟到请求，快照不复制上游', async () => {
    const owner = createOwnerCommercialDocumentCommandTestInstance(sources)
    expect(owner.resolve('unknown-pg11', 'owner_penalty', session)).toEqual({ outcome: 'not-applied', commandId: 'unknown-pg11' })
    const snapshot = JSON.parse(JSON.stringify(owner.snapshot()))
    expect(Object.keys(snapshot)).toEqual(['schemaVersion', 'documents', 'commands', 'commandFingerprints', 'sealedCommands', 'commandKinds', 'penaltyDeductions', 'penaltyRectifications', 'migrationKeys', 'migrationSnapshotFingerprint', 'sourceVersion'])
    const restored = createOwnerCommercialDocumentCommandTestInstance({ ...sources, snapshot })
    await expect(restored.execute(command('owner_penalty', 'unknown-pg11', { draft: {} }), session)).rejects.toThrow('封存')
  })

  it('验收与保修共用稳定身份，完整生命周期恢复后终态仍拒绝修改', async () => {
    const owner = createOwnerCommercialDocumentCommandTestInstance(sources)
    let current = await owner.execute(command('acceptance', 'acceptance-submit-pg11', { action: 'submit', draft: { projectId: 'project-pg11', contractId: 'contract-pg11', name: '竣工验收', applicationDate: '2026-10-07' } }), session)
    for (const [commandId, target, facts] of [
      ['accept-pg11', 'accepted', { acceptanceOrganization: '联合验收组', acceptancePerson: '验收人', acceptanceDate: '2026-10-07', acceptanceConclusion: '合格' }],
      ['warranty-pg11', 'warranty', { warrantyOwner: '原施工单位', warrantyStartDate: '2026-10-07', warrantyEndDate: '2027-10-07' }],
      ['expire-pg11', 'expired', { warrantyConfirmationOrganization: '原验收单位', warrantyConfirmationDate: '2027-10-07', warrantyConfirmationNote: '保修到期确认' }],
    ] as const) {
      current = await owner.execute(command('acceptance', commandId, { action: 'transition-acceptance', id: current.id, baseVersion: current.version, target, facts }), session)
    }
    const restored = createOwnerCommercialDocumentCommandTestInstance({ ...sources, snapshot: JSON.parse(JSON.stringify(owner.snapshot())) })
    expect(restored.rawRows()).toHaveLength(1)
    expect(restored.rawRows()[0]).toMatchObject({ id: current.id, status: 'expired', amount: null, acceptanceLifecycle: { events: expect.arrayContaining([expect.objectContaining({ action: 'confirm-expiry' })]) } })
    expect(restored.rawRows()[0]!.acceptanceLifecycle!.events).toHaveLength(4)
    await expect(restored.execute(command('acceptance', 'attachment-expired-pg11', { action: 'attachments', id: current.id, baseVersion: current.version }), session)).rejects.toThrow('只读')
  })

  it.each(['owner_penalty', 'project_penalty', 'sub_settlement', 'sub_change', 'final_settlement', 'acceptance'] as const)('草稿 %s 未填写金额保持未知，明确零仍是零', async (kind) => {
    const field = { owner_penalty: 'amount', project_penalty: 'amount', sub_settlement: 'totalAmount', sub_change: 'approvedAmount', final_settlement: 'settlementAmount', acceptance: 'contractEstimate' }[kind]
    const owner = createOwnerCommercialDocumentCommandTestInstance(sources)
    const saved = await owner.execute(command(kind, `blank-${kind}`, { draft: {} }), session)
    expect(owner.form(kind, saved.id, session).draft[field]).toBeNull()
    const zero = await owner.execute(command(kind, `zero-${kind}`, { id: saved.id, baseVersion: saved.version, draft: { [field]: 0 } }), session)
    expect(owner.form(kind, zero.id, session).draft[field]).toBe(0)
  })

  it('strictSources 不从单据文字制造主档，也不把读取派生数据存回原图', async () => {
    const owner = createOwnerCommercialDocumentCommandTestInstance(sources)
    const saved = await owner.execute(command('final_settlement', 'final-draft-pg11', { draft: { projectId: 'project-pg11', contractId: 'contract-pg11', settlementAmount: 100 } }), session)
    const raw = owner.rawRows()[0]!
    Object.assign(raw, { futureExtension: { preserve: ['未知字段', 0, null] } })
    const isolated = createOwnerCommercialDocumentCommandTestInstance({ strictSources: true, documents: [raw] })
    expect(isolated.context(session)).toMatchObject({ projects: [], customers: [], contracts: [], suppliers: [] })
    const restored = createOwnerCommercialDocumentCommandTestInstance({ ...sources, documents: [raw] })
    expect(restored.form('final_settlement', saved.id, session).draft.changedContractAmount).toBeNull()
    expect(restored.rawRows()[0]).toEqual(raw)
    expect(restored.snapshot().documents[0]).toMatchObject({ futureExtension: { preserve: ['未知字段', 0, null] } })
    const conflicting = { ...raw, note: '冲突来源' }
    expect(() => createOwnerCommercialDocumentCommandTestInstance({ ...sources, documents: [conflicting], snapshot: restored.snapshot() }).snapshot()).toThrow('身份冲突')
    await restored.execute(command('final_settlement', 'preserve-future-extension', { id: saved.id, baseVersion: saved.version, draft: { projectId: 'project-pg11', contractId: 'contract-pg11', settlementAmount: 101 } }), session)
    expect(restored.rawRows()[0]).toMatchObject({ amount: 101, futureExtension: { preserve: ['未知字段', 0, null] } })
  })

  it.each([
    ['未知版本', (s: OwnerCommercialDocumentSnapshot) => { s.schemaVersion = 2 as 1 }],
    ['重复主键', (s: OwnerCommercialDocumentSnapshot) => { s.documents.push(s.documents[0]!) }],
    ['错误kind', (s: OwnerCommercialDocumentSnapshot) => { s.documents[0]!.kind = 'invoice' as OwnerCommercialDocumentSource['kind'] }],
    ['坏版本', (s: OwnerCommercialDocumentSnapshot) => { s.documents[0]!.version = 0 }],
    ['错回执kind', (s: OwnerCommercialDocumentSnapshot) => { s.commandKinds[0]![1] = 'acceptance' }],
    ['孤儿回执', (s: OwnerCommercialDocumentSnapshot) => { s.commands[0]![1].id = 'missing-document' }],
    ['坏指纹', (s: OwnerCommercialDocumentSnapshot) => { s.commandFingerprints[0]![1] = 'bad' }],
    ['孤儿抵扣', (s: OwnerCommercialDocumentSnapshot) => { s.penaltyDeductions[0]!.settlementId = 'missing-settlement' }],
    ['抵扣超额', (s: OwnerCommercialDocumentSnapshot) => { s.penaltyDeductions[0]!.amount = 1001 }],
    ['孤儿整改', (s: OwnerCommercialDocumentSnapshot) => { s.penaltyRectifications[0]!.penaltyId = 'missing-penalty' }],
    ['坏迁入键', (s: OwnerCommercialDocumentSnapshot) => { s.migrationKeys = ['project_penalty\u001Fmissing-penalty'] }],
  ])('坏持久图整图拒绝而不重置：%s', async (_name, corrupt) => {
    const { owner } = await penaltyGraph()
    const before = owner.snapshot()
    const invalid = JSON.parse(JSON.stringify(before)) as OwnerCommercialDocumentSnapshot
    corrupt(invalid)
    expect(() => createOwnerCommercialDocumentCommandTestInstance({ ...sources, snapshot: invalid })).toThrow('持久图')
    expect(owner.snapshot()).toEqual(before)
  })
})
