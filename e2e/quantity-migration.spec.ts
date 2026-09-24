import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

test('工程量真实SQLite十五表经HTTP迁移，更正与独立新增保留，回滚撤下原批次事实', async ({ request }, info) => {
  test.setTimeout(90_000)
  const reset = () => request.post('/api/testing/core-migration/reset', { headers: { 'x-ruihang-test-reset': '1' } })
  expect((await reset()).ok()).toBe(true)
  const sourcePath = info.outputPath('quantity-migration-source.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('e2e/helpers/quantity-migration-source.ts'), sourcePath])
  const { source, snapshotSha256, byteLength } = JSON.parse(await readFile(sourcePath, 'utf8'))
  try {
    const session = await (await request.get('/api/read/business-session')).json()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'core:migration:write', commandId })
    const independentResponse = await request.post('/api/commands/projects', { data: { ...session, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: '独立保留工程量项目', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
    expect(independentResponse.ok(), await independentResponse.text()).toBe(true)
    const independent = await independentResponse.json()
    const preflight = await request.post('/api/migrations/core/preflight', { data: { ...envelope('quantity-http-preflight'), source, backup: null } })
    expect(preflight.ok(), await preflight.text()).toBe(true)
    const dry = await request.post('/api/migrations/core/dry-run', { data: { ...envelope('quantity-http-dry'), source, backup: {
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
    expect(batch.issues.filter((issue: { metricKey: string }) => ['apply-failed', 'missing-relation', 'orphan'].includes(issue.metricKey))).toEqual([])
    const transition = async (action: string) => {
      const response = await request.post(`/api/migrations/core/${batch.batchId}/${action}`, { data: { ...envelope(randomUUID()), batchId: batch.batchId } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    await transition('import')
    await transition('confirm')
    const projectId = batch.mappings.find((row: { entityType: string, legacyId: string }) => row.entityType === 'projects' && row.legacyId === 'q-project').serverId
    const namespace = batch.mappings.find((row: { entityType: string }) => row.entityType === 'quantity_projects').serverId
    const id = (table: string, old: string) => `${namespace}:${table}:${old}`
    const query = { projectId, origin: 'real', includeDemo: false }
    const read = async (surface: string, params = query) => {
      const response = await request.get(`/api/read/quantity/${surface}`, { params })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const region = await read('region')
    expect(region.data.buildings).toEqual([expect.objectContaining({ id: id('buildings', 'q-building'), name: '一栋' })])
    const templates = await read('templates')
    expect(templates.data.lines).toEqual([expect.objectContaining({ boqLineId: 'q-boq', contractQty: 0, provisionalQty: 6, fieldQty: null })])
    const unitId = id('units', 'q-unit')
    const detailQuery = { ...query, unitId }
    const detail = await read('completion', detailQuery)
    const stage = detail.data.stages[0]
    const content = await read('photo', { ...detailQuery, completionId: stage.completion.id, photoId: id('file_refs', 'q-photo') } as typeof query)
    expect(content.data.contentBase64).toBe('AQID')
    const correction = await request.post('/api/commands/quantity', { data: { ...session, projectId, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: detail.sourceVersion, action: { kind: 'save-completion', draft: { projectId, unitId, stageId: stage.id, status: 'completed', completedAt: '2026-09-11', note: '中央HTTP更正', expectedCompletionId: stage.completion.id, expectedCompletionFingerprint: stage.completion.fingerprint, expectedAssignmentId: stage.currentAssignment?.id ?? null, photos: [] } } } })
    expect(correction.ok(), await correction.text()).toBe(true)
    await transition('confirm')
    expect((await read('completion', detailQuery)).data.stages[0].completion.note).toBe('中央HTTP更正')
    const independentQuery = { ...query, projectId: independent.id }
    const independentBefore = await read('region', independentQuery)
    const newBuilding = await request.post('/api/commands/quantity', { data: { ...session, projectId: independent.id, origin: 'real', requiredCapability: 'quantity:write', commandId: randomUUID(), baseVersion: independentBefore.sourceVersion, action: { kind: 'create-building', draft: { code: 'I1', name: '独立新建一栋' } } } })
    expect(newBuilding.ok(), await newBuilding.text()).toBe(true)
    const expected = await read('region', independentQuery)
    await transition('rollback')
    expect((await request.get('/api/read/quantity/region', { params: query })).status()).toBe(404)
    const retained = await read('region', independentQuery)
    expect(retained.data).toEqual(expected.data)
    expect(retained.sourceVersion).toBe(expected.sourceVersion)
    expect((await request.get('/api/read/quantity/photo', { params: { ...detailQuery, completionId: stage.completion.id, photoId: id('file_refs', 'q-photo') } })).status()).toBe(404)
  }
  finally { expect((await reset()).ok()).toBe(true) }
})
