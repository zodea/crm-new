import { Buffer } from 'node:buffer'
import { afterAll, expect, it } from 'vitest'
import { supplierProductionProcess } from '../helpers/production-supplier-process'
import { cleanupTestTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('真实HTTP启动补算到期提醒，登录/失响应/重启保留已读原键，演示源与篡改身份拒绝', async () => {
  const fixture = await supplierProductionProcess()
  const identity = { workspaceId: 'supplier-workspace', actorId: 'supplier-owner' }
  try {
    await fixture.start()
    await fixture.login()
    const response = await fixture.request('/api/commands/suppliers', { ...identity, requiredCapability: 'supplier:write', commandId: 'notification-create', action: 'save', baseVersion: null, attachments: {}, draft: { name: 'HTTP合成资料提醒', contact: '合成人', supplierCategory: '其他' } })
    expect(response.status).toBe(200)
    const created = await response.json()
    const scope = await (await fixture.request(`/api/read/supplier-credentials/${created.id}?origin=real`)).json()
    const bytes = Buffer.from('%PDF-1.7\nSynthetic notification original\n%%EOF')
    expect((await fixture.request('/api/commands/supplier-credentials', { ...identity, requiredCapability: 'supplier-credential:write', origin: 'real', commandId: 'notification-upload', supplierId: created.id, baseSupplierVersion: scope.supplierVersion, baseCredentialVersion: scope.credentialVersion, action: 'upload', draft: { category: '营业执照', validFrom: '', expiresAt: scope.businessDate, longTerm: false, fileName: '合成通知原件.pdf', mimeType: 'application/pdf', fileSize: bytes.length, payloadBase64: bytes.toString('base64') } })).status).toBe(200)
    await fixture.stop()
    await fixture.start()
    expect((await fixture.request('/api/read/notifications')).status).toBe(401)
    await fixture.login()
    const page = await (await fixture.request('/api/read/notifications')).json()
    expect(page).toMatchObject({ dataOrigin: 'real', evaluationState: 'ready', unreadCount: 1, items: [{ title: '分供方证照即将到期', problem: { state: 'active', severity: 'expiring' } }] })
    const command = { ...identity, commandId: 'notification-open-original', action: 'open', eventId: page.items[0].eventId }
    const opened = await fixture.request('/api/commands/notifications', command)
    expect(opened.status).toBe(200)
    await opened.body!.cancel()
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    const recovered = await (await fixture.request('/api/commands/notifications', command)).json()
    expect(recovered).toMatchObject({ commandId: command.commandId, eventId: command.eventId, target: { state: 'resolved', intent: { variant: 'credentials', subject: { id: created.id } } } })
    expect(await (await fixture.request('/api/commands/notifications', command)).json()).toEqual(recovered)
    const cold = await (await fixture.request('/api/read/notifications')).json()
    expect(cold).toMatchObject({ unreadCount: 0, items: [{ eventId: command.eventId, readAt: recovered.readAt, problem: { state: 'active' } }] })
    expect((await fixture.request('/api/read/notifications?origin=demo')).status).toBe(403)
    expect((await fixture.request('/api/commands/notifications', { ...command, actorId: 'other-owner' })).status).toBe(403)
    expect((await fixture.request('/api/commands/notifications', { ...command, action: 'mark-all-read', eventId: null })).status).toBe(409)
  }
  finally { await fixture.stop() }
}, 60_000)
