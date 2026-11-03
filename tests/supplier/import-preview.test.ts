import type { BusinessSession } from '../../server/utils/business-session'
import { describe, expect, it } from 'vitest'
import { createHttpSupplierCommandRepository } from '~/lib/supplier/command-http-repository'
import { parseSupplierImportCommandRequest, parseSupplierImportPreviewRequest } from '../../server/utils/supplier-command-request'
import { createSupplierCommandService } from '../../server/utils/supplier-command-service'

const session: BusinessSession = { workspaceId: 'preview-workspace', actorId: 'preview-actor', capabilities: ['supplier:list:read', 'supplier:write', 'supplier:sensitive:read'] }
function command(id: string, draft: Record<string, unknown>, decision?: unknown) {
  return parseSupplierImportCommandRequest({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'supplier:write', commandId: id, draft, ...(decision ? { decision } : {}) })
}

describe('分供方导入预览和确认', () => {
  it('候选与差异先展示；未确认不得覆盖，确认目标后只覆盖映射字段', async () => {
    const service = createSupplierCommandService({ createId: () => 'supplier-1' })
    await service.importRow(command('create-1', { name: '合成材料公司', externalRef: 'OLD-1', contact: '原联系人', mainBusiness: '保留内容' }), session)
    const draft = { name: '合成材料公司', externalRef: 'OLD-1', contact: '新联系人' }
    const preview = service.previewImport([draft], session)[0]!
    expect(preview.candidates).toEqual([{ id: 'supplier-1', version: '1', name: '合成材料公司', matchedBy: ['name', 'externalRef'], fields: { name: '合成材料公司', externalRef: 'OLD-1', contact: '原联系人' } }])
    await expect(service.importRow(command('without-confirm', draft), session)).rejects.toThrow('预览并确认')
    const decision = { kind: 'replace', fingerprint: preview.fingerprint, id: 'supplier-1', version: '1' }
    const applied = await service.importRow(command('replace-1', draft, decision), session)
    expect(applied.version).toBe('2')
    expect(service.form('supplier-1', session).draft).toMatchObject({ contact: '新联系人', mainBusiness: '保留内容' })
    expect(await service.importRow(command('replace-1', draft, decision), session)).toEqual(applied)
  })

  it('候选或原字段发生变化后拒绝旧选择；未匹配也需重验', async () => {
    let id = 0
    const service = createSupplierCommandService({ createId: () => `supplier-${++id}` })
    const draft = { name: '合成同名公司' }
    const none = service.previewImport([draft], session)[0]!
    await service.importRow(command('new-first', draft), session)
    await expect(service.importRow(command('stale-create', draft, { kind: 'create', fingerprint: none.fingerprint }), session)).rejects.toThrow('重新预览')
    const candidate = service.previewImport([draft], session)[0]!
    const target = candidate.candidates[0]!
    await service.importRow(command('edit-other', { name: '合成同名公司', note: '已变化' }, { kind: 'replace', fingerprint: service.previewImport([{ name: '合成同名公司', note: '已变化' }], session)[0]!.fingerprint, id: target.id, version: target.version }), session)
    await expect(service.importRow(command('stale-replace', draft, { kind: 'replace', fingerprint: candidate.fingerprint, id: target.id, version: target.version }), session)).rejects.toThrow('重新预览')
  })

  it('确认新建也不能重复占用其他分供方的外部旧 ID', async () => {
    const service = createSupplierCommandService({ createId: () => 'supplier-1' })
    await service.importRow(command('external-first', { name: '合成甲', externalRef: 'OLD-1' }), session)
    const draft = { name: '合成乙', externalRef: 'OLD-1' }
    const preview = service.previewImport([draft], session)[0]!
    await expect(service.importRow(command('external-duplicate', draft, { kind: 'create', fingerprint: preview.fingerprint }), session)).rejects.toThrow('外部旧 ID 已关联')
    expect(service.rows()).toHaveLength(1)
  })

  it('未映射外部旧 ID 时替换保留原值；显式空值才清空，新建未映射为空', async () => {
    let id = 0
    const service = createSupplierCommandService({ createId: () => `supplier-${++id}` })
    await service.importRow(command('external-seed', { name: '合成甲', externalRef: 'OLD-1' }), session)
    const update = { name: '合成甲', contact: '新联系人' }
    const first = service.previewImport([update], session)[0]!
    await service.importRow(command('external-keep', update, { kind: 'replace', fingerprint: first.fingerprint, id: 'supplier-1', version: '1' }), session)
    expect(service.form('supplier-1', session).draft.externalRef).toBe('OLD-1')
    const clear = { name: '合成甲', externalRef: '' }
    const second = service.previewImport([clear], session)[0]!
    await service.importRow(command('external-clear', clear, { kind: 'replace', fingerprint: second.fingerprint, id: 'supplier-1', version: '2' }), session)
    expect(service.form('supplier-1', session).draft.externalRef).toBe('')
    await service.importRow(command('external-new', { name: '合成乙' }), session)
    expect(service.form('supplier-2', session).draft.externalRef).toBe('')
  })

  it('没有敏感资料权限不能用受限字段探测，伪造决定和主档字段均被拒绝', async () => {
    const service = createSupplierCommandService()
    const restricted = { ...session, capabilities: ['supplier:list:read', 'supplier:write'] }
    expect(() => service.previewImport([{ name: '合成', taxNo: 'synthetic' }], restricted)).toThrow('敏感资料查看权限')
    await service.importRow(command('sensitive-create', { name: '合成', taxNo: 'synthetic' }), session)
    expect(() => service.previewImport([{ name: '合成', taxNo: 'synthetic' }], restricted)).toThrow('敏感资料查看权限')
    expect(() => service.previewImport([{ name: '不同名称', taxNo: 'synthetic' }], restricted)).toThrow('敏感资料查看权限')
    expect(() => service.previewImport([{ name: '不同名称', uniqueCode: 'synthetic' }], restricted)).toThrow('敏感资料查看权限')
    await expect(service.importRow(command('restricted-write', { name: '不同名称', taxNo: 'synthetic' }), restricted)).rejects.toThrow('敏感资料查看权限')
    expect(() => parseSupplierImportPreviewRequest({ drafts: [{ name: '合成', id: 'other' }] })).toThrow()
    expect(() => command('forged', { name: '合成' }, { kind: 'replace', fingerprint: '0'.repeat(64), id: 'supplier-1', version: '0' })).toThrow()
  })

  it('预览响应绑定可信会话与逐行身份，缺行或伪造字段不能进入确认界面', async () => {
    const service = createSupplierCommandService({ createId: () => 'supplier-1' })
    await service.importRow(command('http-create', { name: '合成材料' }), session)
    const drafts = [{ name: '合成材料', contact: '合成联系人' }]
    const payload = { workspaceId: session.workspaceId, actorId: session.actorId, capabilities: [...session.capabilities], previews: service.previewImport(drafts, session) }
    const repository = createHttpSupplierCommandRepository({ fetcher: async () => payload })
    expect(await repository.previewImport(drafts)).toEqual(payload)
    const broken = createHttpSupplierCommandRepository({ fetcher: async () => ({ ...payload, previews: [] }) })
    await expect(broken.previewImport(drafts)).rejects.toThrow('行数不完整')
    const fields = { ...payload.previews[0]!.candidates[0]!.fields, bankAccount: '不应泄露' }
    const forged = createHttpSupplierCommandRepository({ fetcher: async () => ({ ...payload, previews: [{ ...payload.previews[0], candidates: [{ ...payload.previews[0]!.candidates[0], fields }] }] }) })
    await expect(forged.previewImport(drafts)).rejects.toThrow('字段不完整')
  })
})
