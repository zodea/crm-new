import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  confirmQuantityRegionLeave,
  loadQuantityRegionWorkspace,
  persistQuantityBuilding,
  persistQuantityFloor,
  persistQuantityUnit,
} from '~/lib/quantity/region'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await db.execute(`INSERT INTO projects (id, name, code) VALUES
    ('p1', '项目一', 'P1'),
    ('p2', '项目二', 'P2')`)
  await db.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('t1', 'p1', 'A', 'A户型'),
    ('t2', 'p2', 'B', '外项目户型')`)
})

afterEach(() => db.close())

describe('工程量项目区域配置', () => {
  it('仅在存在未提交输入时通过 KitUI 确认离开', async () => {
    let calls = 0
    const confirm = async () => {
      calls += 1
      return false
    }

    await expect(confirmQuantityRegionLeave(false, confirm)).resolves.toBe(true)
    await expect(confirmQuantityRegionLeave(true, confirm)).resolves.toBe(false)
    expect(calls).toBe(1)
  })

  it('无合同时可依次建立楼栋、楼层、户并挂靠本项目户型', async () => {
    const buildingId = await persistQuantityBuilding(db, 'p1', { code: '1', name: '1栋' })
    const floorId = await persistQuantityFloor(db, 'p1', buildingId, { code: '1F', name: '1层' })
    const unitId = await persistQuantityUnit(db, 'p1', floorId, {
      code: '101',
      name: '101户',
      templateId: 't1',
    })

    const workspace = await loadQuantityRegionWorkspace(db, 'p1')
    expect(workspace.buildings).toEqual([
      expect.objectContaining({ id: buildingId, code: '1', name: '1栋' }),
    ])
    expect(workspace.floors).toEqual([
      expect.objectContaining({ id: floorId, buildingId, code: '1F' }),
    ])
    expect(workspace.units).toEqual([
      expect.objectContaining({ id: unitId, floorId, templateId: 't1', code: '101' }),
    ])
    expect(await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM operation_logs
       WHERE action = 'create' AND table_name IN ('buildings', 'floors', 'units')`,
    )).toEqual([{ n: 3 }])
  })

  it('拒绝跨项目楼栋、户型模板与重复同级编码', async () => {
    const p1Building = await persistQuantityBuilding(db, 'p1', { code: '1', name: '1栋' })
    const p1Floor = await persistQuantityFloor(db, 'p1', p1Building, { code: '1F', name: '1层' })
    const p2Building = await persistQuantityBuilding(db, 'p2', { code: '1', name: '项目二1栋' })

    await expect(persistQuantityFloor(db, 'p1', p2Building, {
      code: '2F',
      name: '2层',
    })).rejects.toThrow('不属于当前项目')
    await expect(persistQuantityUnit(db, 'p1', p1Floor, {
      code: '101',
      name: '101户',
      templateId: 't2',
    })).rejects.toThrow('户型模板不属于当前项目')
    await expect(persistQuantityBuilding(db, 'p1', {
      code: '1',
      name: '重复楼栋',
    })).rejects.toThrow('已存在')
  })

  it('矩阵归档后拒绝继续新增区域', async () => {
    await db.execute(`UPDATE projects SET matrix_archived_at = '2026-07-29T00:00:00.000Z' WHERE id = 'p1'`)

    await expect(persistQuantityBuilding(db, 'p1', {
      code: '1',
      name: '1栋',
    })).rejects.toThrow('已归档')
  })
})
