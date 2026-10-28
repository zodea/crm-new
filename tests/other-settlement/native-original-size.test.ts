import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readOtherSettlementStored } from '../../app/lib/other-settlement/storage'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

let nativeTemplate: Uint8Array
beforeAll(async () => {
  const memory = await createMigratedMemoryDb()
  try {
    nativeTemplate = memory.raw.export()
  }
  finally { memory.close() }
})

it.each([null, 0])('真实Native历史原件大小%s冷读取不伪造0、不改原元数据或正文', async (fileSize) => {
  const base = testTempRoot('a02-material-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'other-native-original-size-'))
  const path = join(directory, 'synthetic-native.sqlite')
  await writeFile(path, nativeTemplate)
  const seed = new DatabaseSync(path)
  try {
    seed.prepare('INSERT INTO expenditure_settlements(id,name,total_amount,status) VALUES(?,?,?,?)').run('old-head', '原结算', 0, 'draft')
    seed.prepare('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-original', 'expenditure_settlement', 'old-head', '原历史文件.txt', '', fileSize, 'text/plain', '历史原件', '原上传人', '2026-10-05T00:00:00.000Z')
    if (fileSize === 0)
      seed.prepare('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,?,?)').run('old-original', 'base64', '')
  }
  finally { seed.close() }
  const bytes = await readFile(path)
  const raw = new DatabaseSync(path, { readOnly: true })
  try {
    const tx = { async execute() {
      throw new Error('历史源只读')
    }, async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...params as never[]).map(row => ({ ...row })) as T[]
    } }
    if (fileSize === null)
      await expect(readOtherSettlementStored(tx, { workspaceId: 'historical-workspace' })).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('大小未知') } })
    else
      expect((await readOtherSettlementStored(tx, { workspaceId: 'historical-workspace' })).records[0]!.attachments[0]).toMatchObject({ id: 'old-original', fileSize: 0, fileName: '原历史文件.txt', uploader: '原上传人' })
    expect(raw.prepare('SELECT file_size,uploader FROM file_refs WHERE id=?').get('old-original')).toMatchObject({ file_size: fileSize, uploader: '原上传人' })
    expect(raw.prepare('SELECT * FROM file_payloads WHERE file_ref_id=?').all('old-original').map(row => ({ ...row }))).toEqual(fileSize === null ? [] : [{ file_ref_id: 'old-original', encoding: 'base64', content: '' }])
    expect(raw.prepare('SELECT total_amount,status,version,record_json FROM expenditure_settlements WHERE id=?').get('old-head')).toMatchObject({ total_amount: 0, status: 'draft', version: 0, record_json: null })
  }
  finally { raw.close() }
  expect((await readFile(path)).equals(bytes)).toBe(true)
})

afterAll(cleanupTestTempRoot)
