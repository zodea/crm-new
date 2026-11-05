import type { CustomerCommandRequestDTO } from '../../app/lib/customer/command-contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('客户含原件保存后冷打开读回同一身份、审计和回执，同键异文不能新增', async () => {
  const base = testTempRoot('legacy-test-artifacts/issue-450-tests')
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

it('客户附件九份可保存，新增或恢复超限时字段、原件与回执整笔不变', async () => {
  const base = testTempRoot('customer-attachment-limit')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/customer-`)
  const options = { directory, workspaceId: 'attachment-limit-workspace', ownerId: 'attachment-limit-owner', purpose: 'verification' as const }
  const session = () => ({ workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['customer:list:read', 'customer:write'] })
  const first = createProductionStorage(options)
  const second = createProductionStorage(options)
  const service = createProductionCustomerService(first)
  const originals = Array.from({ length: 9 }, (_, index) => {
    const bytes = Buffer.from(`合成原件${index + 1}`)
    return { fileName: `合成原件${index + 1}.txt`, fileSize: bytes.length, mimeType: 'text/plain', contentBase64: bytes.toString('base64'), bytes }
  })
  const addedBytes = Buffer.from('替换原件')
  const added = { fileName: '替换原件.txt', fileSize: addedBytes.length, mimeType: 'text/plain', contentBase64: addedBytes.toString('base64') }
  const request: CustomerCommandRequestDTO = {
    commandId: 'customer-nine-originals',
    workspaceId: options.workspaceId,
    actorId: options.ownerId,
    requiredCapability: 'customer:write',
    baseVersion: null,
    action: 'save',
    draft: { name: '合成附件边界客户', contact: '合成联系人' },
    attachments: { add: originals.map(file => ({ fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType, contentBase64: file.contentBase64 })) },
  }
  try {
    const saved = await service.execute(request, session)
    expect(saved.version).toBe('1')
    expect(saved.attachmentIds).toHaveLength(9)
    const initial = await service.form(saved.id, session)
    expect(initial).toMatchObject({ draft: { id: saved.id, name: '合成附件边界客户', contact: '合成联系人' }, version: '1' })
    expect(initial.attachments).toHaveLength(9)
    const ids = new Map(initial.attachments.map(file => [file.fileName, file.id]))
    expect(ids.size).toBe(9)
    async function assertOriginals(reader: ReturnType<typeof createProductionCustomerService>, skipName?: string) {
      for (const original of originals) {
        if (original.fileName === skipName)
          continue
        const id = ids.get(original.fileName)
        expect(id).toBeTruthy()
        expect(Buffer.from((await reader.file(saved.id, id!, session)).bytes)).toEqual(original.bytes)
      }
    }
    await assertOriginals(service)
    const firstAudit = await service.audit(saved.id, session)
    expect(firstAudit).toMatchObject([{ action: 'create', commandId: request.commandId }])
    const firstReceipt = await service.command(request.commandId, session)
    expect(firstReceipt).toMatchObject({ outcome: 'applied', result: saved })
    const overflow = {
      ...request,
      id: saved.id,
      commandId: 'customer-tenth-original',
      baseVersion: saved.version,
      draft: { ...request.draft, name: '超限时不得保存的名称' },
      attachments: { add: [added] },
    }
    await expect(service.execute(overflow, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: '客户附件最多 9 份。' } })
    expect(await service.form(saved.id, session)).toEqual(initial)
    expect(await service.audit(saved.id, session)).toEqual(firstAudit)
    expect(await service.command(request.commandId, session)).toEqual(firstReceipt)
    expect(await service.command(overflow.commandId, session)).toMatchObject({ outcome: 'not-applied', result: null })
    await assertOriginals(service)

    const removed = ids.get(originals[0]!.fileName)!
    const swapped = await service.execute({
      ...request,
      id: saved.id,
      commandId: 'customer-replace-original',
      baseVersion: saved.version,
      attachments: { removeIds: [removed], add: [added] },
    }, session)
    expect(swapped.version).toBe('2')
    expect(swapped.attachmentIds).toHaveLength(9)
    expect(swapped.attachmentIds).not.toContain(removed)
    const afterSwap = await service.form(saved.id, session)
    expect(afterSwap).toMatchObject({ version: '2', draft: { id: saved.id, name: '合成附件边界客户', contact: '合成联系人' } })
    expect(afterSwap.attachments).toHaveLength(10)
    expect(afterSwap.attachments.filter(file => !file.deletedAt)).toHaveLength(9)
    expect(afterSwap.attachments.find(file => file.id === removed)?.deletedAt).toBeTruthy()
    const addedId = afterSwap.attachments.find(file => file.fileName === added.fileName)?.id
    expect(addedId).toBeTruthy()
    expect(Buffer.from((await service.file(saved.id, addedId!, session)).bytes)).toEqual(addedBytes)
    await expect(service.file(saved.id, removed, session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await assertOriginals(service, originals[0]!.fileName)
    const swapAudit = await service.audit(saved.id, session)
    expect(swapAudit.map(row => row.commandId).sort()).toEqual([request.commandId, swapped.commandId].sort())
    const swapReceipt = await service.command(swapped.commandId, session)
    expect(swapReceipt).toMatchObject({ outcome: 'applied', result: swapped })
    const overRestore = {
      ...request,
      id: saved.id,
      commandId: 'customer-over-limit-restore',
      baseVersion: swapped.version,
      draft: { ...request.draft, name: '恢复超限不得保存的名称' },
      attachments: { restoreIds: [removed] },
    }
    await expect(service.execute(overRestore, session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: '客户附件最多 9 份。' } })
    expect(await service.form(saved.id, session)).toEqual(afterSwap)
    expect(await service.audit(saved.id, session)).toEqual(swapAudit)
    expect(await service.command(request.commandId, session)).toEqual(firstReceipt)
    expect(await service.command(swapped.commandId, session)).toEqual(swapReceipt)
    expect(await service.command(overRestore.commandId, session)).toMatchObject({ outcome: 'not-applied', result: null })
    await expect(service.file(saved.id, removed, session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await assertOriginals(service, originals[0]!.fileName)
    expect(Buffer.from((await service.file(saved.id, addedId!, session)).bytes)).toEqual(addedBytes)

    await first.close()
    const reopened = createProductionCustomerService(second)
    expect(await reopened.form(saved.id, session)).toEqual(afterSwap)
    expect(await reopened.audit(saved.id, session)).toEqual(swapAudit)
    expect(await reopened.command(request.commandId, session)).toEqual(firstReceipt)
    expect(await reopened.command(swapped.commandId, session)).toEqual(swapReceipt)
    expect(await reopened.command(overflow.commandId, session)).toMatchObject({ outcome: 'not-applied', result: null })
    expect(await reopened.command(overRestore.commandId, session)).toMatchObject({ outcome: 'not-applied', result: null })
    await expect(reopened.file(saved.id, removed, session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await assertOriginals(reopened, originals[0]!.fileName)
    expect(Buffer.from((await reopened.file(saved.id, addedId!, session)).bytes)).toEqual(addedBytes)
  }
  finally {
    await first.close()
    await second.close()
  }
})
