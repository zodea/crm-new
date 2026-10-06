import { describe, expect, it } from 'vitest'
import { createAuxiliaryContractRepository } from '~/lib/auxiliary-contract/repository'
import { createHttpProjectSupplierReadRepository } from '~/lib/project-supplier/http-repository'
import { parseProjectSupplierWorkbenchQuery } from '~/lib/project-supplier/repository'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '~/lib/read-model/meta'
import { createReceiptRepository } from '~/lib/receipt/repository'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'
import { createProjectSupplierReadTestInstance } from '../../server/utils/project-supplier-read-test-instance'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { createReceiptReadService } from '../../server/utils/receipt-read-service'
import { command, references, session } from '../receipt/fixtures'

describe('辅助合同、收款及双父工作台严格读取协议', () => {
  it('辅助owner实际版本跨页稳定、写入变更使版本变化，无demo owner明确未知', async () => {
    const actor = { workspaceId: 'workspace-aux', actorId: 'actor-aux', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
    const owner = createAuxiliaryContractTestInstance({ createId: () => 'aux-original' })
    await owner.execute({ ...actor, requiredCapability: 'auxiliary-contract:write', commandId: 'create', baseVersion: null, action: 'draft', draft: { kind: 'company_expense', name: '原合同' }, attachments: {} }, actor)
    const page = owner.list({ kind: 'company_expense', page: 99, pageSize: 10 }, actor)
    const first = owner.list({ kind: 'company_expense', page: 1, pageSize: 20 }, actor)
    expect(hasConsistentOriginReadMeta(page, 'auxiliary-contract-read-v2')).toBe(true)
    expect(page.meta.workspaceId).toBe(actor.workspaceId)
    expect(page.meta.actorId).toBe(actor.actorId)
    expect(page.meta.sourceVersion).toBe(first.meta.sourceVersion)
    expect(page.meta.authorizedScope).toEqual(first.meta.authorizedScope)
    expect(page.pagination).toMatchObject({ requestedPage: 99, page: 1 })
    expect(page.originMeta.demo.sources).toEqual([{ key: 'auxiliary-contracts', state: 'not-requested', sourceVersion: null, asOf: null }])
    expect(() => owner.list({ kind: 'company_expense', origin: 'demo' }, actor)).toThrow('来源尚未连接')
    let wire: unknown = page
    const repository = createAuxiliaryContractRepository(async () => wire)
    await expect(repository.list({ kind: 'company_expense', page: 99, pageSize: 10 })).resolves.toEqual(page)
    for (const invalid of [{ ...page, meta: undefined }, { ...page, pagination: { ...page.pagination, requestedPage: 98 } }, { ...page, pagination: { ...page.pagination, pageSize: 20 } }]) {
      wire = invalid
      await expect(repository.list({ kind: 'company_expense', page: 99, pageSize: 10 })).rejects.toBeDefined()
    }
    const detail = owner.detail('aux-original', { kind: 'company_expense' }, actor)
    expect(hasConsistentReadMeta(detail, 'auxiliary-contract-read-v2', 'real')).toBe(true)
    await owner.execute({ ...actor, id: 'aux-original', requiredCapability: 'auxiliary-contract:write', commandId: 'update', baseVersion: '1', action: 'draft', draft: { ...detail.contract.draft, name: '新合同' }, attachments: {} }, actor)
    expect(owner.list({ kind: 'company_expense' }, actor).sourceVersion).not.toBe(first.sourceVersion)
  })

  it('收款响应同源同身份、拒绝错请求页与跨actor行，受限来源无ID或虚假版本', async () => {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const saved = commands.execute(command(), session)
    const owner = createReceiptReadService({ commands, references: () => references })
    const page = owner.list({ page: 20, pageSize: 10 }, session)
    expect(hasConsistentOriginReadMeta(page, 'receipt-read-v2')).toBe(true)
    expect(page.items[0]?.meta.actorId).toBe(session.actorId)
    let wire: unknown = page
    const repository = createReceiptRepository(async () => wire)
    await expect(repository.list({ page: 20, pageSize: 10 })).resolves.toEqual(page)
    for (const invalid of [{ ...page, meta: undefined }, { ...page, pagination: { ...page.pagination, requestedPage: 19 } }, { ...page, pagination: { ...page.pagination, pageSize: 20 } }, { ...page, items: page.items.map(row => ({ ...row, meta: { ...row.meta, actorId: 'other-actor' } })) }]) {
      wire = invalid
      await expect(repository.list({ page: 20, pageSize: 10 })).rejects.toBeDefined()
    }
    const limited = owner.detail(saved.id, { origin: 'real' }, { ...session, capabilities: ['receipt:read'] })
    expect(limited.meta.sources.filter(source => source.key !== 'receipts')).toEqual(expect.arrayContaining([
      { key: 'receipt-projects-references', state: 'forbidden', sourceVersion: null, asOf: null },
      { key: 'receipt-customers-references', state: 'forbidden', sourceVersion: null, asOf: null },
    ]))
    expect(JSON.stringify(limited)).not.toMatch(/project-a|customer-a/)
    wire = owner.detail(saved.id, { origin: 'real' }, session)
    await expect(repository.detail(saved.id, { origin: 'real' })).resolves.toBeDefined()
    await expect(repository.detail('different-id', { origin: 'real' })).rejects.toBeDefined()
    await expect(repository.detail(saved.id, { origin: 'demo', includeDemo: true })).rejects.toBeDefined()
  })

  it('工作台证据来自真实owner时点，HTTP双父/来源必须匹配本次请求', async () => {
    const owner = createProjectSupplierReadTestInstance(() => ['project-supplier:read', 'demo:read'])
    const started = Date.now()
    const detail = await owner.detail('proj_demo_002', 'sup_demo_004', { origin: 'demo', includeDemo: true })
    expect(Date.parse(detail.asOf)).toBeGreaterThanOrEqual(started)
    expect(hasConsistentReadMeta(detail, 'project-supplier-read-v2', 'demo')).toBe(true)
    let wire: unknown = detail
    const repository = createHttpProjectSupplierReadRepository({ fetcher: async () => wire })
    const query = parseProjectSupplierWorkbenchQuery('proj_demo_002', 'sup_demo_004', { origin: 'demo', includeDemo: true })
    await expect(repository.get(query)).resolves.toEqual(detail)
    await expect(repository.get({ ...query, projectId: 'other' })).rejects.toBeDefined()
    await expect(repository.get({ ...query, supplierId: 'other' })).rejects.toBeDefined()
    await expect(repository.get({ ...query, origin: 'real' })).rejects.toBeDefined()
    wire = { ...detail, meta: undefined }
    await expect(repository.get(query)).rejects.toBeDefined()
  })
})
