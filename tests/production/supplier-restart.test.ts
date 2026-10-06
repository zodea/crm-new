import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { decodeSupplierDetailRead, decodeSupplierListPage } from '../../app/lib/supplier/read-decoder'
import { supplierProductionProcess } from '../helpers/production-supplier-process'

it('真实公开服务重启后恢复原件、OCR候选/人工值及失响应原键，回滚/撤权/跨来源仍拒绝', async () => {
  const f = await supplierProductionProcess()
  const identity = { workspaceId: 'supplier-workspace', actorId: 'supplier-owner' }
  const command = { ...identity, requiredCapability: 'supplier:write', commandId: 'restart-create-supplier', action: 'save', baseVersion: null, draft: { name: '原始合成公司', contact: '合成人', supplierCategory: '其他', externalRef: 'legacy-0007' }, attachments: {} }
  try {
    await f.start()
    await f.login()
    const response = await f.request('/api/commands/suppliers', command)
    expect(response.status).toBe(200)
    await response.body!.cancel()
    await f.stop()
    await f.start()
    expect((await f.request('/api/read/suppliers')).status).toBe(401)
    await f.login()
    const recovered = await (await f.request('/api/commands/supplier-resolve', { commandId: command.commandId })).json()
    expect(recovered.outcome).toBe('applied')
    const id: string = recovered.result.id
    expect(await (await f.request('/api/commands/suppliers', command)).json()).toEqual(recovered.result)
    const currentSession = await (await f.request('/api/read/business-session')).json()
    expect(currentSession.capabilities).toEqual(expect.arrayContaining(['finance-payment-application:read', 'finance-payment-record:read']))
    const paymentSource = new DatabaseSync(join(f.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      expect(paymentSource.prepare('SELECT schema_version FROM production_participants WHERE domain=?').all('finance')).toEqual([{ schema_version: 1 }])
      expect(paymentSource.prepare('SELECT revision FROM finance_revision WHERE singleton=1').all()).toEqual([{ revision: 0 }])
      expect(paymentSource.prepare('SELECT COUNT(*) AS n FROM payment_records').all()).toEqual([{ n: 0 }])
      expect(paymentSource.prepare('SELECT COUNT(*) AS n FROM payment_record_application_allocations').all()).toEqual([{ n: 0 }])
    }
    finally { paymentSource.close() }
    const list = decodeSupplierListPage(await (await f.request('/api/read/suppliers')).json())
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ projectCount: null, paymentAmount: '0.00', contractAmount: null })
    expect(list.meta.sources).toContainEqual(expect.objectContaining({ key: 'payments', state: 'readable', sourceVersion: 'finance-0' }))
    expect(list.unavailableSources).toContain('contracts')
    expect((await f.request(`/api/read/suppliers?columnFilters=${encodeURIComponent(JSON.stringify({ ranges: { projectCount: { min: 0 } } }))}`)).status).toBe(503)
    const paymentSorted = await f.request('/api/read/suppliers?sort=paymentAmount-desc')
    expect(paymentSorted.status).toBe(200)
    expect(decodeSupplierListPage(await paymentSorted.json()).items.map(row => [row.supplier.id, row.paymentAmount])).toEqual([[id, '0.00']])
    const detail = decodeSupplierDetailRead(await (await f.request(`/api/read/suppliers/${id}?origin=real`)).json())
    expect(detail.summary).toMatchObject({ projectCount: null, contractCount: null, contractAmount: { value: null } })
    expect(detail.summary.paymentAmount).toMatchObject({ status: 'complete', value: '0.00', knownValue: '0.00', participatingCount: 0, missingSources: [] })
    const bytes = Buffer.from('%PDF-1.7\nSynthetic original\n%%EOF')
    const base = { ...identity, requiredCapability: 'supplier-credential:write', origin: 'real', supplierId: id }
    const upload = { ...base, commandId: 'restart-upload-original', baseSupplierVersion: '1', baseCredentialVersion: '0', action: 'upload', draft: { fileName: '合成原件.pdf', mimeType: 'application/pdf', fileSize: bytes.length, payloadBase64: bytes.toString('base64'), category: '营业执照', validFrom: '', expiresAt: '', longTerm: false } }
    const uploadedResponse = await f.request('/api/commands/supplier-credentials', upload)
    expect(uploadedResponse.status).toBe(200)
    const uploaded = await uploadedResponse.json()
    const read = () => f.request(`/api/read/supplier-credentials/${id}?origin=real`).then(response => response.json())
    const credential = (await read()).credentials[0]
    const filePath = `/api/read/supplier-credentials/${id}/files/${credential.file.id}?origin=real&credentialId=${credential.id}`
    const original = await (await f.request(filePath)).json()
    expect(original.payloadBase64).toBe(bytes.toString('base64'))
    const recognize = { ...base, commandId: 'restart-recognize', baseSupplierVersion: uploaded.supplierVersion, baseCredentialVersion: uploaded.credentialVersion, credentialId: credential.id, action: 'ocr-recognize', options: {} }
    expect((await f.request('/api/commands/supplier-credentials', recognize)).status).toBe(200)
    const candidate = await read()
    expect(candidate.credentials[0].recognition.result.markdownPages[0]).toContain('识别候选公司')
    const confirmation = { ...base, commandId: 'restart-confirm', baseSupplierVersion: candidate.supplierVersion, baseCredentialVersion: candidate.credentialVersion, credentialId: credential.id, action: 'ocr-confirm', draft: { recognitionId: candidate.credentials[0].recognition.id, category: '营业执照', longTerm: false, decisions: { category: 'keep-current', longTerm: 'keep-current' }, choices: candidate.credentials[0].recognition.parsed.fields.map((field: { key: string }) => field.key === 'name' ? { key: 'name', decision: 'manual', manualValue: '人工核对后公司' } : { key: field.key, decision: 'keep-current' }) } }
    const savedResponse = await f.request('/api/commands/supplier-credentials', confirmation)
    expect(savedResponse.status).toBe(200)
    await savedResponse.body!.cancel()
    await f.stop()
    await f.start(true)
    await f.login()
    const secondColdList = decodeSupplierListPage(await (await f.request('/api/read/suppliers')).json())
    expect(secondColdList.items.map(row => [row.supplier.id, row.paymentAmount])).toEqual([[id, '0.00']])
    expect(secondColdList.meta.sources).toContainEqual(expect.objectContaining({ key: 'payments', state: 'readable', sourceVersion: 'finance-0' }))
    const saved = await (await f.request('/api/commands/supplier-resolve', { commandId: confirmation.commandId })).json()
    expect(saved).toMatchObject({ outcome: 'applied', result: { supplierId: id } })
    expect(await (await f.request('/api/commands/supplier-credentials', confirmation)).json()).toEqual(saved.result)
    expect((await (await f.request(`/api/read/suppliers/${id}/form`)).json()).draft.name).toBe('人工核对后公司')
    const cold = await read()
    expect(cold.credentials[0]).toMatchObject({ recognition: candidate.credentials[0].recognition, ocrReviewStatus: 'confirmed', ocrConfirmedResult: { fields: { name: '人工核对后公司' } } })
    expect(await (await f.request(filePath)).json()).toEqual(original)
    expect((await f.request('/api/commands/supplier-credentials', { ...recognize, commandId: 'failed-recognition', baseSupplierVersion: cold.supplierVersion, baseCredentialVersion: cold.credentialVersion })).status).toBe(503)
    expect(await (await f.request(filePath)).json()).toEqual(original)
    const raw = new DatabaseSync(join(f.directory, 'ruihang.sqlite'))
    raw.exec('CREATE TRIGGER fail_supplier_audit BEFORE INSERT ON supplier_credential_audits BEGIN SELECT RAISE(ABORT,\'synthetic-before-commit\'); END')
    raw.close()
    const another = { ...upload, commandId: 'atomic-original', baseSupplierVersion: cold.supplierVersion, baseCredentialVersion: cold.credentialVersion }
    expect((await f.request('/api/commands/supplier-credentials', another)).status).toBe(500)
    const repaired = new DatabaseSync(join(f.directory, 'ruihang.sqlite'))
    expect(repaired.prepare('SELECT count(*) AS n FROM supplier_credentials').get()!.n).toBe(1)
    expect(repaired.prepare('SELECT count(*) AS n FROM file_payloads').get()!.n).toBe(1)
    repaired.exec('DROP TRIGGER fail_supplier_audit')
    repaired.close()
    expect((await f.request('/api/commands/supplier-credentials', another)).status).toBe(200)
    expect((await f.request('/api/commands/suppliers', { ...command, draft: { ...command.draft, name: '不能改原键' } })).status).toBe(409)
    expect((await f.request('/api/commands/supplier-credentials', { ...upload, commandId: 'stale-upload' })).status).toBe(409)
    expect((await f.request('/api/commands/suppliers', { ...command, commandId: 'forged-actor', actorId: 'fake-owner' })).status).toBe(403)
    expect((await f.request('/api/commands/suppliers', { ...command, commandId: 'invalid-source', origin: 'demo' })).status).toBe(422)
    expect((await f.request('/api/read/suppliers?origin=demo')).status).toBe(403)
    expect((await f.request('/api/read/suppliers', undefined, { 'x-ruihang-test-session': 'fake' })).status).toBe(403)
    expect(await (await f.request('/api/commands/supplier-resolve', { commandId: 'sealed-missing' })).json()).toMatchObject({ outcome: 'not-applied', result: null })
    expect((await f.request('/api/commands/suppliers', { ...command, commandId: 'sealed-missing' })).status).toBe(409)
    expect((await f.request('/api/auth/logout', {})).status).toBe(200)
    expect((await f.request(filePath)).status).toBe(401)
  }
  finally { await f.stop() }
}, 90000)
