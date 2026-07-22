import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { softDelete } from '~/lib/db/soft-delete'
import {
  loadQuantityCompletionWorkspace,
  loadQuantityPhotoDataUrl,
  persistQuantityStageCompletion,
} from '~/lib/quantity/completion'
import { useQuantityStore } from '~/stores/quantity'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work(mem)
      await mem.execute('COMMIT')
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name, code) VALUES
    ('p1', '项目一', 'P1'),
    ('p2', '项目二', 'P2')`)
  await mem.execute(`INSERT INTO buildings (id, project_id, code, name, sort_order) VALUES
    ('b1', 'p1', '1', '1栋', 10),
    ('b2', 'p2', '2', '2栋', 10)`)
  await mem.execute(`INSERT INTO floors (id, building_id, code, name, sort_order) VALUES
    ('f1', 'b1', '1', '1层', 10),
    ('f2', 'b2', '1', '1层', 10)`)
  await mem.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('t1', 'p1', 'A', 'A户型'),
    ('t2', 'p2', 'B', '外项目户型')`)
  await mem.execute(`INSERT INTO rooms (id, template_id, code, name, kind, sort_order) VALUES
    ('r1', 't1', 'living', '客餐厅', 'room', 10),
    ('r2', 't2', 'other', '外项目房间', 'room', 10)`)
  await mem.execute(`INSERT INTO items (id, project_id, code, name, trade, unit, sort_order) VALUES
    ('i-putty', 'p1', 'putty', '墙面腻子', '油工', '㎡', 10),
    ('i-wall', 'p1', 'wall', '墙砖', '泥水工', '㎡', 20),
    ('i-floor', 'p1', 'floor', '地砖', '泥水工', '㎡', 21),
    ('i-ceiling', 'p1', 'ceiling', '吊顶', '泥水工', '㎡', 22),
    ('i-other', 'p2', 'other', '外项目分项', '泥水工', '㎡', 10)`)
  await mem.execute(`INSERT INTO house_type_template_items
    (id, room_id, item_id, recognized_contract_qty, contract_qty, provisional_qty, field_formula, field_qty, sort_order) VALUES
    ('line-putty', 'r1', 'i-putty', 40, 42, 44, '6×7', 42, 10),
    ('line-wall', 'r1', 'i-wall', 20, 21, 22, '3×7', 21, 20),
    ('line-floor', 'r1', 'i-floor', 11, 12, 13, '3×4', 12, 21),
    ('line-other', 'r2', 'i-other', 8, 8, 9, '', 8, 10)`)
  await mem.execute(`INSERT INTO units
    (id, floor_id, house_type_template_id, code, name, sort_order) VALUES
    ('u1', 'f1', 't1', '01', '101户', 10),
    ('u2', 'f2', 't2', '01', '外项目101户', 10)`)
  await mem.execute(`INSERT INTO construction_stages
    (id, project_id, code, name, trade, completion_mode, sort_order) VALUES
    ('s-putty-1', 'p1', 'putty-1', '一遍腻子', '油工', 'unit', 10),
    ('s-putty-2', 'p1', 'putty-2', '二遍腻子', '油工', 'unit', 11),
    ('s-wall', 'p1', 'wall', '墙砖铺贴', '泥水工', 'unit', 20),
    ('s-floor', 'p1', 'floor', '地砖铺贴', '泥水工', 'unit', 21),
    ('s-ceiling', 'p1', 'ceiling', '吊顶施工', '泥水工', 'unit', 22),
    ('s-manual', 'p1', 'manual', '人工进度', '其他', 'manual', 30),
    ('s-other', 'p2', 'other', '外项目阶段', '泥水工', 'unit', 10)`)
  await mem.execute(`INSERT INTO construction_stage_items (id, stage_id, item_id) VALUES
    ('map-putty-1', 's-putty-1', 'i-putty'),
    ('map-putty-2', 's-putty-2', 'i-putty'),
    ('map-wall', 's-wall', 'i-wall'),
    ('map-floor', 's-floor', 'i-floor'),
    ('map-ceiling', 's-ceiling', 'i-ceiling'),
    ('map-other', 's-other', 'i-other')`)
  await mem.execute(`INSERT INTO crews (id, name, trade) VALUES
    ('crew-paint', '油工一班', '油工'),
    ('crew-masonry', '泥水一班', '泥水工'),
    ('crew-other', '外项目班组', '泥水工')`)
  await mem.execute(`INSERT INTO unit_assignments
    (id, unit_id, trade, crew_id, note) VALUES
    ('a-paint', 'u1', '油工', 'crew-paint', '油工责任'),
    ('a-masonry', 'u1', '泥水工', 'crew-masonry', '泥水责任'),
    ('a-other', 'u2', '泥水工', 'crew-other', '外项目责任')`)
  setActivePinia(createPinia())
})

