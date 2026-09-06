import type { AuxiliaryContractCommand, AuxiliaryContractDraft } from '../../app/lib/auxiliary-contract/contract'
import { describe, expect, it } from 'vitest'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'

const session = { workspaceId: 'workspace-test', actorId: 'actor-test', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
const company = { kind: 'company_expense' as const, name: '办公室租赁', no: 'GS-330', category: '房租', counterparty: '出租单位', signDate: '2026-09-06', amount: 1060, taxRate: 6, partyA: '承租公司' }
const command = (draft: AuxiliaryContractDraft = company): AuxiliaryContractCommand => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'create-330', baseVersion: null, action: 'save', draft, attachments: {} })

describe('辅助合同中央事实', () => {
  it('无税金额在半分边界按十进制四舍五入，税额与含税金额对齐', async () => {
    const repository = createAuxiliaryContractTestInstance()
    const result = await repository.execute(command({ ...company, amount: 0.09, taxRate: 20 }), session)
    expect(repository.detail(result.id, { kind: 'company_expense' }, session).contract.amounts).toMatchObject({ contract: '0.09', taxExclusive: '0.08', tax: '0.01' })
  })
  it('关系身份失效后读取为缺失关系，更新不可沿用已删除身份', async () => {
    let projects = [{ id: 'p-live', name: '动态项目' }]
    const repository = createAuxiliaryContractTestInstance({ identities: () => ({ projects, suppliers: [{ id: 's-live', name: '动态分供方' }] }) })
    const input = command({ kind: 'other_expense', name: '检测服务', category: '检测服务', projectId: 'p-live', supplierId: 's-live', signDate: '2026-09-06', amount: 1 })
    const result = await repository.execute(input, session)
    projects = []
    expect(repository.detail(result.id, { kind: 'other_expense' }, session).contract.project?.state).toBe('missing')
    await expect(repository.execute({ ...input, id: result.id, baseVersion: '1', commandId: 'update-stale-ref' }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })
  it('公司合同没有项目，通过显式命令保存后只读详情保留税务与操作者，重试不重复', async () => {
    const repository = createAuxiliaryContractTestInstance({ createId: () => 'contract-330', now: () => '2026-09-06T01:00:00.000Z' })
    const result = await repository.execute(command(), session)
    expect(await repository.execute(command(), session)).toEqual(result)
    const detail = repository.detail('contract-330', { kind: 'company_expense', origin: 'real' }, session)
    expect(detail.contract.project).toBeNull()
    expect(detail.contract.supplier).toBeNull()
    expect(detail.contract.amounts).toMatchObject({ contract: '1060.00', taxExclusive: '1000.00', tax: '60.00', invoiced: '0.00', paid: '0.00' })
    expect(detail.contract.audit).toMatchObject({ createdBy: 'actor-test', updatedBy: 'actor-test' })
    expect(repository.list({ kind: 'company_expense' }, session).pagination.total).toBe(1)
  })
  it('项目合同只接受稳定项目/分供方 ID，公司合同拒绝项目和伪造明细；失败不落事实', async () => {
    const repository = createAuxiliaryContractTestInstance({ projects: [{ id: 'p-1', name: '同名项目' }], suppliers: [{ id: 's-1', name: '同名单位' }] })
    const draft = { kind: 'other_expense' as const, name: '检测服务', category: '检测服务', projectId: 'p-1', supplierId: 's-1', amount: 0, signDate: '2026-09-06' }
    await expect(repository.execute(command({ ...draft, supplierId: '同名单位' }), session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(repository.execute(command({ ...company, projectId: 'p-1' }), session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(repository.execute(command({ ...draft, lineItems: [{}] } as AuxiliaryContractDraft), session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(repository.list({ kind: 'other_expense' }, session).pagination.total).toBe(0)
    const saved = await repository.execute(command(draft), session)
    expect(repository.detail(saved.id, { kind: draft.kind }, session).contract).toMatchObject({ project: { id: 'p-1' }, supplier: { id: 's-1' }, amounts: { contract: '0.00' } })
    expect(() => repository.detail(saved.id, { kind: 'company_expense' }, session)).toThrow(/不匹配/)
  })
  it('命令隔离会话、版本和幂等内容，未知身份、金额、日期与状态不可写入', async () => {
    const repository = createAuxiliaryContractTestInstance()
    const saved = await repository.execute(command(), session)
    await expect(repository.execute({ ...command(), draft: { ...company, name: '偷换内容' } }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(repository.execute({ ...command(), commandId: 'update', id: saved.id, baseVersion: '0' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(() => repository.detail(saved.id, { kind: 'company_expense' }, { ...session, workspaceId: 'another' })).toThrow(/不存在/)
    expect(() => repository.list({ kind: 'company_expense' }, { ...session, capabilities: [] })).toThrow(/权限/)
    for (const patch of [{ amount: -1 }, { amount: 1.001 }, { amount: Number.NaN }, { signDate: '2026-02-30' }, { status: '已结清' }]) {
      await expect(repository.execute({ ...command({ ...company, ...patch }), commandId: crypto.randomUUID() }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    }
  })
  it('附件归当前合同，移除可恢复；票款只汇总同类型同 ID 的有效事实并保留未知金额', async () => {
    const repository = createAuxiliaryContractTestInstance({ createId: () => 'c-330', facts: [
      { id: 'i-1', contractId: 'c-330', contractKind: 'company_expense', dataOrigin: 'real', kind: 'invoice', no: 'FP-1', name: '收票', amount: '800.00', date: null, status: 'confirmed', effective: true },
      { id: 'p-1', contractId: 'c-330', contractKind: 'company_expense', dataOrigin: 'real', kind: 'payment', no: 'ZF-1', name: '支付分摊', amount: '300.00', date: null, status: 'confirmed', effective: true },
      { id: 'i-2', contractId: 'c-330', contractKind: 'other_expense', dataOrigin: 'real', kind: 'invoice', no: '同名错类', name: '收票', amount: '999.00', date: null, status: 'confirmed', effective: true },
    ] })
    const saved = await repository.execute({ ...command(), attachments: { add: [{ fileName: '合同审批稿.pdf', category: '合同审批稿', fileSize: 20 }] } }, session)
    const read = () => repository.detail(saved.id, { kind: 'company_expense' }, session)
    expect(read().contract.amounts).toMatchObject({ invoiced: '800.00', paid: '300.00', byInvoicePayable: '500.00' })
    const file = read().attachments[0]!
    expect(file).toMatchObject({ ownerId: saved.id, ownerType: 'company_expense_contract', uploader: session.actorId })
    await expect(repository.execute({ ...command(), id: saved.id, baseVersion: '1', commandId: 'bad-file', attachments: { removeIds: ['unknown-file'] } }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await repository.execute({ ...command(), id: saved.id, baseVersion: '1', commandId: 'remove', attachments: { removeIds: [file.id] } }, session)
    expect(read().attachments).toHaveLength(0)
    await repository.execute({ ...command(), id: saved.id, baseVersion: '2', commandId: 'restore', attachments: { restoreIds: [file.id] } }, session)
    expect(read().attachments).toHaveLength(1)
  })
  it('来源筛选分页与汇总属于同一结果，0 与 null 不混淆', async () => {
    let counter = 0
    const repository = createAuxiliaryContractTestInstance({ createId: () => `c-${++counter}` })
    for (let i = 0; i < 12; i++)
      await repository.execute({ ...command({ ...company, name: `软件 ${i}`, category: '软件', amount: i === 0 ? null : 0 }), commandId: `create-${i}`, action: 'draft' }, session)
    const page = repository.list({ kind: 'company_expense', category: '软件', page: '2', pageSize: '10' }, session)
    expect(page).toMatchObject({ pagination: { total: 12, page: 2, pageSize: 10 }, empty: null, summary: { real: { count: 12, amount: null } } })
    expect(page.items).toHaveLength(2)
    expect(repository.list({ kind: 'company_expense', search: '不存在' }, session)).toMatchObject({ pagination: { total: 0 }, empty: { reason: 'no-filter-match' } })
    expect(() => repository.list({ kind: 'company_expense', projectId: 'p-1' }, session)).toThrow(/项目/)
  })
})
