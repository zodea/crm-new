import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  createScheduleProcessLibraryVersion,
  loadScheduleProcessLibraryDetail,
} from '~/lib/schedule/process-library'
import { createMemoryDb } from '../helpers/memory-db'

describe('标准工序库版本维护', () => {
  let db: TestDb

  beforeEach(async () => {
    db = await createMemoryDb()
    await runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('从已被排程引用的版本复制保存为新版本，不改写旧版快照来源', async () => {
    const source = await loadScheduleProcessLibraryDetail(
      db,
      'schedule_process_library_decoration_v1',
    )
    expect(source?.tasks[1]?.predecessorKey).toBe(source?.tasks[0]?.key)

    await db.execute(`INSERT INTO projects (id, name) VALUES ('project-1', '版本项目')`)
    await db.execute(`
      INSERT INTO schedule_groups
        (id, project_id, scope_basis, process_library_id,
         process_library_name_snapshot, process_library_version_snapshot, name)
      VALUES ('group-1', 'project-1', 'provisional', ?, ?, ?, '引用旧版')
    `, [source!.id, source!.name, source!.version])

    const created = await createScheduleProcessLibraryVersion(db, {
      sourceLibraryId: source!.id,
      code: source!.code,
      name: source!.name,
      description: '现场调整版',
      tasks: source!.tasks.map((task, index) => ({
        key: task.key,
        name: index === 0 ? '放线及新建墙体（修订）' : task.name,
        trade: task.trade,
        color: task.color,
        durationDays: task.durationDays,
        stageCode: task.stageCode ?? '',
        itemCodes: task.itemCodes,
        predecessorKey: task.predecessorKey,
        predecessorDisabled: task.predecessorDisabled,
      })),
    })

    expect(created.version).toBe(2)
    expect(created.tasks[0]?.name).toBe('放线及新建墙体（修订）')
    expect(created.tasks[1]?.predecessorKey).toBe(created.tasks[0]?.key)
    expect(created.usageCount).toBe(0)

    const oldVersion = await loadScheduleProcessLibraryDetail(db, source!.id)
    expect(oldVersion?.version).toBe(1)
    expect(oldVersion?.tasks[0]?.name).toBe('放线及新建墙体')
    expect(oldVersion?.usageCount).toBe(1)
  })

  it('基于旧版只能保存为同一工序库编码的下一版本', async () => {
    const source = await loadScheduleProcessLibraryDetail(
      db,
      'schedule_process_library_decoration_v1',
    )
    await expect(createScheduleProcessLibraryVersion(db, {
      sourceLibraryId: source!.id,
      code: 'another-library',
      name: source!.name,
      description: '',
      tasks: source!.tasks,
    })).rejects.toThrow('不能修改工序库编码')
  })

  it('保存被置灰的前置关系时保留来源 key 和禁用状态', async () => {
    const created = await createScheduleProcessLibraryVersion(db, {
      sourceLibraryId: null,
      code: 'disabled-dependency',
      name: '置灰关系',
      description: '',
      tasks: [
        {
          key: 'successor',
          name: '后续工序',
          trade: '木工',
          color: '#64748b',
          durationDays: 2,
          stageCode: '',
          itemCodes: [],
          predecessorKey: 'predecessor',
          predecessorDisabled: true,
        },
        {
          key: 'predecessor',
          name: '原前置工序',
          trade: '泥水工',
          color: '#64748b',
          durationDays: 2,
          stageCode: '',
          itemCodes: [],
          predecessorKey: null,
        },
      ],
    })

    expect(created.tasks[0]).toMatchObject({
      predecessorKey: 'predecessor',
      predecessorDisabled: true,
    })
  })

  it('拒绝不存在、同位或晚于当前工序的前置关系', async () => {
    await expect(createScheduleProcessLibraryVersion(db, {
      sourceLibraryId: null,
      code: 'invalid-order',
      name: '错误顺序',
      description: '',
      tasks: [
        {
          key: 'first',
          name: '第一道',
          trade: '泥水工',
          color: '#64748b',
          durationDays: 2,
          stageCode: '',
          itemCodes: [],
          predecessorKey: 'second',
        },
        {
          key: 'second',
          name: '第二道',
          trade: '木工',
          color: '#64748b',
          durationDays: 2,
          stageCode: '',
          itemCodes: [],
          predecessorKey: null,
        },
      ],
    })).rejects.toThrow('前置工序必须排在当前工序之前')
  })
})
