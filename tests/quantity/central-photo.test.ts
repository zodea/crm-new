import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { readQuantityCentralPhoto, validateQuantityPhoto } from '~/lib/quantity/central-photo'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let memory: TestDb
const query = { projectId: 'project', unitId: 'unit', completionId: 'done', photoId: 'photo' }
const photo = { fileName: '验收照片.png', mimeType: 'image/png', fileSize: 3, contentBase64: 'AQID' }

beforeEach(async () => {
  memory = await createMigratedMemoryDb()
  await memory.execute('INSERT INTO projects (id, name) VALUES (\'project\', \'中央项目\'), (\'other\', \'外项目\')')
  await memory.execute('INSERT INTO buildings (id, project_id, code, name) VALUES (\'building\', \'project\', \'B\', \'1栋\')')
  await memory.execute('INSERT INTO floors (id, building_id, code, name) VALUES (\'floor\', \'building\', \'F\', \'1层\')')
  await memory.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (\'template\', \'project\', \'A\', \'A户型\')')
  await memory.execute('INSERT INTO units (id, floor_id, house_type_template_id, code) VALUES (\'unit\', \'floor\', \'template\', \'101\')')
  await memory.execute('INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES (\'stage\', \'project\', \'S\', \'验收\', \'泥水工\')')
  await memory.execute('INSERT INTO unit_stage_completions (id, unit_id, stage_id, status) VALUES (\'done\', \'unit\', \'stage\', \'draft\')')
  await memory.execute('INSERT INTO file_refs (id, owner_type, owner_id, file_name, mime_type, file_size, category) VALUES (\'photo\', \'unit_stage_completion\', \'done\', ?, ?, ?, \'acceptance_photo\')', [photo.fileName, photo.mimeType, photo.fileSize])
  await memory.execute('INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES (\'photo\', \'base64\', ?)', [photo.contentBase64])
})
afterEach(() => memory.close())

it.each(([{ ...photo, fileSize: 4 }, { ...photo, contentBase64: 'AQI=' }, { ...photo, contentBase64: 'AQI#' }, { ...photo, mimeType: 'text/html' }]).map(input => ({ input })))('验收照片的编码、实际长度及图片类型都要验证，拒绝伪造元数据：输入案例 %#', ({ input: invalid }) => {
  expect(validateQuantityPhoto(photo)).toEqual(new Uint8Array([1, 2, 3]))
  expect(() => validateQuantityPhoto(invalid)).toThrow()
})

it('照片只按当前项目、户和阶段完成的稳定身份返回，并给出可独立校验的 SHA-256', async () => {
  expect(await readQuantityCentralPhoto(memory, query)).toMatchObject({ ...query, ...photo, sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' })
  await memory.execute('UPDATE buildings SET deleted_at = \'2026-09-11\' WHERE id = \'building\'')
  await expect(readQuantityCentralPhoto(memory, query)).rejects.toMatchObject({ problem: { code: 'not-found' } })
})

it.each(Array.from([{ ...query, projectId: 'other' }, { ...query, unitId: 'other-unit' }, { ...query, completionId: 'other-done' }]).map(input => ({ input })))('照片只按当前项目、户和阶段完成的稳定身份返回，并给出可独立校验的 SHA-256：输入组合 1 案例 %#', async ({ input: wrong }) => {
  expect(await readQuantityCentralPhoto(memory, query)).toMatchObject({ ...query, ...photo, sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' })
  await expect(readQuantityCentralPhoto(memory, wrong)).rejects.toMatchObject({ problem: { code: 'not-found' } })
})

it('历史照片没有正文或保存后长度不符时明确拒绝，不能把文件名伪装为可预览原件', async () => {
  await memory.execute('UPDATE file_payloads SET content = \'AQI=\' WHERE file_ref_id = \'photo\'')
  await expect(readQuantityCentralPhoto(memory, query)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  await memory.execute('DELETE FROM file_payloads WHERE file_ref_id = \'photo\'')
  await expect(readQuantityCentralPhoto(memory, query)).rejects.toMatchObject({ problem: { code: 'not-found', message: expect.stringContaining('正文') } })
})
