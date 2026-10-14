import type { CustomerCommandRequestDTO } from '../../app/lib/customer/command-contract'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function fixture() {
  const base = resolve('.tmp/legacy-test-artifacts/issue-450-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/failure-`)
  const storage = createProductionStorage({ directory, workspaceId: 'isolated-workspace', ownerId: 'isolated-owner', purpose: 'verification' })
  const service = createProductionCustomerService(storage)
  const actor = { workspaceId: 'isolated-workspace', actorId: 'isolated-owner', capabilities: ['customer:list:read', 'customer:write'] }
  const command: CustomerCommandRequestDTO = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'failure-create', requiredCapability: 'customer:write', baseVersion: null, action: 'save', draft: { name: '失败验证', contact: '验证人' }, attachments: { add: [{ fileName: '原件.txt', fileSize: 3, contentBase64: 'YWJj' }] } }
  return { storage, service, actor, command, session: () => structuredClone(actor) }
}

it('审计提交中断不暴露客户或原件；同键重试仅保存一次，陈旧更正保持原值', async () => {
  const f = await fixture()
  try {
    await f.storage.withTransaction(tx => tx.execute('CREATE TRIGGER fail_audit BEFORE INSERT ON customer_audits BEGIN SELECT RAISE(ABORT,\'simulated-before-commit\'); END'))
    await expect(f.service.execute(f.command, f.session)).rejects.toThrow('simulated-before-commit')
    expect((await f.service.list({}, f.session)).pagination.total).toBe(0)
    expect(await f.service.command(f.command.commandId, f.session)).toMatchObject({ outcome: 'not-applied' })
    await f.storage.withTransaction(tx => tx.execute('DROP TRIGGER fail_audit'))
    const saved = await f.service.execute(f.command, f.session)
    expect((await f.service.form(saved.id, f.session)).attachments).toHaveLength(1)
    const update = { ...f.command, commandId: 'update-once', id: saved.id, baseVersion: '1', draft: { name: '更正后的名称', contact: '验证人' }, attachments: {} }
    await f.service.execute(update, f.session)
    await expect(f.service.execute({ ...update, commandId: 'stale-update', draft: { name: '陈旧覆盖', contact: '验证人' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await f.service.form(saved.id, f.session)).draft.name).toBe('更正后的名称')
    expect((await f.service.audit(saved.id, f.session)).map(row => row.action)).toEqual(['create', 'update'])
  }
  finally { await f.storage.close() }
})

it('写中撤权回滚，伪造身份、跨来源与跨客户原件拒绝', async () => {
  const f = await fixture()
  try {
    let checks = 0
    const revoked = () => ({ ...f.actor, capabilities: ++checks === 1 ? f.actor.capabilities : ['customer:list:read'] })
    await expect(f.service.execute(f.command, revoked)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect((await f.service.list({}, f.session)).pagination.total).toBe(0)
    await expect(f.service.execute({ ...f.command, actorId: 'spoofed-owner' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const saved = await f.service.execute(f.command, f.session)
    await expect(f.service.detail(saved.id, { origin: 'demo' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(f.service.list({ includeDemo: 'true' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const second = await f.service.execute({ ...f.command, commandId: 'another-customer', attachments: {} }, f.session)
    await expect(f.service.file(second.id, saved.attachmentIds[0]!, f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(f.service.execute({ ...f.command, id: second.id, baseVersion: '1', commandId: 'cross-file', attachments: { removeIds: [saved.attachmentIds[0]!] } }, f.session)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    expect((await f.service.file(saved.id, saved.attachmentIds[0]!, f.session)).bytes).toEqual(new Uint8Array([97, 98, 99]))
  }
  finally { await f.storage.close() }
})

it('核对未保存会封存原键；迟到请求和冷重启都不能重新写入，已提交回执原样回读', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute(f.command, f.session)
    expect(await f.service.resolveCommand(f.command.commandId, f.session)).toMatchObject({ outcome: 'applied', result: saved })
    const late = { ...f.command, commandId: 'late-after-resolve' }
    expect(await f.service.resolveCommand(late.commandId, f.session)).toMatchObject({ outcome: 'not-applied' })
    await f.storage.close()
    await expect(f.service.execute(late, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await f.service.list({}, f.session)).pagination.total).toBe(1)
    expect(await f.service.resolveCommand(late.commandId, f.session)).toMatchObject({ outcome: 'not-applied' })
  }
  finally { await f.storage.close() }
})
