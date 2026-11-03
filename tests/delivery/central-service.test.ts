import type { DeliveryArchiveCommand, DeliveryDraft } from '~/lib/delivery-record/contract'
import { describe, expect, it } from 'vitest'
import { createDeliveryCommandService } from '../../server/utils/delivery-command-service'

const session = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['delivery:read', 'delivery:write', 'project:list:read', 'supplier:list:read'] }
const references = { projects: [{ id: 'p1', name: '项目', dataOrigin: 'real' as const }], suppliers: [{ id: 's1', name: '分供方', dataOrigin: 'real' as const }] }
const payloadBase64 = btoa('%PDF-1.7\nimmutable test bytes\n%%EOF')
const source = { fileName: '送货.pdf', mimeType: 'application/pdf', fileSize: atob(payloadBase64).length, payloadBase64 }
const draft: DeliveryDraft = { projectId: 'p1', supplierId: 's1', orderNo: 'DH-1', deliveryDate: '2026-09-11', note: '', rawSiteText: '原始工地', reviewFlag: '', confirmations: { noOrderNoConfirmed: false, pricePendingConfirmed: false, amountReviewed: false }, lines: [{ materialName: '钢筋', spec: '', unit: '吨', qty: 2, unitPrice: 10, amount: 20, amountSource: 'calculated', note: '' }] }
function archive(overrides: Partial<DeliveryArchiveCommand> = {}): DeliveryArchiveCommand {
  return { action: 'archive', commandId: 'command-1', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write', origin: 'real', baseVersion: null, draft: structuredClone(draft), uploadBatchId: 'upload-1', source, ...overrides }
}
function setup(beforeCommit?: () => void) {
  let nextId = 0
  let currentReferences = structuredClone(references)
  const service = createDeliveryCommandService({ references: () => currentReferences, createId: () => `id-${++nextId}`, now: () => '2026-09-11T02:00:00.000Z', beforeCommit })
  return { service, setReferences: (value: typeof references) => {
    currentReferences = value
  } }
}

describe('送货原件与修订中央公开行为', () => {
  it('归档时为空的 OCR 原文也不能被后续结构化修订补写', () => {
    const { service } = setup()
    const first = service.execute(archive({ draft: { ...draft, rawSiteText: '' } }), session)
    service.execute({ action: 'revise', id: first.id, commandId: 'rewrite-ocr', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write', origin: 'real', baseVersion: first.version, reason: '修正结构化字段', draft: { ...draft, rawSiteText: '后来输入的原文' } }, session)
    expect(service.detail(first.id, session).rawSiteText).toBe('')
  })

  it('打印回执只能原子处置仍待打印的整批记录', () => {
    const { service } = setup()
    const first = service.execute(archive(), session)
    const second = service.execute(archive({ commandId: 'command-2', draft: { ...draft, orderNo: 'DH-2' } }), session)
    const envelope = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write' as const, origin: 'real' as const, action: 'print' as const }
    const printed = service.execute({ ...envelope, commandId: 'print-first', targets: [{ id: first.id, baseVersion: first.version }], disposition: 'printed' }, session)
    expect(() => service.execute({ ...envelope, commandId: 'print-both', targets: [{ id: second.id, baseVersion: second.version }, { id: first.id, baseVersion: printed.version }], disposition: 'excluded' }, session)).toThrow('待打印')
    expect(service.detail(second.id, session).printDisposition).toBe('pending')
    expect(service.detail(first.id, session).printDisposition).toBe('printed')
  })

  it.each(['printed', 'excluded'] as const)('整批 %s 重放重新核验每张逻辑单的当前祖先，不只验证最后结果 ID', (disposition) => {
    const { service, setReferences } = setup()
    const both = { ...references, projects: [...references.projects, { id: 'p2', name: '同名项目', dataOrigin: 'real' as const }] }
    setReferences(both)
    const first = service.execute(archive(), session)
    const second = service.execute(archive({ commandId: 'command-2', draft: { ...draft, projectId: 'p2', orderNo: 'DH-2' } }), session)
    const command = { action: 'print' as const, commandId: 'print-both', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write' as const, origin: 'real' as const, targets: [{ id: first.id, baseVersion: first.version }, { id: second.id, baseVersion: second.version }], disposition }
    const result = service.execute(command, session)
    setReferences({ ...both, projects: both.projects.filter(project => project.id === 'p2') })
    expect(service.detail(second.id, session).printDisposition).toBe(disposition)
    expect(() => service.execute(command, session)).toThrow('归属')
    setReferences(both)
    expect(service.execute(command, session)).toEqual(result)
    expect(service.history(first.id, session)).toHaveLength(2)
    expect(service.history(second.id, session)).toHaveLength(2)
  })
  it('客户端草稿不能覆盖服务端身份、来源或原件引用', () => {
    const { service } = setup()
    const spoofed = { ...draft, id: 'forged-id', dataOrigin: 'demo', assetId: 'other-owner-asset', createdBy: 'other-actor' }
    const result = service.execute(archive({ draft: spoofed }), session)
    const record = service.detail(result.id, session)
    expect(record.id).not.toBe('forged-id')
    expect(record).toMatchObject({ dataOrigin: 'real', createdBy: session.actorId })
    expect(record.assetId).not.toBe('other-owner-asset')
  })
  it('同一明确上传内两张逻辑单据共用不可变原件，命令重放不重复建档', () => {
    const { service } = setup()
    const first = service.execute(archive(), session)
    expect(service.execute(archive(), session)).toEqual(first)
    const second = service.execute(archive({ commandId: 'command-2', draft: { ...draft, orderNo: 'DH-2' } }), session)
    const rows = service.list(session).records
    expect(rows).toHaveLength(2)
    expect(rows[0]!.assetId).toBe(rows[1]!.assetId)
    expect(service.fileContent(first.id, rows[0]!.assetId!, session).payloadBase64).toBe(payloadBase64)
    expect(second.id).not.toBe(first.id)
    expect(JSON.stringify(service.list(session))).not.toContain(payloadBase64)
  })

  it('结构化修订只改变当前逻辑记录，历史版与共享原件保持不变', () => {
    const { service } = setup()
    const first = service.execute(archive(), session)
    const second = service.execute(archive({ commandId: 'command-2', draft: { ...draft, orderNo: 'DH-2' } }), session)
    const result = service.execute({ ...archive(), action: 'revise', id: first.id, commandId: 'revise-1', baseVersion: first.version, reason: '对照原件修正数量', draft: { ...draft, lines: [{ ...draft.lines[0]!, qty: 3, amount: 30 }] } }, session)
    expect(result.version).toBe('2')
    const history = service.history(first.id, session)
    expect(history).toHaveLength(2)
    expect(history[1]).toMatchObject({ reason: '对照原件修正数量', actorId: session.actorId, before: { lines: [{ qty: 2 }] }, after: { lines: [{ qty: 3 }] } })
    expect(service.detail(second.id, session).lines[0]!.qty).toBe(2)
    expect(service.version(first.id, '1', session).lines[0]!.qty).toBe(2)
    expect(JSON.stringify(history)).not.toContain(payloadBase64)
  })

  it('补传建立新的资产引用，旧版本仍可按所属记录读取原件', () => {
    const { service } = setup()
    const first = service.execute(archive(), session)
    const originalAssetId = service.detail(first.id, session).assetId!
    const replacement = { ...source, payloadBase64: btoa('%PDF-1.7\nreplacement\n%%EOF'), fileSize: 28 }
    replacement.fileSize = atob(replacement.payloadBase64).length
    service.execute({ ...archive(), action: 'source', id: first.id, commandId: 'source-1', baseVersion: first.version, reason: '补充正确原件', source: replacement }, session)
    const current = service.detail(first.id, session)
    expect(current.assetId).not.toBe(originalAssetId)
    expect(service.fileContent(first.id, originalAssetId, session).payloadBase64).toBe(payloadBase64)
    expect(service.fileContent(first.id, current.assetId!, session).payloadBase64).toBe(replacement.payloadBase64)
  })

  it('缺原件和缺价格保持真实状态，不伪造正文或价格分析资格', () => {
    const { service } = setup()
    const result = service.execute(archive({ source: null, draft: { ...draft, confirmations: { pricePendingConfirmed: true }, lines: [{ ...draft.lines[0]!, unitPrice: null, amount: null }] } }), session)
    expect(service.detail(result.id, session)).toMatchObject({ hasSourceFile: false, assetId: null, reviewFlag: '价格待补录' })
    expect(() => service.fileContent(result.id, 'same-name-local-file', session)).toThrow('原件')
  })

  it('版本冲突、空修订原因、重用命令改内容都不改变已归档记录', () => {
    const { service } = setup()
    const first = service.execute(archive(), session)
    const command = { ...archive(), action: 'revise' as const, id: first.id, commandId: 'revision-1', baseVersion: '0', reason: '修订', draft: { ...draft, note: '新备注' } }
    expect(() => service.execute(command, session)).toThrow('已更新')
    expect(() => service.execute({ ...command, baseVersion: first.version, reason: '' }, session)).toThrow('原因')
    expect(() => service.execute(archive({ draft: { ...draft, note: '不同内容' } }), session)).toThrow('命令')
    expect(service.detail(first.id, session).version).toBe('1')
  })

  it.each([
    { ...source, fileSize: source.fileSize + 1 },
    { ...source, payloadBase64: 'not-base64' },
    { ...source, mimeType: 'text/html' },
  ])('无效原件不会留下上传批次或逻辑记录', (invalidSource) => {
    const { service } = setup()
    expect(() => service.execute(archive({ source: invalidSource }), session)).toThrow('原件')
    expect(service.list(session).records).toHaveLength(0)
    expect(service.execute(archive(), session).version).toBe('1')
  })

  it('提交故障后无半成品，可使用原命令重试', () => {
    let fail = true
    const { service } = setup(() => {
      if (fail)
        throw new Error('injected commit failure')
    })
    expect(() => service.execute(archive(), session)).toThrow('injected')
    expect(service.list(session).records).toHaveLength(0)
    fail = false
    expect(service.execute(archive(), session).version).toBe('1')
  })

  it.each((['delivery:read', 'project:list:read', 'supplier:list:read']).map(input => ({ input })))('测试会话、workspace、origin和当前权限均不可借同名或共享资产绕过：输入案例 %#', ({ input: removed }) => {
    const { service } = setup()
    const first = service.execute(archive(), session, 'test-one')
    const assetId = service.detail(first.id, session, 'test-one').assetId!
    expect(() => service.detail(first.id, session, 'test-two')).toThrow('不存在')
    expect(() => service.detail(first.id, { ...session, workspaceId: 'workspace-two' }, 'test-one')).toThrow('不存在')
    expect(() => service.execute({ ...archive(), origin: 'demo' }, session)).toThrow('来源')
    const denied = { ...session, capabilities: session.capabilities.filter(cap => cap !== removed) }
    expect(() => service.fileContent(first.id, assetId, denied, 'test-one')).toThrow('权限')
    expect(() => service.history(first.id, denied, 'test-one')).toThrow('权限')
    expect(() => service.list(denied, 'test-one')).toThrow('权限')
  })

  it('归档后祖先消失或换来源，正文、历史与新写入都重验当前关系', () => {
    const { service, setReferences } = setup()
    const first = service.execute(archive(), session)
    const assetId = service.detail(first.id, session).assetId!
    setReferences({ ...references, projects: [] })
    expect(() => service.fileContent(first.id, assetId, session)).toThrow('归属')
    expect(() => service.history(first.id, session)).toThrow('归属')
    expect(() => service.list(session)).toThrow('归属')
    expect(() => service.execute({ ...archive(), action: 'source', id: first.id, commandId: 'source-1', baseVersion: first.version, reason: '补传' }, session)).toThrow('归属')
  })

  it.each([
    { name: '缺少分供方', invalidDraft: { ...draft, supplierId: null }, message: '请依据原件人工选择分供方' },
    { name: '缺少送货日期', invalidDraft: { ...draft, deliveryDate: '' }, message: '请依据原件人工填写送货日期' },
    { name: '缺少数量', invalidDraft: { ...draft, lines: [{ ...draft.lines[0]!, qty: null }] }, message: '每条明细必须确认材料名称、单位和非零数量' },
    { name: '缺少单位', invalidDraft: { ...draft, lines: [{ ...draft.lines[0]!, unit: '' }] }, message: '每条明细必须确认材料名称、单位和非零数量' },
  ])('归档不自动补全：$name', ({ invalidDraft, message }) => {
    const { service } = setup()
    expect(() => service.execute(archive({ draft: invalidDraft }), session)).toThrow(message)
    expect(service.list(session).records).toHaveLength(0)
  })
})
