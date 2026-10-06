import type { MaterialContractCommandRequestDTO } from '~/lib/material-contract/command-contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { reconcileMaterialDraftIdentities } from '~/lib/material-contract/line-model'
import { decodeMaterialContractDetailRead } from '~/lib/material-contract/repository'
import { createMaterialContractCommandTestInstance } from '../../server/utils/material-contract-command-test-instance'
import { buildMaterialContractDetail, materialReadMeta } from '../helpers/material-read-meta'

const actor = { workspaceId: 'material-workspace', actorId: 'material-owner', capabilities: ['material-contract:read', 'material-contract:write'] }
function request(commandId = 'main-create'): MaterialContractCommandRequestDTO {
  return { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-contract:write', commandId, baseVersion: null, action: 'submit', attachments: {}, draft: {
    name: '方管采购',
    projectId: 'project-001',
    supplierId: 'supplier-001',
    content: '原合同事实',
    signDate: '2026-10-02',
    amount: 4800,
    taxRate: null,
    lineItems: [{ materialName: '方管', spec: '40×40×2', materialGrade: '304', unit: '米', qty: 100, taxInclusiveUnitPrice: 20 }, { materialName: '方管', spec: '50×50×2', materialGrade: '', unit: '米', qty: 100, taxInclusiveUnitPrice: 30 }],
    deductions: [{ name: '整单优惠', amount: 200, basis: '合同约定优惠200元' }],
  } }
}
function service() {
  let sequence = 0
  let lines = 0
  return createMaterialContractCommandTestInstance({ createId: () => `contract-${++sequence}`, createLineId: () => `line-${++lines}`, createDeductionId: () => 'deduction-001', now: () => '2026-10-02T00:00:00.000Z', projects: [{ id: 'project-001', name: '正式项目' }], suppliers: [{ id: 'supplier-001', name: '正式分供方' }] })
}

