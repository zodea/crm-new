import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { supplierProductionProcess } from '../helpers/production-supplier-process'

it('证照删除与撤回跨独立进程重启，旧删除凭证不能恢复新删除', async () => {
  const f = await supplierProductionProcess()
  const identity = { workspaceId: 'supplier-workspace', actorId: 'supplier-owner' }
  const bytes = Buffer.from('%PDF-1.7\nSynthetic credential lifecycle\n%%EOF')
  try {
    await f.start()
    await f.login()
    const createdResponse = await f.request('/api/commands/suppliers', {
      ...identity,
      requiredCapability: 'supplier:write',
      commandId: 'credential-restart-create',
      baseVersion: null,
      action: 'save',
      draft: { name: '合成证照分供方', contact: '合成联系人', supplierCategory: '其他' },
      attachments: {},
    })
    expect(createdResponse.status).toBe(200)
    const created = await createdResponse.json()
    const base = { ...identity, requiredCapability: 'supplier-credential:write', origin: 'real', supplierId: created.id }
    const read = async () => {
      const response = await f.request(`/api/read/supplier-credentials/${created.id}?origin=real`)
      expect(response.status).toBe(200)
      return response.json()
    }
    const versions = (state: { supplierVersion: string, credentialVersion: string }) => ({ baseSupplierVersion: state.supplierVersion, baseCredentialVersion: state.credentialVersion })
    const execute = (command: unknown) => f.request('/api/commands/supplier-credentials', command)
    const upload = await execute({ ...base, ...versions(await read()), commandId: 'credential-restart-upload', action: 'upload', draft: { fileName: '合成证照.pdf', mimeType: 'application/pdf', fileSize: bytes.length, payloadBase64: bytes.toString('base64'), category: '营业执照', validFrom: '', expiresAt: '', longTerm: false } })
    expect(upload.status).toBe(200)
    await upload.body!.cancel()
    const initial = await read()
    expect(initial.credentials).toHaveLength(1)
    const credential = initial.credentials[0]
    const filePath = `/api/read/supplier-credentials/${created.id}/files/${credential.file.id}?origin=real&credentialId=${credential.id}`
    const original = await (await f.request(filePath)).json()
    expect(original.payloadBase64).toBe(bytes.toString('base64'))

    const firstResponse = await execute({ ...base, ...versions(initial), commandId: 'credential-restart-delete-a', action: 'delete', credentialId: credential.id })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json()
    expect(first).toMatchObject({ credentialId: credential.id, auditId: expect.any(String), deletionToken: expect.any(String) })
    expect((await f.request(filePath)).status).toBe(404)
    const restoredResponse = await execute({ ...base, ...versions(await read()), commandId: 'credential-restart-restore-a', action: 'restore', credentialId: credential.id, auditId: first.auditId, deletionToken: first.deletionToken })
    expect(restoredResponse.status).toBe(200)
    await restoredResponse.body!.cancel()
    expect(await (await f.request(filePath)).json()).toEqual(original)

    const secondCommand = { ...base, ...versions(await read()), commandId: 'credential-restart-delete-b', action: 'delete', credentialId: credential.id }
    const secondResponse = await execute(secondCommand)
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json()
    expect(second.auditId).not.toBe(first.auditId)
    expect(second.deletionToken).not.toBe(first.deletionToken)
    await f.stop()
    await f.start()
    expect((await f.request(filePath)).status).toBe(401)
    await f.login()
    expect(await (await f.request('/api/commands/supplier-resolve', { commandId: secondCommand.commandId })).json()).toMatchObject({ outcome: 'applied', result: second })
    expect(await (await execute(secondCommand)).json()).toEqual(second)
    const before = await read()
    expect(before.credentials).toHaveLength(0)
    const snapshot = () => {
      const db = new DatabaseSync(join(f.directory, 'ruihang.sqlite'), { readOnly: true })
      try {
        return Object.fromEntries(['supplier_credential_scopes', 'supplier_credentials', 'supplier_credential_files', 'supplier_credential_audits', 'supplier_command_receipts'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
      }
      finally { db.close() }
    }
    const storedBefore = snapshot()
    const stale = await execute({ ...base, ...versions(before), commandId: 'credential-restart-stale-restore', action: 'restore', credentialId: credential.id, auditId: first.auditId, deletionToken: first.deletionToken })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ data: { code: 'conflict', message: '这次删除已经失效，不能用旧撤回恢复当前资料' } })
    const after = await read()
    expect(Number.isFinite(Date.parse(before.asOf))).toBe(true)
    expect(Number.isFinite(Date.parse(after.asOf))).toBe(true)
    expect({ ...after, asOf: before.asOf }).toEqual(before)
    expect(snapshot()).toEqual(storedBefore)
    expect((await f.request(filePath)).status).toBe(404)

    const restoreB = { ...base, ...versions(await read()), commandId: 'credential-restart-restore-b', action: 'restore', credentialId: credential.id, auditId: second.auditId, deletionToken: second.deletionToken }
    const finalResponse = await execute(restoreB)
    expect(finalResponse.status).toBe(200)
    const result = await finalResponse.json()
    expect(await (await execute(restoreB)).json()).toEqual(result)
    const final = await read()
    expect(final.credentials).toHaveLength(1)
    expect(final.credentials[0]).toMatchObject({ id: credential.id, file: { id: credential.file.id } })
    expect(await (await f.request(filePath)).json()).toEqual(original)
    expect((await f.request('/api/auth/logout', {})).status).toBe(200)
    expect((await f.request(filePath)).status).toBe(401)
  }
  finally { await f.stop() }
}, 90000)
