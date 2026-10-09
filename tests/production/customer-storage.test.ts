import type { CustomerCommandRequestDTO } from '../../app/lib/customer/command-contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'

it('客户含原件保存后冷打开读回同一身份、审计和回执，同键异文不能新增', async () => {
  const base = resolve('.tmp/legacy-test-artifacts/issue-450-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/customer-`)
  const options = { directory, workspaceId: 'isolated-workspace', ownerId: 'isolated-owner', purpose: 'verification' as const }
  const session = () => ({ workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['customer:list:read', 'customer:write'] })
  const request: CustomerCommandRequestDTO = { commandId: 'create-customer', workspaceId: options.workspaceId, actorId: options.ownerId, requiredCapability: 'customer:write', baseVersion: null, action: 'save', draft: { name: '隔离验证客户', contact: '验证联系人', aliases: ['验证甲方'], taxNo: 'test-unique' }, attachments: { add: [{ fileName: '核对说明.txt', mimeType: 'text/plain', fileSize: 7, contentBase64: Buffer.from('原件A').toString('base64') }] } }
  const first = createProductionStorage(options)
  const service = createProductionCustomerService(first)
  const result = await service.execute(request, session)
  await first.close()
  const second = createProductionStorage(options)
  const recovered = createProductionCustomerService(second)
  try {
    const form = await recovered.form(result.id, session)
    expect(form).toMatchObject({ draft: { id: result.id, name: '隔离验证客户', aliases: ['验证甲方'] }, version: '1' })
    expect(await recovered.execute(request, session)).toEqual(result)
    const original = await recovered.file(result.id, result.attachmentIds[0]!, session)
    expect(Buffer.from(original.bytes).toString()).toBe('原件A')
    expect(await recovered.audit(result.id, session)).toMatchObject([{ actorId: 'isolated-owner', action: 'create', commandId: 'create-customer' }])
    await expect(recovered.execute({ ...request, draft: { name: '不可串用原键', contact: '另一位' } }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await recovered.list({}, session)).pagination.total).toBe(1)
    const lifecycle = { id: result.id, commandId: 'delete-customer', workspaceId: options.workspaceId, actorId: options.ownerId, requiredCapability: 'customer:write' as const, baseVersion: '1', action: 'delete' as const }
    const deleted = await recovered.executeLifecycle(lifecycle, session)
    expect(deleted.version).toBe('2')
    expect((await recovered.list({}, session)).pagination.total).toBe(0)
    await expect(recovered.file(result.id, result.attachmentIds[0]!, session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    expect(await recovered.deleted(session)).toMatchObject([{ id: result.id, version: '2' }])
    const restored = await recovered.executeLifecycle({ ...lifecycle, commandId: 'restore-customer', baseVersion: '2', action: 'restore' }, session)
    expect(restored.version).toBe('3')
    expect((await recovered.file(result.id, result.attachmentIds[0]!, session)).sha256).toBe(original.sha256)
    expect(await recovered.command('create-customer', session)).toMatchObject({ outcome: 'applied', result })
    expect(await recovered.command('never-applied', session)).toMatchObject({ outcome: 'not-applied', result: null })
  }
  finally { await second.close() }
})
