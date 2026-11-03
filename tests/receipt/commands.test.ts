import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ReceiptCommand } from '../../app/lib/receipt/contract'
import { describe, expect, it } from 'vitest'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { command, draft, references, session } from './fixtures'

describe('普通收款中央命令与公开读回', () => {
  it('核对原键保留首次回执，未应用键永久封存，撤权或其他操作人不能读取原回执', () => {
    const instance = createReceiptCommandTestInstance({ references: () => references, createId: () => 'receipt-recovery' })
    const original = instance.execute(command(), session)
    expect(instance.resolve(original.commandId, session)).toEqual({ outcome: 'applied', result: original })
    expect(instance.resolve('receipt-never-applied', session)).toEqual({ outcome: 'not-applied', commandId: 'receipt-never-applied' })
    expect(() => instance.execute(command({ commandId: 'receipt-never-applied' }), session)).toThrow(/封存/)
    expect(() => instance.resolve(original.commandId, { ...session, capabilities: [] })).toThrow(/权限/)
    expect(instance.resolve(original.commandId, { ...session, actorId: 'other' })).toEqual({ outcome: 'not-applied', commandId: original.commandId })
    expect(instance.resolve(original.commandId, session)).toEqual({ outcome: 'applied', result: original })
  })
  it('非空银行流水号在草稿与提交记录间唯一，编辑自身与空流水号不误拦截', () => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    const first = instance.execute(command({ draft: { ...draft, bankSerialNo: 'BANK-UNIQUE' } }), session)
    expect(instance.facts().rows).toHaveLength(1)
    instance.execute(command({ id: first.id, baseVersion: first.version, commandId: 'own-bank', draft: { ...draft, bankSerialNo: 'BANK-UNIQUE' } }), session)
    instance.execute(command({ commandId: 'empty-bank-1', draft: { ...draft, bankSerialNo: '' } }), session)
    instance.execute(command({ commandId: 'empty-bank-2', draft: { ...draft, bankSerialNo: ' ' } }), session)
    expect(instance.facts().rows).toHaveLength(3)
  })

  it.each(Array.from(['draft', 'save', 'submit'] as const).map(input => ({ input })))('非空银行流水号在草稿与提交记录间唯一，编辑自身与空流水号不误拦截：输入组合 1 案例 %#', ({ input: action }) => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    instance.execute(command({ draft: { ...draft, bankSerialNo: 'BANK-UNIQUE' } }), session)
    expect(() => instance.execute(command({ commandId: `duplicate-${action}`, action, draft: { ...draft, bankSerialNo: ' BANK-UNIQUE ' } }), session)).toThrow(/银行流水号/)
    expect(instance.facts().rows).toHaveLength(1)
  })

  it.each(['project:list:read', 'customer:list:read', 'construction-contract:read'])('写入复验 %s，受限关联不能通过手工请求或重试绕过', (capability) => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    const request = command({ draft: { ...draft, contractId: 'contract-a' } })
    const saved = instance.execute(request, session)
    const restricted = { ...session, capabilities: session.capabilities.filter(value => value !== capability) }
    expect(() => instance.execute(request, restricted)).toThrow(/权限/)
    expect(() => instance.execute(command({ ...request, commandId: 'forbidden-new' }), restricted)).toThrow(/权限/)
    expect(() => instance.execute(command({ ...request, id: saved.id, baseVersion: saved.version, commandId: 'forbidden-edit', draft: { ...request.draft, note: '不可写入' } }), restricted)).toThrow(/权限/)
    expect(() => instance.execute(command({ ...request, id: saved.id, baseVersion: saved.version, commandId: 'forbidden-clear', action: 'draft', draft: { ...request.draft, projectId: null, customerId: null, contractId: null } }), restricted)).toThrow(/权限/)
    expect(instance.form(saved.id, session).draft.note).toBe(draft.note)
    expect(instance.facts().rows).toHaveLength(1)
  })

  it('无施工合同的收款提交后全部字段从同一事实读回，无需最终结算文档', () => {
    const instance = createReceiptCommandTestInstance({ references: () => references, createId: () => 'receipt-a', now: () => '2026-09-11T00:00:00.000Z' })
    const result = instance.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'receipt:write',
      commandId: 'create-a',
      baseVersion: null,
      origin: 'real',
      action: 'submit',
      draft,
      attachments: {},
    }, session)
    expect(result).toMatchObject({ id: 'receipt-a', commandId: 'create-a', version: '1' })
    expect(instance.form(result.id, session)).toMatchObject({
      id: 'receipt-a',
      dataOrigin: 'real',
      draft: { ...draft, status: 'submitted' },
      createdBy: 'actor-a',
      updatedBy: 'actor-a',
      version: '1',
      attachments: [],
    })
    expect(instance.facts().rows).toEqual([expect.objectContaining({ id: 'receipt-a', draft: { ...draft, status: 'submitted' } })])
  })

  it.each([
    { name: '不存在的项目', patch: { projectId: 'missing' }, field: 'projectId', error: '项目不存在、已删除或不可读' },
    { name: '不存在的客户', patch: { projectId: null, customerId: 'missing' }, field: 'customerId', error: '付款方客户不存在、已删除或不可读' },
    { name: '不存在的合同', patch: { contractId: 'missing' }, field: 'contractId', error: '施工合同不存在、已删除或不可读' },
    { name: '未选项目', patch: { projectId: null }, field: 'projectId', error: '请选择项目' },
    { name: '未选客户', patch: { customerId: null }, field: 'customerId', error: '请选择付款方客户' },
    { name: '无效日期', patch: { receiptDate: '2026-02-30' }, field: 'receiptDate', error: '请输入真实有效的日期' },
    { name: '空金额', patch: { amount: null }, field: 'amount', error: '收款金额必须大于 0' },
    { name: '零金额', patch: { amount: '0.00' }, field: 'amount', error: '收款金额必须大于 0' },
    { name: '负金额', patch: { amount: '-1.00' }, field: 'amount', error: '金额必须是安全范围内的非负两位小数' },
    { name: '超出分精度', patch: { amount: '1.005' }, field: 'amount', error: '金额必须是安全范围内的非负两位小数' },
  ])('提交拒绝$name且不产生收款事实', ({ patch, field, error }) => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    expect(() => instance.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'receipt:write',
      commandId: 'invalid',
      baseVersion: null,
      origin: 'real',
      action: 'submit',
      draft: { ...draft, ...patch },
      attachments: {},
    }, session)).toThrowError(expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed', fieldErrors: expect.objectContaining({ [field]: [error] }) }) }))
    expect(instance.facts().rows).toEqual([])
  })

  it.each([
    { name: '客户不是项目主客户', patch: { customerId: 'customer-b' }, field: 'customerId', error: '付款方客户必须是所选项目的主客户' },
    { name: '合同属于其他项目', patch: { contractId: 'contract-b' }, field: 'contractId', error: '施工合同必须属于所选项目和付款方客户' },
    { name: '保存时缺少收款日期', patch: { receiptDate: '' }, field: 'receiptDate', error: '请填写收款日期' },
    { name: '保存时金额为零', patch: { amount: '0.00' }, field: 'amount', error: '收款金额必须大于 0' },
  ])('保存拒绝$name且不产生事实', ({ patch, field, error }) => {
    const extended = {
      projects: [...references.projects, { id: 'project-b', name: '项目乙', customerId: 'customer-b' }],
      customers: [...references.customers, { id: 'customer-b', name: '乙方客户' }],
      contracts: [...references.contracts, { ...references.contracts[0]!, id: 'contract-b', projectId: 'project-b', customerId: 'customer-b' }],
    }
    const instance = createReceiptCommandTestInstance({ references: () => extended })
    expect(() => instance.execute(command({ action: 'save', draft: { ...draft, ...patch } }), session)).toThrowError(expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed', fieldErrors: expect.objectContaining({ [field]: [error] }) }) }))
    expect(instance.facts().rows).toEqual([])
  })

  it('不完整草稿保留空金额与明确零，保存不接受客户端伪造已确认状态', () => {
    let nextId = 0
    const instance = createReceiptCommandTestInstance({ references: () => references, createId: () => `receipt-${++nextId}` })
    const blank = { ...draft, projectId: null, customerId: null, receiptDate: '', amount: null }
    const first = instance.execute({ ...command(), action: 'draft', draft: blank }, session)
    const second = instance.execute({ ...command(), commandId: 'zero', action: 'draft', draft: { ...blank, amount: '0.00' } }, session)
    expect(instance.form(first.id, session).draft.amount).toBeNull()
    expect(instance.form(second.id, session).draft.amount).toBe('0.00')
    const saved = instance.execute({ ...command(), id: first.id, commandId: 'save', baseVersion: '1', action: 'save', draft: { ...draft, status: 'confirmed' } }, session)
    expect(instance.form(saved.id, session).draft.status).toBe('draft')
    instance.execute({ ...command(), id: first.id, commandId: 'submit', baseVersion: '2' }, session)
    instance.execute({ ...command(), id: first.id, commandId: 'edit', baseVersion: '3', action: 'save', draft: { ...draft, note: '已提交后编辑', status: 'cancelled' } }, session)
    expect(instance.form(first.id, session).draft).toMatchObject({ status: 'submitted', note: '已提交后编辑' })
  })

  it('重复命令返回原结果，变更载荷复用编号及旧版本均不覆盖；不存在的编辑不会偷偷新建', () => {
    let nextId = 0
    const instance = createReceiptCommandTestInstance({ references: () => references, createId: () => `receipt-${++nextId}` })
    const first = instance.execute(command(), session)
    expect(instance.execute(command(), session)).toEqual(first)
    expect(instance.facts().rows).toHaveLength(1)
    expect(() => instance.execute({ ...command(), draft: { ...draft, amount: '999.00' } }, session)).toThrow(/命令/)
    expect(() => instance.execute({ ...command(), id: first.id, commandId: 'stale', baseVersion: '0' }, session)).toThrow(/更新|版本/)
    expect(() => instance.execute({ ...command(), id: 'missing', commandId: 'missing', baseVersion: '1' }, session)).toThrow(/不存在/)
    expect(instance.form(first.id, session).draft.amount).toBe('120.35')
  })

  it('读取权限与写权限独立，演示来源、伪造会话及未知动作不能写入', () => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    const first = instance.execute(command(), session)
    expect(instance.form(first.id, { ...session, capabilities: ['receipt:read'] })).toMatchObject({ id: first.id })
    expect(() => instance.form(first.id, { ...session, capabilities: [] })).toThrow(/权限/)
    expect(() => instance.execute(command(), { ...session, capabilities: ['receipt:read'] })).toThrow(/权限/)
  })

  it.each(Array.from([{ origin: 'demo' }, { actorId: 'other' }, { workspaceId: 'other' }, { commandId: '' }, { action: 'confirm' }]).map(input => ({ input })))('读取权限与写权限独立，演示来源、伪造会话及未知动作不能写入：输入组合 1 案例 %#', ({ input: patch }) => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    const first = instance.execute(command(), session)
    expect(instance.form(first.id, { ...session, capabilities: ['receipt:read'] })).toMatchObject({ id: first.id })
    expect(() => instance.form(first.id, { ...session, capabilities: [] })).toThrow(/权限/)
    expect(() => instance.execute(command(patch as Partial<ReceiptCommand>), session)).toThrow()
  })

  it('附件正文随收款保存、刷新读回和删除恢复，跨收款附件操作不产生部分修改', () => {
    let nextId = 0
    const instance = createReceiptCommandTestInstance({ references: () => references, createId: () => `id-${++nextId}` })
    const first = instance.execute({ ...command(), attachments: { add: [{ fileName: '收款凭证.txt', fileSize: 6, mimeType: 'text/plain', payloadBase64: '5pS25qy+' }] } }, session)
    const attachmentId = first.attachmentIds[0]!
    expect(instance.form(first.id, session).attachments).toEqual([expect.objectContaining({ id: attachmentId, ownerId: first.id, fileSize: 6, deletedAt: null })])
    expect(instance.fileContent(first.id, attachmentId, session)).toMatchObject({ payloadBase64: '5pS25qy+', mimeType: 'text/plain' })
    const second = instance.execute({ ...command(), commandId: 'second' }, session)
    expect(() => instance.execute({ ...command(), commandId: 'cross', id: second.id, baseVersion: '1', draft: { ...draft, note: '不应保存' }, attachments: { removeIds: [attachmentId] } }, session)).toThrow(/附件/)
    expect(instance.form(second.id, session)).toMatchObject({ version: '1', draft: { note: draft.note } })
    const deleted = instance.execute({ ...command(), commandId: 'delete', id: first.id, baseVersion: '1', attachments: { removeIds: [attachmentId] } }, session)
    expect(() => instance.fileContent(first.id, attachmentId, session)).toThrow(/删除/)
    instance.execute({ ...command(), commandId: 'restore', id: first.id, baseVersion: deleted.version, attachments: { restoreIds: [attachmentId] } }, session)
    expect(instance.fileContent(first.id, attachmentId, session).payloadBase64).toBe('5pS25qy+')
    expect(() => instance.fileContent(first.id, attachmentId, { ...session, capabilities: [] })).toThrow(/权限/)
  })

  it('合法空文件随收款保存并读回', () => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    expect(instance.facts().rows).toEqual([])
    const result = instance.execute({ ...command(), attachments: { add: [{ fileName: '空文件', fileSize: 0, payloadBase64: '' }] } }, session)
    expect(instance.fileContent(result.id, result.attachmentIds[0]!, session).payloadBase64).toBe('')
  })

  it.each(Array.from([
    { fileName: '只有路径', filePath: 'C:/secret.txt', fileSize: 1 },
    { fileName: '大小不符', fileSize: 9, payloadBase64: 'YQ==' },
    { fileName: '错误编码', fileSize: 1, payloadBase64: '!!!!' },
  ]).map(input => ({ input })))('无正文、错误大小及非法编码拒绝整个新建，合法空文件仍能保存：输入组合 1 案例 %#', ({ input: file }) => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    expect(() => instance.execute({ ...command(), attachments: { add: [file] } }, session)).toThrow(/附件/)
  })

  it('迁移准备无副作用，重复同步保留编辑，危险回滚保全修改、原件和回执', () => {
    const instance = createReceiptCommandTestInstance({ references: () => references, createId: () => 'independent' })
    const snapshot: CoreMigrationSnapshotDTO = { authority: 'central', activeBatchId: 'batch-a', entities: [{
      entityType: 'receipt_registrations',
      id: 'migrated',
      legacyId: 'old-a',
      name: draft.no,
      references: { projectId: draft.projectId, customerId: draft.customerId, contractId: null },
      amount: draft.amount,
      quantity: null,
      deletedAt: null,
      batchId: 'batch-a',
      attributes: { ...draft, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z', attachmentsJson: JSON.stringify([{ id: 'm-file', fileName: '旧凭证.txt', fileSize: 1, mimeType: 'text/plain', payloadBase64: 'YQ==', uploadedAt: '2025-01-01T00:00:00.000Z', deletedAt: null }]) },
    }] }
    const commit = instance.prepareMigrationSnapshot(snapshot)
    expect(instance.facts().rows).toEqual([])
    commit()
    expect(instance.form('migrated', session)).toMatchObject({ draft, createdAt: '2025-01-01T00:00:00.000Z' })
    expect(instance.fileContent('migrated', 'm-file', session).payloadBase64).toBe('YQ==')
    const modified = instance.execute({ ...command(), id: 'migrated', baseVersion: '1', action: 'save', draft: { ...draft, note: '中央修改' } }, session)
    instance.prepareMigrationSnapshot(snapshot)()
    expect(instance.form('migrated', session).draft.note).toBe('中央修改')
    const created = instance.execute({ ...command(), commandId: 'independent' }, session)
    expect(() => instance.prepareMigrationSnapshot({ authority: 'local', activeBatchId: null, entities: [] })).toThrow(/后来修改/)
    expect(instance.facts().rows.map(row => row.id)).toEqual(['migrated', created.id])
    expect(instance.execute({ ...command(), commandId: 'independent' }, session)).toEqual(created)
    expect(instance.fileContent('migrated', 'm-file', session).payloadBase64).toBe('YQ==')
    expect(instance.resolve(modified.commandId, session)).toEqual({ outcome: 'applied', result: modified })
    const untouched = createReceiptCommandTestInstance({ references: () => references, createId: () => 'safe-independent' })
    untouched.prepareMigrationSnapshot(snapshot)()
    const independent = untouched.execute({ ...command(), commandId: 'safe-independent' }, session)
    untouched.prepareMigrationSnapshot({ authority: 'local', activeBatchId: null, entities: [] })()
    expect(untouched.facts().rows.map(row => row.id)).toEqual([independent.id])
    expect(untouched.resolve(independent.commandId, session)).toEqual({ outcome: 'applied', result: independent })
  })

  it.each(([{ ownerId: 'another-receipt' }, { payloadEncoding: 'utf8' }]).map(input => ({ input })))('迁入缺正文附件保留元数据并明确不可读；无效载荷使准备整体失败：输入案例 %#', ({ input: fields }) => {
    const instance = createReceiptCommandTestInstance({ references: () => references })
    const snapshot: CoreMigrationSnapshotDTO = { authority: 'central', activeBatchId: 'batch-a', entities: [{
      entityType: 'receipt_registrations',
      id: 'historical',
      legacyId: 'old-a',
      name: draft.no,
      references: { projectId: draft.projectId, customerId: draft.customerId },
      amount: null,
      quantity: null,
      deletedAt: null,
      batchId: 'batch-a',
      attributes: { ...draft, amount: null, status: 'draft', attachmentsJson: JSON.stringify([{ id: 'historical-file', fileName: '旧凭证', fileSize: 10, filePath: 'C:/old.pdf', deletedAt: null }]) },
    }] }
    instance.prepareMigrationSnapshot(snapshot)()
    expect(instance.form('historical', session)).toMatchObject({ draft: { amount: null }, attachments: [expect.objectContaining({ id: 'historical-file' })] })
    expect(() => instance.fileContent('historical', 'historical-file', session)).toThrow(/历史附件未保存正文/)
    const invalid = structuredClone(snapshot)
    invalid.entities[0]!.id = 'invalid'
    invalid.entities[0]!.attributes.attachmentsJson = JSON.stringify([{ id: 'invalid-file', fileName: '坏正文', fileSize: 10, payloadBase64: 'YQ==' }])
    expect(() => instance.prepareMigrationSnapshot(invalid)).toThrow(/附件/)
    expect(instance.facts().rows.map(row => row.id)).toEqual(['historical'])
    invalid.entities[0]!.attributes.attachmentsJson = JSON.stringify([{ id: 'foreign-file', fileName: '坏归属凭证', fileSize: 1, payloadBase64: 'YQ==', ...fields }])
    expect(() => instance.prepareMigrationSnapshot(invalid)).toThrow(/附件|编码/)
    expect(instance.facts().rows.map(row => row.id)).toEqual(['historical'])
  })
})
