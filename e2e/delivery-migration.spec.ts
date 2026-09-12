import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

test('真实 SQLite 送货头行原件打印与历史通过 HTTP 迁移、重试和回滚', async ({ request }, info) => {
  test.setTimeout(120_000)
  const reset = await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect(reset.ok(), await reset.text()).toBe(true)
  const destination = info.outputPath('delivery-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/delivery-migration-source.ts'), destination])
  const { source, snapshotSha256, byteLength, payloadBase64 } = JSON.parse(await readFile(destination, 'utf8'))
  try {
    const session = await (await request.get('/api/read/business-session')).json()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId, requiredCapability: 'core:migration:write' })
    const preflight = await request.post('/api/migrations/core/preflight', { data: { ...envelope('delivery-http-preflight'), source, backup: null } })
    expect(preflight.ok(), await preflight.text()).toBe(true)
    const dry = await request.post('/api/migrations/core/dry-run', { data: { ...envelope('delivery-http-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength, createdAt: new Date().toISOString(), immutable: true } } })
    expect(dry.ok(), await dry.text()).toBe(true)
    const batch = await dry.json()
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'delivery_records', metricKey: 'missing-original' }))
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'delivery_records', metricKey: 'legacy-audit' }))
    for (const action of ['import', 'import', 'confirm', 'confirm']) {
      const response = await request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(`delivery-http-${action}`), batchId: batch.batchId } })
      expect(response.ok(), await response.text()).toBe(true)
    }
    const list = await (await request.get('/api/read/deliveries?origin=real')).json()
    expect(list.records).toHaveLength(3)
    const record = list.records.find((row: { orderNo: string }) => row.orderNo === 'HTTP-441-source')
    const shared = list.records.find((row: { orderNo: string }) => row.orderNo === 'HTTP-441-shared')
    expect(record.id).not.toBe('http-delivery-source')
    expect(shared.assetId).toBe(record.assetId)
    expect(record).toMatchObject({ printDisposition: 'printed', lines: [{ qty: 2, amount: 20 }] })
    expect(list.records.find((row: { orderNo: string }) => row.orderNo === 'HTTP-441-missing').assetId).toBeNull()
    const query = new URLSearchParams({ origin: 'real', projectId: record.projectId, supplierId: record.supplierId })
    const url = `/api/read/deliveries/${record.id}/files/${encodeURIComponent(record.assetId)}?${query}`
    const contentResponse = await request.get(url)
    expect(contentResponse.ok(), await contentResponse.text()).toBe(true)
    const content = await contentResponse.json()
    expect(content.payloadBase64).toBe(payloadBase64)
    expect(content.sha256).toBe(createHash('sha256').update(Buffer.from(payloadBase64, 'base64')).digest('hex'))
    const rollback = await request.post(`/api/migrations/core/${batch.batchId}/rollback`, { data: { ...envelope('delivery-http-rollback'), batchId: batch.batchId } })
    expect(rollback.ok(), await rollback.text()).toBe(true)
    expect((await request.get(url)).status()).toBe(404)
    expect((await (await request.get('/api/read/deliveries?origin=real')).json()).records).toHaveLength(0)
  }
  finally {
    await request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  }
})
