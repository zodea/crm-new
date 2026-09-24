import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { DELIVERY_RECORD_SOURCE_SQL, deliveryRecordSourceEntities } from '~/lib/migration/delivery-record-source'
import { createMemoryDb } from '../helpers/memory-db'

const payload = btoa('%PDF-1.7\noriginal multi-page source\n%%EOF')
describe('送货旧库完整迁移来源', () => {
  it('sQLite 软删除 UTC 时间转换为 HTTP 日期时间，非法日历值不冒充已删除事实', async () => {
    const row = { id: 'deleted', lines_json: '[]', sources_json: '[]', audit_json: '[]', deleted_at: '2026-09-10 01:02:03' }
    expect((await deliveryRecordSourceEntities([row]))[0]?.deletedAt).toBe('2026-09-10T01:02:03.000Z')
    await expect(deliveryRecordSourceEntities([{ ...row, deleted_at: '2026-02-31 01:02:03' }])).rejects.toThrow('软删除时间')
  })
  it('真实 SQLite 读取头、所有材料版本、共享原件与原始审计，缺失保持缺失', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
      await db.execute('INSERT INTO projects(id,name) VALUES(\'p-old\',\'项目\')')
      await db.execute('INSERT INTO suppliers(id,name) VALUES(\'s-old\',\'分供方\')')
      for (const id of ['one', 'two', 'missing']) {
        await db.execute('INSERT INTO delivery_records(id,project_id,supplier_id,order_no,delivery_date,archived,stored,print_batch_id,print_disposition,ocr_status) VALUES(?, \'p-old\',\'s-old\',?,\'2026-09-11\',1,1,\'upload-original\',\'printed\',\'reviewed\')', [id, id])
        await db.execute('INSERT INTO delivery_lines(id,delivery_record_id,material_name,unit,qty,unit_price,amount) VALUES(?,?,\'材料\',\'吨\',2,10,20)', [`line-${id}`, id])
      }
      await db.execute('INSERT INTO delivery_lines(id,delivery_record_id,material_name,unit,qty,unit_price,amount,deleted_at) VALUES(\'line-old\',\'one\',\'材料\',\'吨\',1,10,10,\'2026-09-10\')')
      for (const id of ['one', 'two']) {
        await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category) VALUES(?,\'delivery_record\',?,\'原件.pdf\',?,\'application/pdf\',\'source\')', [`file-${id}`, id, atob(payload).length])
        await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,\'base64\',?)', [`file-${id}`, payload])
      }
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,deleted_at) VALUES(\'retired-source\',\'delivery_record\',\'one\',\'旧原件.pdf\',?,\'application/pdf\',\'source\',\'2026-09-10 01:02:03\')', [atob(payload).length])
      await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'retired-source\',\'base64\',?)', [payload])
      await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data,operator) VALUES(\'old-log\',\'delivery_records\',\'one\',\'update\',\'not-json\',\'{}\',\'旧操作者\')')
      const rows = await db.select<Record<string, unknown>>(DELIVERY_RECORD_SOURCE_SQL)
      const entities = await deliveryRecordSourceEntities(rows)
      expect(entities).toHaveLength(3)
      const one = entities.find(entity => entity.legacyId === 'one')!
      const two = entities.find(entity => entity.legacyId === 'two')!
      expect(one).toMatchObject({ references: { projectId: 'p-old', supplierId: 's-old' }, quantity: 2, amount: '20.00', attributes: { printDisposition: 'printed', sourceState: 'available', sourceProblem: null } })
      const asset = JSON.parse(String(one.attributes?.assetJson))
      expect(asset).toMatchObject({ payloadBase64: payload, legacyFileRefIds: ['file-one', 'file-two'] })
      expect(JSON.parse(String(two.attributes?.assetJson)).id).toBe(asset.id)
      expect(JSON.parse(String(one.attributes?.allLinesJson))).toHaveLength(2)
      expect(JSON.parse(String(one.attributes?.auditJson))).toContainEqual(expect.objectContaining({ beforeData: 'not-json', operator: '旧操作者' }))
      expect(JSON.parse(String(one.attributes?.legacyOriginalsJson))).toEqual([expect.objectContaining({ legacyFileRefId: 'retired-source', recordId: 'one', asset: expect.objectContaining({ payloadBase64: payload }) })])
      expect(entities.find(entity => entity.legacyId === 'missing')?.attributes?.sourceState).toBe('missing')
      expect(await deliveryRecordSourceEntities([...rows].reverse())).toEqual(entities)
    }
    finally {
      db.close()
    }
  })

  it('批次冲突和非法正文形成明确来源问题，预检仍能统计原记录', async () => {
    const rows = ['one', 'two'].map((id, index) => ({ id, project_id: 'p-old', supplier_id: 's-old', print_batch_id: 'shared', lines_json: '[]', audit_json: '[]', sources_json: JSON.stringify([{ id: `file-${id}`, recordId: id, ownerType: 'delivery_record', category: 'source', fileName: 'same.pdf', mimeType: 'application/pdf', fileSize: atob(payload).length, encoding: 'base64', payloadBase64: index === 0 ? payload : btoa('different') }]) }))
    const result = await deliveryRecordSourceEntities(rows)
    expect(result).toHaveLength(2)
    expect(result.every(entity => !!entity.attributes?.sourceProblem)).toBe(true)
    expect(result.every(entity => entity.attributes?.assetJson === 'null')).toBe(true)
  })
})
