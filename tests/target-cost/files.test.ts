import { expect, it } from 'vitest'
import { parseBudgetFileChanges } from '../../app/lib/target-cost/central-files'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { applyBudgetFileChanges, loadBudgetFiles, readBudgetFileContent } from '../../server/utils/target-cost-files'

const context = { actorId: 'budget-actor', timestamp: '2026-09-13T01:00:00.000Z' }
it('中央预算原件真实保存读取；缺件明确，跨预算不能读写，失败补传不丢旧元数据和审计', async () => {
  const instance = createQuantityTestInstance({ session: () => ({ workspaceId: 'files', actorId: context.actorId, capabilities: ['target-cost:write'] }), projects: () => [] })
  try {
    await instance.withWorkspaceTransaction(async (db) => {
      await db.execute('INSERT INTO target_costs(id,name) VALUES (?,?),(?,?)', ['a', '版本A', 'b', '版本B'])
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size) VALUES (?,\'target_cost\',?,?,?,?)', ['missing', 'a', '旧缺件.xlsx', 'C:/旧件.xlsx', 30])
    })
    expect(await instance.withWorkspaceTransaction(db => readBudgetFileContent(db, 'a', 'missing'))).toMatchObject({ state: 'missing', reason: 'missing-payload' })
    const [id] = await instance.withWorkspaceTransaction(db => applyBudgetFileChanges(db, 'a', { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/vnd.ms-excel', payloadBase64: 'YWJj' }], removeIds: ['missing'] }, context))
    const read = await instance.withWorkspaceTransaction(db => readBudgetFileContent(db, 'a', id!))
    expect(read).toMatchObject({ state: 'available', payloadBase64: 'YWJj', sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' })
    const files = await instance.withWorkspaceTransaction(db => loadBudgetFiles(db, 'a'))
    expect(files).toContainEqual(expect.objectContaining({ id, payloadState: 'available', uploader: context.actorId }))
    expect(files).toContainEqual(expect.objectContaining({ id: 'missing', payloadState: 'missing', deletedAt: context.timestamp }))
    expect(files.every(file => !Object.hasOwn(file, 'filePath'))).toBe(true)
    await expect(instance.withWorkspaceTransaction(db => readBudgetFileContent(db, 'b', id!))).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(instance.withWorkspaceTransaction(db => applyBudgetFileChanges(db, 'b', { removeIds: [id!] }, context))).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(instance.withWorkspaceTransaction(db => applyBudgetFileChanges(db, 'a', { restoreIds: ['missing'], add: [{ fileName: '坏件', fileSize: 4, mimeType: '', payloadBase64: 'YWJj' }] }, context))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await instance.withWorkspaceTransaction(db => loadBudgetFiles(db, 'a'))).toEqual(files)
    const logs = await instance.withWorkspaceTransaction(db => db.select<{ action: string, operator: string, before_data: string | null, after_data: string }>('SELECT * FROM operation_logs WHERE table_name = \'file_refs\' ORDER BY action'))
    expect(logs.map(log => log.action)).toEqual(['create', 'delete'])
    expect(logs.every(log => log.operator === context.actorId)).toBe(true)
    expect(JSON.parse(logs[1]!.before_data!)).toMatchObject({ id: 'missing', deleted_at: null, file_path: 'C:/旧件.xlsx' })
  }
  finally { await instance.close() }
})

it.each([
  { add: [{ fileName: '旧路径', fileSize: 0, mimeType: '', payloadBase64: '', filePath: 'C:/secret' }] },
  { add: [{ fileName: '伪造经办人', fileSize: 0, mimeType: '', payloadBase64: '', uploader: 'another' }] },
  { removeIds: ['same'], restoreIds: ['same'] },
])('附件命令边界拒绝路径/身份注入或矛盾变更 %#', (changes) => {
  expect(() => parseBudgetFileChanges(changes)).toThrow()
})

it('旧附件未知大小保持null，真实正文仍可读；损坏正文不能伪报缺件', async () => {
  const instance = createQuantityTestInstance({ session: () => ({ workspaceId: 'legacy-file', actorId: context.actorId, capabilities: ['target-cost:read'] }), projects: () => [] })
  try {
    await instance.withWorkspaceTransaction(async (db) => {
      await db.execute('INSERT INTO target_costs(id,name) VALUES (?,?)', ['a', '旧版本'])
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,uploaded_at) VALUES (?,\'target_cost\',?,NULL,NULL,NULL)', ['unknown-meta', 'a'])
      await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES (?,\'base64\',?)', ['unknown-meta', 'YWJj'])
    })
    expect(await instance.withWorkspaceTransaction(db => loadBudgetFiles(db, 'a'))).toEqual([expect.objectContaining({ fileSize: null, uploadedAt: null, payloadState: 'available' })])
    expect(await instance.withWorkspaceTransaction(db => readBudgetFileContent(db, 'a', 'unknown-meta'))).toMatchObject({ state: 'available', fileSize: null, payloadBase64: 'YWJj' })
    await instance.withWorkspaceTransaction(db => db.execute('UPDATE file_payloads SET content = ?', ['bad-base64']))
    await expect(instance.withWorkspaceTransaction(db => readBudgetFileContent(db, 'a', 'unknown-meta'))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await instance.close() }
})