afterEach(() => mem.close())

function photo(fileName = '验收.jpg') {
  return {
    fileName,
    mimeType: 'image/jpeg',
    fileSize: 3,
    contentBase64: 'AQID',
  }
}

async function draftFor(stageId: string, overrides: Record<string, unknown> = {}) {
  const workspace = await loadQuantityCompletionWorkspace(mem, 'p1', 'u1')
  const stage = workspace.stages.find(candidate => candidate.id === stageId)!
  return {
    projectId: 'p1',
    unitId: 'u1',
    stageId,
    status: 'completed' as const,
    completedAt: '2026-07-20',
    note: `${stage.name}完成`,
    expectedCompletionId: stage.completion?.id ?? null,
    expectedCompletionFingerprint: stage.completion?.fingerprint ?? null,
    expectedAssignmentId: stage.currentAssignment?.id ?? null,
    photos: [photo(`${stageId}.jpg`)],
    allowArchivedEdit: false,
    ...overrides,
  }
}

describe('quantity stage completion：单户×单阶段唯一写路径', () => {
  it('读取当前责任、活链接三量、独立阶段、历史缺证风险与未排期状态', async () => {
    await mem.execute(`INSERT INTO unit_stage_completions
      (id, unit_id, stage_id, assignment_id, status, completed_at)
      VALUES ('done-putty-1', 'u1', 's-putty-1', 'a-paint', 'completed', '2026-07-18')`)
    await mem.execute(`INSERT INTO file_refs
      (id, owner_type, owner_id, file_name, file_size, category, mime_type)
      VALUES ('spoof', 'delivery_record', 'done-putty-1', '伪装照片.jpg', 3, 'acceptance_photo', 'image/jpeg')`)
    await mem.execute(`INSERT INTO file_payloads (file_ref_id, encoding, content)
      VALUES ('spoof', 'base64', 'AQID')`)

    const workspace = await loadQuantityCompletionWorkspace(mem, 'p1', 'u1')

    expect(workspace).toMatchObject({
      projectId: 'p1',
      matrixArchivedAt: null,
      unit: { id: 'u1', name: '101户', floorName: '1层', buildingName: '1栋' },
    })
    expect(workspace.stages.map(stage => stage.id)).toEqual([
      's-putty-1',
      's-putty-2',
      's-wall',
      's-floor',
    ])
    expect(workspace.stages.some(stage => stage.id === 's-manual')).toBe(false)
    expect(workspace.planWindow).toBeNull()
    expect(workspace.stages.find(stage => stage.id === 's-putty-1')).toMatchObject({
      currentAssignment: { id: 'a-paint', assigneeName: '油工一班' },
      quantities: [expect.objectContaining({
        roomName: '客餐厅',
        itemName: '墙面腻子',
        unit: '㎡',
        recognizedContractQty: 40,
        contractQty: 42,
        provisionalQty: 44,
        fieldQty: 42,
      })],
      photos: [],
    })
    expect(workspace.stages.find(stage => stage.id === 's-putty-2')?.warnings).toEqual([
      expect.objectContaining({ code: 'prior-photo-missing', stageId: 's-putty-1' }),
    ])
  })

  it('单户工作区的 planWindow 消费其楼栋所在排程分组计划区间', async () => {
    await mem.execute(`INSERT INTO schedule_groups (id, project_id, name)
      VALUES ('g-plan', 'p1', '户内1栋')`)
    await mem.execute(`INSERT INTO schedule_group_buildings (id, group_id, building_id)
      VALUES ('gb-plan', 'g-plan', 'b1')`)
    await mem.execute(`INSERT INTO schedule_tasks
      (id, project_id, group_id, name, duration_days, planned_start, planned_finish, has_qty, manual_progress, sort_order) VALUES
      ('task-plan-1', 'p1', 'g-plan', '放线', 10, '2026-07-01', '2026-07-10', 0, 0.5, 10),
      ('task-plan-2', 'p1', 'g-plan', '保洁', 8, '2026-08-01', '2026-08-08', 0, 0, 20)`)

    const workspace = await loadQuantityCompletionWorkspace(mem, 'p1', 'u1')

    expect(workspace.planWindow).toEqual({
      plannedStartAt: '2026-07-01',
      plannedEndAt: '2026-08-08',
    })
  })

  it('模板没有可见量明细的阶段不进入单户登记且不可写入', async () => {
    const workspace = await loadQuantityCompletionWorkspace(mem, 'p1', 'u1')
    expect(workspace.stages.some(stage => stage.id === 's-ceiling')).toBe(false)

    await expect(persistQuantityStageCompletion(mem, {
      projectId: 'p1',
      unitId: 'u1',
      stageId: 's-ceiling',
      status: 'completed',
      completedAt: '2026-07-20',
      note: '不应写入',
      expectedCompletionId: null,
      expectedCompletionFingerprint: null,
      expectedAssignmentId: 'a-masonry',
      photos: [photo('吊顶.jpg')],
      allowArchivedEdit: false,
    })).rejects.toThrow('不属于当前项目或不支持按户完成')
  })

  it('有照片时原子写完成事实、附件正文和逐记录日志，并刷新矩阵', async () => {
    const store = useQuantityStore()
    await store.loadProject('p1')
    await store.loadCompletion('p1', 'u1')
    const stage = store.completionWorkspace!.stages.find(candidate => candidate.id === 's-wall')!

    const result = await store.saveCompletion({
      projectId: 'p1',
      unitId: 'u1',
      stageId: 's-wall',
      status: 'completed',
      completedAt: '2026-07-20',
      note: '墙砖验收完成',
      expectedCompletionId: null,
      expectedCompletionFingerprint: null,
      expectedAssignmentId: stage.currentAssignment?.id ?? null,
      photos: [photo()],
      allowArchivedEdit: false,
    })

    expect(result).toMatchObject({ status: 'completed', created: true, changed: true })
    expect(result.photoIds).toHaveLength(1)
    expect(await mem.select(
      `SELECT unit_id, stage_id, assignment_id, status, completed_at, note
       FROM unit_stage_completions WHERE id = ?`,
      [result.completionId],
    )).toEqual([{
      unit_id: 'u1',
      stage_id: 's-wall',
      assignment_id: 'a-masonry',
      status: 'completed',
      completed_at: '2026-07-20',
      note: '墙砖验收完成',
    }])
    expect(await mem.select(
      `SELECT owner_type, owner_id, category, file_name, mime_type
       FROM file_refs WHERE id = ?`,
      [result.photoIds[0]],
    )).toEqual([{
      owner_type: 'unit_stage_completion',
      owner_id: result.completionId,
      category: 'acceptance_photo',
      file_name: '验收.jpg',
      mime_type: 'image/jpeg',
    }])
    expect(await mem.select('SELECT encoding, content FROM file_payloads WHERE file_ref_id = ?', [result.photoIds[0]]))
      .toEqual([{ encoding: 'base64', content: 'AQID' }])
    expect(await mem.select<{ table_name: string, action: string }>(
      `SELECT table_name, action FROM operation_logs ORDER BY rowid`,
    )).toEqual([
      { table_name: 'unit_stage_completions', action: 'create' },
      { table_name: 'file_refs', action: 'create' },
    ])
    expect(store.completionWorkspace?.stages.find(candidate => candidate.id === 's-wall')?.photos).toHaveLength(1)
    expect(store.snapshot?.completions.find(candidate => candidate.stageId === 's-wall')).toMatchObject({
      status: 'completed',
      completedAt: '2026-07-20',
    })
  })

  it('缺照片不能完成，但可按原日期和备注保存草稿；较早阶段异常不硬锁后续完成', async () => {
    const missingPhoto = await draftFor('s-putty-1', { photos: [] })
    await expect(persistQuantityStageCompletion(mem, missingPhoto)).rejects.toThrow('缺少验收照片')
    expect(await mem.select('SELECT id FROM unit_stage_completions')).toEqual([])

    const draft = await persistQuantityStageCompletion(mem, {
      ...missingPhoto,
      status: 'draft',
      note: '等现场补照片',
    })
    expect(draft.status).toBe('draft')
    expect(await mem.select(
      `SELECT status, completed_at, note FROM unit_stage_completions WHERE id = ?`,
      [draft.completionId],
    )).toEqual([{ status: 'draft', completed_at: '2026-07-20', note: '等现场补照片' }])

    const later = await persistQuantityStageCompletion(mem, await draftFor('s-putty-2'))
    expect(later.status).toBe('completed')
    expect(await mem.select<{ stage_id: string, status: string }>(
      `SELECT stage_id, status FROM unit_stage_completions ORDER BY stage_id`,
    )).toEqual([
      { stage_id: 's-putty-1', status: 'draft' },
      { stage_id: 's-putty-2', status: 'completed' },
    ])
  })

  it('墙砖/地砖与一遍/二遍腻子分别落事实和日期，编辑任一阶段不覆盖其他阶段', async () => {
    const stages = [
      ['s-putty-1', '2026-07-11'],
      ['s-putty-2', '2026-07-12'],
      ['s-wall', '2026-07-13'],
      ['s-floor', '2026-07-14'],
    ] as const
    for (const [stageId, completedAt] of stages)
      await persistQuantityStageCompletion(mem, await draftFor(stageId, { completedAt }))

    const wallDraft = await draftFor('s-wall', { completedAt: '2026-07-19', note: '仅修正墙砖日期' })
    await persistQuantityStageCompletion(mem, wallDraft)

    expect(await mem.select(
      `SELECT stage_id, status, completed_at FROM unit_stage_completions
       WHERE unit_id = 'u1' AND deleted_at IS NULL ORDER BY stage_id`,
    )).toEqual([
      { stage_id: 's-floor', status: 'completed', completed_at: '2026-07-14' },
      { stage_id: 's-putty-1', status: 'completed', completed_at: '2026-07-11' },
      { stage_id: 's-putty-2', status: 'completed', completed_at: '2026-07-12' },
      { stage_id: 's-wall', status: 'completed', completed_at: '2026-07-19' },
    ])
  })

  it('责任替换后修正已完成事实仍冻结完成时责任', async () => {
    const result = await persistQuantityStageCompletion(mem, await draftFor('s-wall'))
    await softDelete(mem, 'unit_assignments', 'a-masonry')
    await mem.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-masonry-new', '泥水二班', '泥水工')`)
    await mem.execute(`INSERT INTO unit_assignments
      (id, unit_id, trade, crew_id, note) VALUES
      ('a-masonry-new', 'u1', '泥水工', 'crew-masonry-new', '现责任')`)

    const workspace = await loadQuantityCompletionWorkspace(mem, 'p1', 'u1')
    const stage = workspace.stages.find(candidate => candidate.id === 's-wall')!
    await persistQuantityStageCompletion(mem, {
      projectId: 'p1',
      unitId: 'u1',
      stageId: 's-wall',
      status: 'completed',
      completedAt: '2026-07-21',
      note: '只修正日期和备注',
      expectedCompletionId: stage.completion?.id ?? null,
      expectedCompletionFingerprint: stage.completion?.fingerprint ?? null,
      expectedAssignmentId: stage.currentAssignment?.id ?? null,
      photos: [],
      allowArchivedEdit: false,
    })

    expect(await mem.select(
      `SELECT assignment_id, completed_at, note FROM unit_stage_completions WHERE id = ?`,
      [result.completionId],
    )).toEqual([{
      assignment_id: 'a-masonry',
      completed_at: '2026-07-21',
      note: '只修正日期和备注',
    }])
  })

  it('照片正文按可见 file_ref 惰性读取为 data URL，软删照片拒绝提供正文', async () => {
    const result = await persistQuantityStageCompletion(mem, await draftFor('s-wall'))
    const photoId = result.photoIds[0]!

    await expect(loadQuantityPhotoDataUrl(mem, photoId)).resolves.toBe('data:image/jpeg;base64,AQID')

    await softDelete(mem, 'file_refs', photoId)
    await expect(loadQuantityPhotoDataUrl(mem, photoId)).rejects.toThrow('不存在或已删除')
  })

  it('照片只随可见完成事实读取，责任软删不吞历史，完成事实隐藏后照片不可见', async () => {
    const result = await persistQuantityStageCompletion(mem, await draftFor('s-wall'))
    await softDelete(mem, 'unit_assignments', 'a-masonry')

    let workspace = await loadQuantityCompletionWorkspace(mem, 'p1', 'u1')
    expect(workspace.stages.find(stage => stage.id === 's-wall')).toMatchObject({
      currentAssignment: null,
      completion: { executionAssigneeName: '泥水一班' },
      photos: [expect.objectContaining({ id: result.photoIds[0], fileName: 's-wall.jpg' })],
    })

    await softDelete(mem, 'unit_stage_completions', result.completionId)
    workspace = await loadQuantityCompletionWorkspace(mem, 'p1', 'u1')
    expect(workspace.stages.find(stage => stage.id === 's-wall')).toMatchObject({
      completion: null,
      photos: [],
    })
    await expect(loadQuantityPhotoDataUrl(mem, result.photoIds[0]!)).rejects.toThrow('不存在或已删除')
  })

  it('完成事实的业务祖先隐藏后照片正文不可读取', async () => {
    const result = await persistQuantityStageCompletion(mem, await draftFor('s-wall'))

    await softDelete(mem, 'units', 'u1')

    await expect(loadQuantityPhotoDataUrl(mem, result.photoIds[0]!)).rejects.toThrow('不存在或已删除')
  })

  it('expected completion/assignment 防并发覆盖，归档修改必须显式授权且跨项目阶段拒绝', async () => {
    const stale = await draftFor('s-floor')
    await persistQuantityStageCompletion(mem, stale)
    await expect(persistQuantityStageCompletion(mem, stale)).rejects.toThrow('完成事实已发生变化')

    const current = await draftFor('s-floor', { note: '归档后修正' })
    await mem.execute(`UPDATE projects SET matrix_archived_at = '2026-07-20' WHERE id = 'p1'`)
    await expect(persistQuantityStageCompletion(mem, current)).rejects.toThrow('已归档')
    const archivedResult = await persistQuantityStageCompletion(mem, { ...current, allowArchivedEdit: true })
    expect(archivedResult.changed).toBe(true)

    await expect(persistQuantityStageCompletion(mem, {
      ...await draftFor('s-wall'),
      stageId: 's-other',
    })).rejects.toThrow('不属于当前项目')
  })
})
