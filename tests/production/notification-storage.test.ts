import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionNotificationService } from '../../server/utils/production-notification-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'

const actor = { workspaceId: 'notification-workspace', actorId: 'notification-owner', capabilities: ['supplier:list:read', 'supplier:write', 'supplier-credential:read', 'supplier-credential:write'] }
const session = () => actor
const bytes = Buffer.from('%PDF-1.7\nSynthetic expiry original\n%%EOF')
async function setup() {
  const base = resolve('.tmp/a01-notification-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/storage-`)
  const options = { directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  let timestamp = '2026-10-03T00:00:00.000Z'
  const now = () => timestamp
  const suppliers = createProductionSupplierService(storage, { now })
  const notifications = createProductionNotificationService(storage, { now })
  const supplier = await suppliers.execute({ commandId: 'create-warning-supplier', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', action: 'save', baseVersion: null, attachments: {}, draft: { name: '合成临期分供方', contact: '合成人', supplierCategory: '其他' } }, session)
  const original = await suppliers.executeCredential({ commandId: 'warning-original', supplierId: supplier.id, origin: 'real', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier-credential:write', baseSupplierVersion: '1', baseCredentialVersion: '0', action: 'upload', draft: { category: '营业执照', expiresAt: '2026-10-11', validFrom: '', longTerm: false, fileName: '合成原件.pdf', mimeType: 'application/pdf', fileSize: bytes.length, payloadBase64: bytes.toString('base64') } }, session)
  return { storage, options, suppliers, notifications, supplier, original, now, setClock: (value: string) => {
    timestamp = value
  } }
}

it('主动评估7天界线，重复投递、已读、跨日过期与续期分离，冷开保留同事件/原回执和字节', async () => {
  const state = await setup()
  try {
    await state.notifications.scheduled()
    expect((await state.notifications.list({}, session)).items).toEqual([])
    state.setClock('2026-10-04T00:00:00.000Z')
    await state.notifications.scheduled()
    const page = await state.notifications.list({}, session)
    expect(page).toMatchObject({ unreadCount: 1, evaluationState: 'ready', businessDate: '2026-10-04' })
    expect(page.items[0]).toMatchObject({ problem: { severity: 'expiring', state: 'active', firstSeenAt: '2026-10-04T00:00:00.000Z', resolvedAt: null }, target: { state: 'resolved', intent: { variant: 'credentials' } } })
    expect((await state.notifications.list({ page: 99 }, session)).pagination).toEqual({ requestedPage: 99, page: 1, pageSize: 100, total: 1 })
    for (const invalid of [{ page: true }, { page: ' 1 ' }, { pageSize: 13 }, { pageSize: Infinity }, { unexpected: 'identity' }])
      await expect(state.notifications.list(invalid, session)).rejects.toMatchObject({ problem: { code: 'invalid-query' } })
    const eventId = page.items[0]!.eventId
    const command = { commandId: 'open-warning', workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'open', eventId }
    const receipt = await state.notifications.execute(command, session)
    expect(await state.notifications.execute(command, session)).toEqual(receipt)
    await state.notifications.scheduled()
    expect((await state.notifications.list({}, session))).toMatchObject({ unreadCount: 0, items: [{ eventId, problem: { state: 'active' } }] })
    state.setClock('2026-10-11T16:00:00.000Z')
    const before = await state.storage.select('SELECT * FROM supplier_credential_scopes')
    const read = await state.notifications.list({}, session)
    expect(read.items[0]).toMatchObject({ eventId, readAt: receipt.readAt, problem: { state: 'active', severity: 'expired' } })
    expect(await state.storage.select('SELECT * FROM supplier_credential_scopes')).toEqual(before)
    await state.notifications.scheduled()
    expect((await state.notifications.list({}, session)).items).toHaveLength(1)
    const scope = await state.suppliers.credentials(state.supplier.id, session)
    await state.suppliers.executeCredential({ commandId: 'renew-warning-original', supplierId: state.supplier.id, origin: 'real', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier-credential:write', baseSupplierVersion: scope.supplierVersion, baseCredentialVersion: scope.credentialVersion, action: 'edit', credentialId: state.original.credentialId!, draft: { category: '营业执照', expiresAt: '2027-10-11', validFrom: '', longTerm: false } }, session)
    expect((await state.notifications.list({}, session)).items[0]).toMatchObject({ problem: { state: 'resolved', resolvedAt: null } })
    await state.notifications.scheduled()
    const resolved = await state.notifications.list({}, session)
    expect(resolved.items[0]).toMatchObject({ eventId, readAt: receipt.readAt, problem: { state: 'resolved', resolvedAt: '2026-10-11T16:00:00.000Z' } })
    const backup = join(state.options.directory, 'notification-backup.sqlite')
    await state.storage.backupTo(backup)
    const inventory = await inspectProductionBackup(backup)
    expect(inventory.participants.notifications).toMatchObject({ schemaVersion: 1 })
    expect(inventory.tables.notification_events?.rows).toBe(1)
    expect(inventory.tables.notification_reads?.rows).toBe(1)
    await state.storage.close()
    const reopened = createProductionStorage(state.options)
    try {
      const notifications = createProductionNotificationService(reopened, { now: state.now })
      expect(await notifications.execute(command, session)).toEqual(receipt)
      expect((await notifications.list({}, session)).items).toEqual(resolved.items)
      const supplier = createProductionSupplierService(reopened, { now: state.now })
      const credential = (await supplier.credentials(state.supplier.id, session)).credentials[0]!
      expect(await supplier.file({ supplierId: state.supplier.id, credentialId: credential.id, fileId: credential.file!.id, origin: 'real' }, session)).toMatchObject({ payloadBase64: bytes.toString('base64') })
    }
    finally { await reopened.close() }
  }
  finally { await state.storage.close() }
})

it('消息已读与原资料事务回滚、权限变化及原键内容冲突仍受保护', async () => {
  const state = await setup()
  try {
    state.setClock('2026-10-04T00:00:00.000Z')
    await state.notifications.scheduled()
    const eventId = (await state.notifications.list({}, session)).items[0]!.eventId
    const command = { commandId: 'open-guarded-warning', workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'open', eventId }
    await state.storage.execute('CREATE TRIGGER notification_fail BEFORE INSERT ON notification_commands BEGIN SELECT RAISE(ABORT,\'synthetic-failure\'); END')
    await expect(state.notifications.execute(command, session)).rejects.toThrow('synthetic-failure')
    expect(await state.storage.select('SELECT * FROM notification_reads')).toEqual([])
    await state.storage.execute('DROP TRIGGER notification_fail')
    await state.notifications.execute(command, session)
    await expect(state.notifications.execute({ ...command, action: 'mark-all-read', eventId: null }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const limited = () => ({ ...actor, capabilities: [] })
    expect((await state.notifications.list({}, limited)).items).toEqual([])
    expect((await state.notifications.execute(command, limited)).target).toEqual({ state: 'forbidden' })
    await expect(state.notifications.execute({ ...command, commandId: 'unread-without-permission' }, limited)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(state.notifications.list({}, () => ({ ...actor, actorId: 'other-owner' }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { await state.storage.close() }
})

it.each(['wrong-owner', 'wrong-fingerprint', 'missing-read', 'duplicate-adoption', 'missing-problem'] as const)('真实备份和冷开拒绝损坏通知证据，原件不受影响：%s', async (corruption) => {
  const state = await setup()
  const commandId = 'open-before-corruption'
  try {
    state.setClock('2026-10-04T00:00:00.000Z')
    await state.notifications.scheduled()
    const eventId = (await state.notifications.list({}, session)).items[0]!.eventId
    const command = { commandId, workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'open', eventId }
    await state.notifications.execute(command, session)
    if (corruption === 'wrong-owner')
      await state.storage.execute('UPDATE notification_commands SET actor_id=? WHERE command_id=?', ['another-owner', commandId])
    if (corruption === 'wrong-fingerprint')
      await state.storage.execute('UPDATE notification_commands SET fingerprint=? WHERE command_id=?', ['b'.repeat(64), commandId])
    if (corruption === 'missing-read')
      await state.storage.execute('DELETE FROM notification_reads WHERE event_id=?', [eventId])
    if (corruption === 'duplicate-adoption') {
      const row = (await state.storage.select<{ result_json: string }>('SELECT result_json FROM notification_commands WHERE command_id=?', [commandId]))[0]!
      const result = JSON.parse(row.result_json)
      result.eventIds = [eventId, eventId]
      await state.storage.execute('UPDATE notification_commands SET result_json=? WHERE command_id=?', [JSON.stringify(result), commandId])
    }
    if (corruption === 'missing-problem') {
      const row = (await state.storage.select<{ metadata_json: string }>('SELECT metadata_json FROM supplier_credential_scopes WHERE supplier_id=?', [state.supplier.id]))[0]!
      const scope = JSON.parse(row.metadata_json)
      scope.expiryProblems = []
      await state.storage.execute('UPDATE supplier_credential_scopes SET metadata_json=? WHERE supplier_id=?', [JSON.stringify(scope), state.supplier.id])
    }
    const backup = join(state.options.directory, `${corruption}.sqlite`)
    await state.storage.backupTo(backup)
    await expect(inspectProductionBackup(backup)).rejects.toThrow(/通知|消息/)
    await state.storage.close()
    const reopened = createProductionStorage(state.options)
    try {
      const notifications = createProductionNotificationService(reopened, { now: state.now })
      await expect(notifications.execute(command, session)).rejects.toMatchObject({ problem: { code: corruption === 'wrong-fingerprint' ? 'conflict' : 'unavailable' } })
      const supplier = createProductionSupplierService(reopened, { now: state.now })
      const credential = (await supplier.credentials(state.supplier.id, session)).credentials[0]!
      expect(await supplier.file({ supplierId: state.supplier.id, credentialId: credential.id, fileId: credential.file!.id, origin: 'real' }, session)).toMatchObject({ payloadBase64: bytes.toString('base64') })
    }
    finally { await reopened.close() }
  }
  finally { await state.storage.close() }
})
