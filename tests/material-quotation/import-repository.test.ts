import { expect, it } from 'vitest'
import { createQuotationImportRepository, decodeQuotationImportResult } from '~/lib/material-quotation/import-repository'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

const actor = { workspaceId: 'quotation-import-workspace', actorId: 'quotation-import-actor', capabilities: ['material-quotation:read', 'core:migration:write'] }
const result = { batchId: 'quotation-source-batch', commandId: 'original-import-command', graphHash: 'a'.repeat(64), importedIds: ['original-quote-id'], updatedAt: '2026-10-05T00:00:00.000Z' }
it('迁入读取证明与完整图摘要保持原编号，结果未知只发送同一恢复键', async () => {
  const calls: {
    url: string
    options?: object
  }[] = []
  const meta = createReadMeta({ session: actor, schemaVersion: 'material-quotation-import-read-v1', operation: 'quotation:imports', dataOrigin: 'real', asOf: result.updatedAt, coverage: 'complete', scope: {}, sources: [{ key: 'material-quotations', state: 'readable', sourceVersion: 'actual-import-proof', asOf: result.updatedAt }] })
  const repo = createQuotationImportRepository(async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/import/resolve'))
      return { outcome: 'applied', result }
    return withReadMeta({ records: [result] }, meta)
  })
  expect((await repo.list()).records).toEqual([result])
  expect(await repo.resolve(result.commandId)).toEqual({ outcome: 'applied', result })
  expect(calls[1]).toEqual({ url: '/api/commands/material-quotations/import/resolve', options: { method: 'POST', body: { commandId: 'original-import-command' } } })
})
it('迁入候选来自本次实际目录/记录版本；缺读取证明、重复目标或伪版本均拒绝', async () => {
  const reference = { entityType: 'projects', serverId: 'actual-project', label: '真实项目', version: '3', sourceVersion: 'projects:7' }
  const meta = createReadMeta({ session: actor, schemaVersion: 'material-quotation-import-context-v1', operation: 'quotation:import-context', dataOrigin: 'real', asOf: result.updatedAt, coverage: 'complete', scope: {}, sources: [{ key: 'projects', state: 'readable', sourceVersion: reference.sourceVersion, asOf: result.updatedAt }] })
  const response = withReadMeta({ ...actor, references: [reference] }, meta)
  expect((await createQuotationImportRepository(async () => response).context()).references).toEqual([reference])
  await expect(createQuotationImportRepository(async () => ({ ...response, meta: null })).context()).rejects.toThrow('实际读取证明')
  await expect(createQuotationImportRepository(async () => ({ ...response, references: [reference, reference] })).context()).rejects.toThrow('身份重复')
  await expect(createQuotationImportRepository(async () => ({ ...response, references: [{ ...reference, sourceVersion: 'guessed-version' }] })).context()).rejects.toThrow('关联证据无效')
})
it('不同原命令、缺证明或伪造额外回执字段明确拒绝', async () => {
  const wrong = createQuotationImportRepository(async () => ({ outcome: 'applied', result: { ...result, commandId: 'different-command' } }))
  await expect(wrong.resolve(result.commandId)).rejects.toThrow('当前原编号')
  await expect(createQuotationImportRepository(async () => ({ records: [result] })).list()).rejects.toThrow('实际读取证明')
  expect(() => decodeQuotationImportResult({ ...result, guessedSupplier: 'same-name-party' })).toThrow('无效')
  expect(() => decodeQuotationImportResult({ ...result, importedIds: ['original-quote-id', 'original-quote-id'] })).toThrow('无效')
})
it.each(['commandId', 'batchId', 'graphHash'] as const)('本次请求 %s 与回执不符时保留原恢复键，不把另一图当作成功', async (field) => {
  const value = { ...result, [field]: field === 'graphHash' ? 'b'.repeat(64) : 'different-original-id' }
  const repo = createQuotationImportRepository(async () => value)
  await expect(repo.execute({ ...actor, source: { sha256: 'a'.repeat(64), payloadBase64: 'fixture' }, bindings: [], requiredCapability: 'core:migration:write', commandId: result.commandId, batchId: result.batchId, graphHash: result.graphHash, graph: { schemaVersion: 'material-quotation-graph-v1', revision: 0, originals: [], tables: { file_refs: [], material_quotations: [], material_quotation_lines: [], material_quotation_history: [], material_quotation_commands: [], material_quotation_resolutions: [], material_quotation_files: [], quotation_imports: [] } } })).rejects.toThrow('本次原编号')
})
