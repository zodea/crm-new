import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

test('Issue #436 真实 SQLite 全字段及正文经 HTTP 迁移、中央更正与批次回滚', async ({ request }, info) => {
  test.setTimeout(90_000)
  const reset = await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok()).toBe(true)
  await request.post('/api/testing/receipts/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
  const sourcePath = info.outputPath('receipt-migration-source.json')
  // Vite 负责 SQLite 适配器的 glob 转换；HTTP 测试进程仅接收真实旧库生成的 DTO。
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/receipt-migration-source.ts'), sourcePath])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(sourcePath, 'utf8'))
  try {
    const session = await (await request.get('/api/read/business-session')).json()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'core:migration:write', commandId })
    const preflight = await request.post('/api/migrations/core/preflight', { data: { ...envelope('receipt-http-preflight'), source, backup: null } })
    expect(preflight.ok(), await preflight.text()).toBe(true)
    const dry = await request.post('/api/migrations/core/dry-run', { data: { ...envelope('receipt-http-dry'), source, backup: {
      backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`,
      sourceHash: source.sourceHash,
      sourceVersion: source.sourceVersion,
      snapshotSha256,
      byteLength,
      createdAt: new Date().toISOString(),
      immutable: true,
    } } })
    expect(dry.ok(), await dry.text()).toBe(true)
    const batch = await dry.json()
    for (const action of ['import', 'confirm']) {
      const response = await request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(`receipt-http-${action}`), batchId: batch.batchId } })
      expect(response.ok(), await response.text()).toBe(true)
    }
    const list = await (await request.get('/api/read/receipts', { params: { origin: 'real', search: 'SK-HTTP-MIGRATE-436' } })).json()
    expect(list.items).toHaveLength(1)
    const original = list.items[0].record
    expect(original.id).not.toBe('http-receipt-436')
    expect(original.draft).toMatchObject({ no: 'SK-HTTP-MIGRATE-436', amount: '12.35', receiptDate: '2026-09-10', payerAccount: '6222436', paymentMethod: '承兑汇票', acceptanceBillNo: 'CD-HTTP-436', billDueDate: '2026-12-10', periodNo: '二期', bankSerialNo: 'BANK-HTTP-436', handler: '迁移经办', reviewStatus: '待审核', status: 'submitted', note: '完整历史备注' })
    expect(original.draft.contractId).not.toBeNull()
    expect(original.draft.contractId).not.toBe('http-contract-436')
    expect(original.attachments[0]).toMatchObject({ id: 'http-file-436', ownerId: original.id, filePath: '', fileSize: 6, uploader: '历史经办', category: 'voucher' })
    const contentResponse = await request.get(`/api/read/receipts/${encodeURIComponent(original.id)}/files/http-file-436?origin=real`)
    expect(contentResponse.ok()).toBe(true)
    const content = await contentResponse.json()
    expect(Buffer.from(content.payloadBase64, 'base64').toString('utf8')).toBe('收款')
    expect(content.sha256).toBe(createHash('sha256').update(Buffer.from(content.payloadBase64, 'base64')).digest('hex'))
    const save = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'receipt:write', origin: 'real', action: 'save', attachments: {} }
    const correction = await request.post('/api/commands/receipts', { data: { ...save, id: original.id, commandId: 'receipt-http-correct', baseVersion: original.version, draft: { ...original.draft, note: '中央更正保留' } } })
    expect(correction.ok(), await correction.text()).toBe(true)
    const replay = await request.post(`/api/migrations/core/${batch.batchId}/confirm`, { data: { ...envelope('receipt-http-confirm-replay'), batchId: batch.batchId } })
    expect(replay.ok(), await replay.text()).toBe(true)
    const corrected = await (await request.get(`/api/read/receipts/${encodeURIComponent(original.id)}/record?origin=real`)).json()
    expect(corrected.record.draft.note).toBe('中央更正保留')
    const independentResponse = await request.post('/api/commands/receipts', { data: { ...save, commandId: 'receipt-http-independent', baseVersion: null, draft: { ...original.draft, no: 'SK-HTTP-INDEPENDENT-436', bankSerialNo: '' } } })
    expect(independentResponse.ok(), await independentResponse.text()).toBe(true)
    const independent = await independentResponse.json()
    const rollback = await request.post(`/api/migrations/core/${batch.batchId}/rollback`, { data: { ...envelope('receipt-http-rollback'), batchId: batch.batchId } })
    expect(rollback.ok(), await rollback.text()).toBe(true)
    expect((await request.get(`/api/read/receipts/${encodeURIComponent(original.id)}/record?origin=real`)).status()).toBe(404)
    expect((await request.get(`/api/read/receipts/${encodeURIComponent(independent.id)}/record?origin=real`)).ok()).toBe(true)
    expect((await request.get(`/api/read/receipts/${encodeURIComponent(original.id)}/files/http-file-436?origin=real`)).status()).toBe(404)
  }
  finally {
    await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  }
})
