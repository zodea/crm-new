import { describe, expect, it } from 'vitest'
import { createReceiptRepository } from '../../app/lib/receipt/repository'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { createReceiptReadService } from '../../server/utils/receipt-read-service'
import { command, draft, references, session } from './fixtures'

describe('普通收款中央读模型与 Repository', () => {
  it('repository 按本次来源查询拒绝串入的演示行、候选与累计，显式启用后才接收', async () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const saved = commands.execute(command(), session)
    const demo = { ...commands.form(saved.id, session), dataOrigin: 'demo' as const }
    const read = createReceiptReadService({ commands, references: () => references, demoRecords: () => [demo], demoReferences: () => references })
    const mixed = read.list({ includeDemo: true }, { ...session, capabilities: [...session.capabilities, 'demo:read'] })
    let response = mixed
    const repository = createReceiptRepository(async () => response)
    for (const query of [{}, { includeDemo: false }, { origin: 'real', includeDemo: true }])
      await expect(repository.list(query)).rejects.toThrow(/响应|数据/)
    await expect(repository.list({ includeDemo: true })).resolves.toEqual(mixed)
    const formal = read.list({}, session)
    response = { ...formal, projectOptions: mixed.projectOptions }
    await expect(repository.list({})).rejects.toThrow(/响应|数据/)
    response = { ...formal, summary: mixed.summary }
    await expect(repository.list({})).rejects.toThrow(/响应|数据/)
    response = formal
    await expect(repository.list({ origin: 'real' })).resolves.toEqual(formal)
  })
  it('未记录分类和类型保持未知，历史草稿能按草稿筛选且不计入不含本次累计', () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const saved = commands.execute(command({ draft: { ...draft, contractId: 'contract-a' } }), session)
    const historical = { ...commands.form(saved.id, session), id: 'historical-draft', dataOrigin: 'demo' as const, draft: { ...draft, contractId: 'contract-a', status: '草稿' } }
    const read = createReceiptReadService({ commands, references: () => references, demoRecords: () => [historical], demoReferences: () => references })
    expect(read.detail(saved.id, { origin: 'real' }, session)).toMatchObject({ category: null, receiptType: null, amounts: { cumulativeReceiptExcludingCurrent: '0.00' } })
    const page = read.list({ origin: 'demo', includeDemo: true, status: 'draft' }, { ...session, capabilities: [...session.capabilities, 'demo:read'] })
    expect(page.items.map(row => row.record.id)).toEqual(['historical-draft'])
    expect(page.summary.origins.demo.effectiveAmount).toBe('0.00')
  })
  it('相同关联 ID 的演示收款只能使用演示目录，不能借正式项目名称与合同金额', () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const first = commands.execute(command({ draft: { ...draft, contractId: 'contract-a' } }), session)
    const demo = { ...commands.form(first.id, session), dataOrigin: 'demo' as const }
    const read = createReceiptReadService({ commands, references: () => references, demoRecords: () => [demo], demoReferences: () => ({ ...references, projects: references.projects.map(row => ({ ...row, name: '演示独立项目' })), contracts: references.contracts.map(row => ({ ...row, amount: '9000.00' })) }) })
    const detail = read.detail(first.id, { origin: 'demo', includeDemo: true }, { ...session, capabilities: [...session.capabilities, 'demo:read'] })
    expect(detail.project).toMatchObject({ state: 'resolved', label: '演示独立项目' })
    expect(detail.amounts.contract).toBe('9000.00')
  })
  it('普通详情不携带迁入附件的本机路径', () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const saved = commands.execute(command(), session)
    const record = commands.form(saved.id, session)
    record.dataOrigin = 'demo'
    record.attachments = [{ id: 'old-file', ownerId: record.id, ownerType: 'receipt_registration', fileName: '旧凭证.pdf', filePath: 'C:/private/old.pdf', fileSize: 8, mimeType: 'application/pdf', category: '', uploader: '', uploadedAt: '', deletedAt: null }]
    const read = createReceiptReadService({ commands, references: () => references, demoRecords: () => [record] })
    const detail = read.detail(record.id, { origin: 'demo', includeDemo: true }, { ...session, capabilities: [...session.capabilities, 'demo:read'] })
    expect(detail.record.attachments[0]?.filePath).toBe('')
    expect(JSON.stringify(detail)).not.toContain('C:/private')
  })

  it('正式与演示同时展示时分别汇总，演示金额不能混进正式累计', () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const first = commands.execute(command({ draft: { ...draft, contractId: 'contract-a' } }), session)
    const demo = { ...commands.form(first.id, session), dataOrigin: 'demo' as const, draft: { ...draft, contractId: 'contract-a', amount: '900.00', status: 'submitted' } }
    const read = createReceiptReadService({ commands, references: () => references, demoRecords: () => [demo] })
    const page = read.list({ includeDemo: true }, { ...session, capabilities: [...session.capabilities, 'demo:read'] })
    expect(page.summary).toEqual({ origins: { real: { count: 1, effectiveAmount: '120.35' }, demo: { count: 1, effectiveAmount: '900.00' } } })
    expect(page.items.find(row => row.record.dataOrigin === 'real')?.amounts.cumulativeReceipt).toBe('120.35')
    expect(page.items.find(row => row.record.dataOrigin === 'demo')?.capabilities).not.toContain('receipt:write')
  })

  it('受限关系在详情、列表和候选中不泄露身份，也不允许把被隐藏关联作为可编辑草稿', () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const read = createReceiptReadService({ commands, references: () => references })
    const saved = commands.execute(command({ draft: { ...draft, contractId: 'contract-a' } }), session)
    const restricted = { ...session, capabilities: ['receipt:read', 'receipt:write'] }
    const detail = read.detail(saved.id, { origin: 'real' }, restricted)
    expect(detail).toMatchObject({ project: { state: 'forbidden', id: null }, customer: { state: 'forbidden', id: null }, contract: { state: 'forbidden', id: null }, record: { draft: { projectId: null, customerId: null, contractId: null } }, amounts: { contract: null, cumulativeReceipt: null } })
    expect(detail.capabilities).not.toContain('receipt:write')
    expect(JSON.stringify(read.list({}, restricted))).not.toMatch(/project-a|customer-a|contract-a/)
    expect(read.context(restricted)).toMatchObject({ projects: [], customers: [], contracts: [] })
  })

  it('独立列表、详情及候选共用收款源，缺客户草稿按自身身份可读，金额未知不变零', () => {
    let nextId = 0
    const commands = createReceiptCommandTestInstance({ references: () => references, createId: () => `id-${++nextId}` })
    const read = createReceiptReadService({ commands, references: () => references })
    const first = commands.execute(command({ draft: { ...draft, contractId: 'contract-a' } }), session)
    const blank = commands.execute(command({ commandId: 'blank', action: 'draft', draft: { ...draft, customerId: null, projectId: null, amount: null } }), session)
    expect(read.detail(blank.id, { origin: 'real' }, session)).toMatchObject({ record: { id: blank.id, draft: { amount: null } }, customer: { state: 'missing' } })
    expect(read.detail(first.id, { origin: 'real' }, session)).toMatchObject({ record: { draft: { amount: '120.35' } }, amounts: { contract: '1000.00', cumulativeReceipt: '120.35', invoicedUnreceived: null } })
    expect(read.list({ projectId: 'project-a' }, session)).toMatchObject({ pagination: { total: 1 }, items: [{ record: { id: first.id } }] })
    expect(read.context(session)).toMatchObject({ workspaceId: session.workspaceId, projects: references.projects })
    expect(() => read.detail(first.id, { origin: 'demo' }, session)).toThrow(/来源|测试/)
    expect(() => read.detail(first.id, { origin: 'bogus' }, session)).toThrow(/来源/)
    expect(() => read.list({}, { ...session, capabilities: [] })).toThrow(/权限/)
  })

  it('repository 校验来源、完整金额和附件归属，不接受服务端串记录响应', async () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const read = createReceiptReadService({ commands, references: () => references })
    const result = commands.execute(command(), session)
    const good = read.detail(result.id, { origin: 'real' }, session)
    let response: unknown = good
    const repository = createReceiptRepository(async () => response)
    expect(await repository.detail(result.id, { origin: 'real' })).toMatchObject({ record: { id: result.id } })
    for (const wrong of [
      { ...good, record: { ...good.record, id: 'other' } },
      { ...good, record: { ...good.record, dataOrigin: 'demo' } },
      { ...good, record: { ...good.record, draft: { ...good.record.draft, amount: 120.35 } } },
      { ...good, record: { ...good.record, attachments: [{ id: 'file', ownerId: 'other' }] } },
    ]) {
      response = wrong
      await expect(repository.detail(result.id, { origin: 'real' })).rejects.toThrow(/响应|数据/)
    }
  })
})
