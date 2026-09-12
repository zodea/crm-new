import { afterEach, describe, expect, it, vi } from 'vitest'
import { blankQuantityTemplateDraft, editableQuantityTemplateDraft } from '~/lib/quantity/template'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'

const context = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['quantity:read', 'quantity:write', 'project:list:read', 'construction-contract:read', 'owner-document:read'] }
const query = { projectId: 'project', origin: 'real' as const, includeDemo: false }
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0))
    await close()
})

function fixture() {
  const data = { projectId: 'project', sourceVersion: 'boq:1', lines: [{ id: 'boq', contractId: 'contract', contractName: '施工合同', contractNo: 'HT', itemName: '抹灰', unit: '㎡', qty: 12 as number | null, unitPrice: 2, approvedDeltaQty: 8, effectiveUnitPrice: 3, building: null, updatedAt: null }] }
  const source = vi.fn(async () => structuredClone(data))
  const instance = createQuantityTestInstance({ session: () => context, projects: () => [{ id: 'project', name: '项目', code: 'P', dataOrigin: 'real' }], boq: source })
  cleanups.push(() => instance.close())
  const draft = blankQuantityTemplateDraft('project')
  draft.code = 'A'
  draft.name = 'A户型'
  draft.newItems = [{ key: 'item', code: 'I', name: '抹灰', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }]
  draft.lines = [{ key: 'line', id: null, roomKey: draft.rooms[0]!.key, itemId: 'item', boqLineId: 'boq', recognizedContractQty: 999, contractQty: 10, provisionalQty: null, fieldFormula: '5*2', fieldQty: 10, note: '', sortOrder: 1 }]
  let sequence = 0
  const save = async (current = draft) => instance.execute({ ...context, requiredCapability: 'quantity:write', commandId: `save-${++sequence}`, projectId: 'project', origin: 'real', baseVersion: (await instance.templates(query)).sourceVersion, action: { kind: 'save-template', draft: current } })
  return { instance, draft, data, source, save }
}

describe('中央户型人工关联清单', () => {
  it('使用真实外部身份保存原量，普通编辑和解除保留识别值；重选未知量不补零', async () => {
    const { instance, data, save } = fixture()
    const saved = await save()
    let workspace = (await instance.templates(query)).data
    expect(workspace.lines[0]).toMatchObject({ boqLineId: 'boq', recognizedContractQty: 12, contractQty: 10 })
    data.lines[0]!.qty = 88
    data.sourceVersion = 'boq:2'
    let draft = editableQuantityTemplateDraft(workspace, saved.id)
    draft.lines[0]!.note = '普通编辑'
    await save(draft)
    workspace = (await instance.templates(query)).data
    expect(workspace.lines[0]!.recognizedContractQty).toBe(12)
    draft = editableQuantityTemplateDraft(workspace, saved.id)
    draft.lines[0]!.boqLineId = null
    const cleared = await save(draft)
    workspace = (await instance.templates(query)).data
    expect(workspace.lines[0]).toMatchObject({ boqLineId: null, recognizedContractQty: 12 })
    await instance.execute({ ...context, requiredCapability: 'quantity:write', commandId: 'undo-clear', projectId: 'project', origin: 'real', baseVersion: (await instance.templates(query)).sourceVersion, action: { kind: 'undo-template', logIds: cleared.logIds, allowArchivedEdit: false } })
    workspace = (await instance.templates(query)).data
    expect(workspace.lines[0]).toMatchObject({ boqLineId: 'boq', recognizedContractQty: 12 })
    data.lines.push({ ...data.lines[0]!, id: 'unknown-qty', qty: null })
    draft = editableQuantityTemplateDraft(workspace, saved.id)
    draft.lines[0]!.boqLineId = 'unknown-qty'
    await save(draft)
    expect((await instance.templates(query)).data.lines[0]).toMatchObject({ boqLineId: 'unknown-qty', recognizedContractQty: null, contractQty: 10 })
  })

  it('清单失效、父合同身份变化和保存中来源变更均拒绝且不落半条模板', async () => {
    const missing = fixture()
    missing.data.lines = []
    await expect(missing.save()).rejects.toThrow('关联清单不存在')
    expect((await missing.instance.templates(query)).data.templates).toEqual([])
    const changed = fixture()
    changed.source.mockImplementationOnce(async () => structuredClone(changed.data))
      .mockImplementationOnce(async () => ({ ...structuredClone(changed.data), sourceVersion: 'boq:changed' }))
    await expect(changed.save()).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    expect((await changed.instance.templates(query)).data.templates).toEqual([])
    const bound = fixture()
    const saved = await bound.save()
    bound.data.lines[0]!.contractId = 'other-contract'
    await expect(bound.save(editableQuantityTemplateDraft((await bound.instance.templates(query)).data, saved.id))).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  })
})