describe('材采自有明细、减项与原历史', () => {
  it('新文件来源核实际原件摘要与所有权，伪造摘要或仅路径不会留下半份合同', async () => {
    const owner = service()
    const bytes = Buffer.from('actual material source bytes')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const command = request('import-actual')
    command.draft.lineItems![0]!.source = { fileName: '真实材料.csv', sheetName: '材料', rowNumber: 2, sourceHash: sha256, externalRef: null, priceUnit: '米', quantityUnitVerified: true }
    await expect(owner.execute(command, actor)).rejects.toThrow('实际原件')
    expect(owner.rows()).toEqual([])
    const saved = await owner.execute({ ...command, commandId: 'import-actual-bytes', attachments: { add: [{ fileName: '真实材料.csv', fileSize: bytes.length, payloadBase64: bytes.toString('base64'), mimeType: 'text/csv' }] } }, actor)
    expect([...owner.file(saved.id, saved.attachmentIds[0]!, actor).bytes]).toEqual([...bytes])
    const edited = owner.form(saved.id, actor)
    const forged = structuredClone(edited.draft)
    forged.lineItems![0]!.source!.sourceHash = 'a'.repeat(64)
    await expect(owner.execute({ ...command, id: saved.id, commandId: 'forged-source', baseVersion: saved.version, draft: forged }, actor)).rejects.toThrow('实际原件')
    expect(owner.form(saved.id, actor).version).toBe(saved.version)
  })
  it('保存后输入的增删、重新排序及字段修改保留，只按原回执承接稳定身份', () => {
    const submitted = { lineItems: [{ id: 'draft-a', materialName: '原材料A' }, { id: 'draft-b', materialName: '原材料B' }], deductions: [{ id: 'draft-discount', amount: 200 }] }
    const current = { name: '后来标题', lineItems: [{ id: 'draft-b', materialName: '后来修改B' }, { id: 'draft-c', materialName: '后来新增C' }], deductions: [{ id: 'draft-discount', amount: 300 }] }
    expect(reconcileMaterialDraftIdentities(current, submitted, 'saved-contract', { id: 'saved-contract', lineIds: ['line-a', 'line-b'], deductionIds: ['discount-a'] })).toEqual({ id: 'saved-contract', name: '后来标题', lineItems: [{ id: 'line-b', materialName: '后来修改B' }, { id: 'draft-c', materialName: '后来新增C' }], deductions: [{ id: 'discount-a', amount: 300 }] })
    expect(current.lineItems[0]!.id).toBe('draft-b')
  })
  it('5000正向量价与200独立减项形成4800，并完整保存材质、空材质及负额投影', async () => {
    const owner = service()
    const command = request()
    const saved = await owner.execute(command, actor)
    expect(await owner.execute(structuredClone(command), actor)).toEqual(saved)
    const form = owner.form(saved.id, actor)
    expect(form.draft.lineItems).toMatchObject([{ id: 'line-1', qty: 100, taxInclusiveUnitPrice: 20, materialGrade: '304' }, { id: 'line-2', qty: 100, taxInclusiveUnitPrice: 30, materialGrade: '' }])
    expect(form.draft.deductions).toEqual([{ id: 'deduction-001', name: '整单优惠', amount: 200, basis: '合同约定优惠200元', sortOrder: 0 }])
    const detail = decodeMaterialContractDetailRead(buildMaterialContractDetail({ contracts: owner.rows(), facts: owner.facts(), query: { id: saved.id, origin: 'real', includeDemo: false }, meta: materialReadMeta(actor.capabilities, owner.sourceVersion(), 'real', '2026-10-02T00:00:00.000Z') }))
    expect(detail.contract.amounts.contract).toBe('4800.00')
    expect(detail.sections.lineItems.map(row => row.amount)).toEqual(['2000.00', '3000.00'])
    expect(detail.sections.deductions).toEqual([{ id: 'deduction-001', name: '整单优惠', amount: '-200.00', basis: '合同约定优惠200元' }])
    await expect(owner.execute({ ...command, draft: { ...command.draft, amount: 4700 } }, actor)).rejects.toThrow('同一命令编号')
  })

  it('协议只记录自有增额、稳定原行引用与依据；原签约行保持，历史版本可冷载', async () => {
    const owner = service()
    const main = await owner.execute(request(), actor)
    const supplement: MaterialContractCommandRequestDTO = { ...request('supplement-create'), draft: { ...request().draft, isSupplement: true, originalContractId: main.id, name: '单价核增协议', amount: 100, deductions: [], lineItems: [{ originalLineId: 'line-1', materialName: '方管', spec: '40×40×2', materialGrade: '304', unit: '米', qty: 100, taxInclusiveUnitPrice: 21, changeAmount: 100, changeBasis: '仅原100米每米核增1元，文书确认100元' }] } }
    const saved = await owner.execute(supplement, actor)
    expect(owner.form(main.id, actor).draft.lineItems?.[0]).toMatchObject({ id: 'line-1', taxInclusiveUnitPrice: 20 })
    expect(owner.form(saved.id, actor).draft).toMatchObject({ id: 'contract-2', isSupplement: true, originalContractId: 'contract-1', projectId: 'project-001', supplierId: 'supplier-001', amount: 100, lineItems: [{ id: 'line-3', originalLineId: 'line-1', taxInclusiveUnitPrice: 21, changeAmount: 100 }] })
    expect(owner.rows()).toMatchObject([{ id: 'contract-1', amount: 4800, supplementAmount: 100 }])
    await owner.execute({ ...supplement, id: saved.id, commandId: 'supplement-edit', baseVersion: '1', draft: { ...owner.form(saved.id, actor).draft, content: '补充协议适用范围说明' } }, actor)
    const reopened = service()
    reopened.importState(owner.exportState())
    expect(reopened.history(saved.id, actor)).toMatchObject([{ version: 1, draft: { amount: 100, content: '原合同事实' }, commandId: 'supplement-edit', actorId: 'material-owner' }])
    expect(reopened.resolve('supplement-create', actor)).toEqual({ outcome: 'applied', result: saved })
    expect(reopened.form(main.id, actor).draft.lineItems?.[0]?.taxInclusiveUnitPrice).toBe(20)
    const beforeRemoval = reopened.exportState().contracts.find(row => row.id === saved.id)!.originalLineSnapshots
    await reopened.execute({ ...supplement, id: saved.id, commandId: 'remove-reference', baseVersion: '2', action: 'draft', draft: { ...reopened.form(saved.id, actor).draft, lineItems: [] } }, actor)
    const frozenCold = service()
    frozenCold.importState(reopened.exportState())
    expect(frozenCold.exportState().contracts.find(row => row.id === saved.id)!.originalLineSnapshots).toEqual(beforeRemoval)
    expect(frozenCold.history(saved.id, actor).find(row => row.version === 2)!.draft.lineItems).toMatchObject([{ originalLineId: 'line-1' }])
  })

  it.each([{ amount: -1 }, { amount: 0 }, { amount: 100, lineItems: [{ ...request().draft.lineItems![0], originalLineId: 'foreign-line', changeAmount: 100, changeBasis: '未知原行' }] }])('拒绝协议负额、零额或不属本合同原行：%j', async (invalid) => {
    const owner = service()
    const main = await owner.execute(request(), actor)
    await expect(owner.execute({ ...request('invalid-supplement'), draft: { ...request().draft, isSupplement: true, originalContractId: main.id, deductions: [], ...invalid } }, actor)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(owner.rows()).toHaveLength(1)
    expect(owner.facts().supplements).toEqual([])
  })

  it('封存未应用原编号后，冷载的迟到请求仍拒绝；不同身份同编号独立授权', async () => {
    const owner = service()
    expect(owner.resolve('late-create', actor)).toEqual({ outcome: 'not-applied', commandId: 'late-create' })
    const reopened = service()
    reopened.importState(owner.exportState())
    await expect(reopened.execute(request('late-create'), actor)).rejects.toThrow('封存')
    const other = { ...actor, actorId: 'other-owner' }
    const command = { ...request('late-create'), actorId: other.actorId }
    await expect(reopened.execute(command, other)).resolves.toMatchObject({ commandId: 'late-create', id: 'contract-1' })
    expect(reopened.resolve('late-create', actor)).toEqual({ outcome: 'not-applied', commandId: 'late-create' })
  })
})
