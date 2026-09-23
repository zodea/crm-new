import type { ProjectCommandRequestDTO } from '../../app/lib/project/command-contract'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function fixture() {
  const base = resolve('.codex-tmp/issue-452-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/project-`)
  const options = { directory, workspaceId: 'project-workspace', ownerId: 'project-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['project:list:read', 'project:write', 'customer:list:read', 'customer:write'] }
  const session = () => structuredClone(actor)
  const customer = await createProductionCustomerService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'customer:write', commandId: 'customer-create', baseVersion: null, action: 'save', draft: { name: '正式客户', contact: '负责人' }, attachments: {} }, session)
  const command: ProjectCommandRequestDTO = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'project:write', commandId: 'project-create', baseVersion: null, action: 'save', draft: { name: '磁盘项目', code: '旧001', manager: '项目经理', customerId: customer.id, area: 0, contractAmount: 100.12, plannedEnd: '2026-12-31' }, attachments: { add: [{ fileName: '原说明.txt', fileSize: 3, mimeType: 'text/plain', contentBase64: 'YWJj' }] } }
  return { storage, options, actor, session, customer, command, service: createProductionProjectService(storage) }
}

it('项目与原件同库冷回读，客户改名沿原 ID、未知指标不归零、删除恢复保留原件', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute(f.command, f.session)
    await f.storage.close()
    const form = await f.service.form(saved.id, f.session)
    expect(form).toMatchObject({ draft: { id: saved.id, code: '旧001', customerId: f.customer.id, area: 0 }, version: '1' })
    expect(await f.service.execute(f.command, f.session)).toEqual(saved)
    const initialSource = (await f.service.detail(saved.id, {}, f.session)).sourceVersion
    await createProductionCustomerService(f.storage).execute({ id: f.customer.id, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'customer:write', commandId: 'customer-rename', baseVersion: '1', action: 'save', draft: { name: '改名客户', contact: '负责人' }, attachments: {} }, f.session)
    const read = await f.service.detail(saved.id, {}, f.session)
    expect(read.item.customer).toMatchObject({ id: f.customer.id, label: '改名客户' })
    expect(read.sourceVersion).not.toBe(initialSource)
    expect(read.item.income.value).toBeNull()
    expect(read.item.budget.value).toBeNull()
    expect(read.materialContracts.count.value).toBeNull()
    expect(read.projectSuppliers.access).toBe('error')
    const original = await f.service.file(saved.id, saved.attachmentIds[0]!, f.session)
    expect([...original.bytes]).toEqual([97, 98, 99])
    const lifecycle = { id: saved.id, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'project:write' as const, commandId: 'project-delete', baseVersion: '1', action: 'delete' as const }
    const relatedBefore = await createProductionCustomerService(f.storage).detail(f.customer.id, { origin: 'real' }, f.session)
    expect(relatedBefore.projects).toHaveLength(1)
    await f.service.executeLifecycle(lifecycle, f.session)
    expect((await f.service.list({}, f.session)).pagination.total).toBe(0)
    // Deleted detail remains a read-only recovery destination, never an editable form.
    expect((await f.service.detail(saved.id, {}, f.session)).item.project.id).toBe(saved.id)
    expect((await f.service.lifecycle(saved.id, f.session)).deletedAt).not.toBeNull()
    const relatedAfter = await createProductionCustomerService(f.storage).detail(f.customer.id, { origin: 'real' }, f.session)
    expect(relatedAfter.projects).toHaveLength(0)
    expect(relatedAfter.sourceVersion).not.toBe(relatedBefore.sourceVersion)
    await expect(f.service.form(saved.id, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.file(saved.id, saved.attachmentIds[0]!, f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    expect(await f.service.deleted(f.session)).toMatchObject([{ id: saved.id, version: '2' }])
    await f.service.executeLifecycle({ ...lifecycle, commandId: 'project-restore', action: 'restore', baseVersion: '2' }, f.session)
    expect((await f.service.file(saved.id, saved.attachmentIds[0]!, f.session)).sha256).toBe(original.sha256)
    expect((await f.service.audit(saved.id, f.session)).map(row => row.action)).toEqual(['create', 'delete', 'restore'])
  }
  finally { await f.storage.close() }
})

it('excel 来源及旧 ID 防重跨冷开和并发保留；异文、交叉来源身份均拒绝', async () => {
  const f = await fixture()
  try {
    const source = { fileName: '合成.xlsx', fileDigest: 'a'.repeat(64), sheetName: '项目清单', rowNumber: 2, externalRef: '0007', rawSnapshot: { oldId: '0007' } }
    const command = { ...f.command, commandId: `project-excel:${JSON.stringify([source.fileDigest, source.sheetName, 2])}`, attachments: {}, importSource: source }
    const [first, second] = await Promise.all([f.service.execute(command, f.session), f.service.execute(command, f.session)])
    expect(second).toEqual(first)
    await f.storage.close()
    expect(await f.service.execute(command, f.session)).toEqual(first)
    const alias = await f.service.execute({ ...command, commandId: 'different-file-same-old-id', importSource: { ...source, fileDigest: 'b'.repeat(64) } }, f.session)
    expect(alias.id).toBe(first.id)
    expect((await f.service.form(first.id, f.session)).importSource).toEqual(source)
    expect((await f.service.list({}, f.session)).pagination.total).toBe(1)
    await expect(f.service.execute({ ...command, draft: { ...command.draft, name: '擅改旧行' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute({ ...command, commandId: 'external-id-change', draft: { ...command.draft, name: '异文' }, importSource: { ...source, fileDigest: 'c'.repeat(64) } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute({ ...command, commandId: 'cross-source', origin: 'demo' }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  }
  finally { await f.storage.close() }
})

it('审计失败及提交前撤权完整回滚；迟到请求封存、陈旧版本和异主附件拒绝', async () => {
  const f = await fixture()
  try {
    await f.storage.withTransaction(tx => tx.execute('CREATE TRIGGER fail_project_audit BEFORE INSERT ON project_audits BEGIN SELECT RAISE(ABORT,\'before-project-commit\'); END'))
    await expect(f.service.execute(f.command, f.session)).rejects.toThrow('before-project-commit')
    expect(await f.storage.select('SELECT id FROM projects')).toEqual([])
    expect(await f.storage.select('SELECT id FROM file_refs')).toEqual([])
    await f.storage.withTransaction(tx => tx.execute('DROP TRIGGER fail_project_audit'))
    let checks = 0
    await expect(f.service.execute(f.command, () => ({ ...f.actor, capabilities: ++checks === 1 ? f.actor.capabilities : ['project:list:read'] }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM projects')).toEqual([])
    const saved = await f.service.execute(f.command, f.session)
    const pending = { ...f.command, commandId: 'late-project-create' }
    expect(await f.service.resolveCommand(pending.commandId, f.session)).toMatchObject({ outcome: 'not-applied' })
    await f.storage.close()
    await expect(f.service.execute(pending, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.service.resolveCommand(f.command.commandId, f.session)).toMatchObject({ outcome: 'applied', result: saved })
    await expect(f.service.execute({ ...f.command, commandId: 'stale-project', id: saved.id, baseVersion: '0', attachments: {} }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const other = await f.service.execute({ ...f.command, commandId: 'other-project', attachments: {} }, f.session)
    await expect(f.service.execute({ ...f.command, commandId: 'cross-project-file', id: other.id, baseVersion: '1', attachments: { removeIds: saved.attachmentIds } }, f.session)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(f.service.execute({ ...f.command, commandId: 'missing-customer', draft: { ...f.command.draft, customerId: 'not-real' } }, f.session)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  }
  finally { await f.storage.close() }
})
