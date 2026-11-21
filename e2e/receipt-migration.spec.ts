import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

const BACKUP_INPUT = { createdAt: '2026-09-15T00:00:00.000Z' }
const RESET_HEADERS = { 'x-ruihang-test-reset': '1' }

async function verifyReceiptMigration(request: APIRequestContext, info: TestInfo, correctAfterImport: boolean) {
  const receiptSetup = await request.post('/api/testing/receipts/reset', { headers: RESET_HEADERS, data: { scenario: 'ready', seed: true } })
  expect(receiptSetup.ok(), await receiptSetup.text()).toBe(true)
  const reset = await request.post('/api/testing/core-migration/reset', { headers: RESET_HEADERS })
  expect(reset.ok(), await reset.text()).toBe(true)
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
      createdAt: BACKUP_INPUT.createdAt,
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
    if (correctAfterImport) {
      const correction = await request.post('/api/commands/receipts', { data: { ...save, id: original.id, commandId: 'receipt-http-correct', baseVersion: original.version, draft: { ...original.draft, note: '中央更正保留' } } })
      expect(correction.ok(), await correction.text()).toBe(true)
      const replay = await request.post(`/api/migrations/core/${batch.batchId}/confirm`, { data: { ...envelope('receipt-http-confirm-replay'), batchId: batch.batchId } })
      expect(replay.ok(), await replay.text()).toBe(true)
      const corrected = await request.get(`/api/read/receipts/${encodeURIComponent(original.id)}/record?origin=real`)
      expect(corrected.ok(), await corrected.text()).toBe(true)
      expect((await corrected.json()).record.draft.note).toBe('中央更正保留')
    }
    const identity = { workspaceId: session.workspaceId, actorId: session.actorId, baseVersion: null, attachments: {} }
    const customer = await request.post('/api/commands/customers', { data: { ...identity, requiredCapability: 'customer:write', commandId: 'receipt-http-independent-customer', action: 'save', draft: { name: '独立中央收款客户', contact: '合成经办人' } } })
    expect(customer.ok(), await customer.text()).toBe(true)
    const { id: customerId } = await customer.json()
    const project = await request.post('/api/commands/projects', { data: { ...identity, requiredCapability: 'project:write', commandId: 'receipt-http-independent-project', action: 'draft', draft: { name: '独立中央收款工程', customerId } } })
    expect(project.ok(), await project.text()).toBe(true)
    const { id: projectId } = await project.json()
    const independentResponse = await request.post('/api/commands/receipts', { data: { ...save, commandId: 'receipt-http-independent', baseVersion: null, draft: {
      ...original.draft,
      no: 'SK-HTTP-INDEPENDENT-436',
      bankSerialNo: '',
      projectId,
      customerId,
      contractId: null,
    } } })
    expect(independentResponse.ok(), await independentResponse.text()).toBe(true)
    const independent = await independentResponse.json()
    const rollback = await request.post(`/api/migrations/core/${batch.batchId}/rollback`, { data: { ...envelope('receipt-http-rollback'), batchId: batch.batchId } })
    const after = await request.get(`/api/read/receipts/${encodeURIComponent(original.id)}/record?origin=real`)
    const originalFile = await request.get(`/api/read/receipts/${encodeURIComponent(original.id)}/files/http-file-436?origin=real`)
    if (correctAfterImport) {
      expect(rollback.status()).toBe(409)
      expect(await rollback.json()).toMatchObject({ data: { code: 'conflict', message: expect.stringContaining('已有后来修改') } })
      expect(after.ok(), await after.text()).toBe(true)
      expect((await after.json()).record.draft.note).toBe('中央更正保留')
      expect(originalFile.ok(), await originalFile.text()).toBe(true)
      expect((await originalFile.json()).sha256).toBe(content.sha256)
    }
    else {
      expect(rollback.ok(), await rollback.text()).toBe(true)
      expect(after.status()).toBe(404)
      expect(originalFile.status()).toBe(404)
    }
    expect((await request.get(`/api/read/receipts/${encodeURIComponent(independent.id)}/record?origin=real`)).ok()).toBe(true)
  }
  finally {
    const receiptCleanup = await request.post('/api/testing/receipts/reset', { headers: RESET_HEADERS, data: { scenario: 'ready', seed: true } })
    expect(receiptCleanup.ok(), await receiptCleanup.text()).toBe(true)
    const migrationCleanup = await request.post('/api/testing/core-migration/reset', { headers: RESET_HEADERS })
    expect(migrationCleanup.ok(), await migrationCleanup.text()).toBe(true)
  }
}

test('Issue #436 真实 SQLite 全字段及正文经 HTTP 迁移、中央更正与批次回滚保护', async ({ request }, info) => {
  test.setTimeout(90_000)
  await verifyReceiptMigration(request, info, true)
})

test('Issue #436 未更正的收款批次可回滚并保留独立中央收款', async ({ request }, info) => {
  test.setTimeout(90_000)
  await verifyReceiptMigration(request, info, false)
})
