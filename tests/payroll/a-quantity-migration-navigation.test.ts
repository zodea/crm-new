import { beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { payrollSourceContext } from '~/lib/payroll/a-navigation'
import { mapQuantityMigrationGraph } from '~/lib/quantity/migration-mapping'
import { readQuantityMigrationGraphs } from '~/lib/quantity/migration-source'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { createMemoryDb } from '../helpers/memory-db'

interface MappedSource { unitId: string, stageId: string, itemId: string, completionId: string }
const back = '/subcontract/payroll/config?origin=real&project=project-a&month=2026-09&leader=manager&managementBookId=book-a&focus=fee-a'
let mapped: MappedSource

/** 旧身份先通过真实 SQLite 和完整量域关系校验，再使用生产迁移映射。 */
async function migratedSource(): Promise<MappedSource> {
  const db = await createMemoryDb()
  try {
    await runMigrations(db)
    const seeds: Array<[string, (string | number)[]]> = [
      ['INSERT INTO projects (id,name) VALUES (?,?)', ['p', '量项目']],
      ['INSERT INTO buildings (id,project_id,code,name) VALUES (?,?,?,?)', ['b', 'p', 'B', '栋']],
      ['INSERT INTO floors (id,building_id,code,name) VALUES (?,?,?,?)', ['f', 'b', 'F', '层']],
      ['INSERT INTO house_type_templates (id,project_id,code,name) VALUES (?,?,?,?)', ['t', 'p', 'T', '户型']],
      ['INSERT INTO units (id,floor_id,house_type_template_id,code) VALUES (?,?,?,?)', ['一单元101', 'f', 't', '101']],
      ['INSERT INTO rooms (id,template_id,code,name) VALUES (?,?,?,?)', ['r', 't', 'R', '客厅']],
      ['INSERT INTO items (id,project_id,code,name,trade) VALUES (?,?,?,?,?)', ['墙面/粉刷', 'p', 'I', '粉刷', '油漆工']],
      ['INSERT INTO house_type_template_items (id,room_id,item_id,contract_qty) VALUES (?,?,?,?)', ['l', 'r', '墙面/粉刷', 8]],
      ['INSERT INTO construction_stages (id,project_id,code,name,trade) VALUES (?,?,?,?,?)', ['工序一', 'p', 'S', '粉刷', '油漆工']],
      ['INSERT INTO construction_stage_items (id,stage_id,item_id,is_reporting_stage) VALUES (?,?,?,?)', ['si', '工序一', '墙面/粉刷', 1]],
      ['INSERT INTO crews (id,name,trade) VALUES (?,?,?)', ['crew', '班组', '油漆工']],
      ['INSERT INTO unit_assignments (id,unit_id,trade,crew_id) VALUES (?,?,?,?)', ['assignment', '一单元101', '油漆工', 'crew']],
      ['INSERT INTO unit_assignment_scopes (id,assignment_id,room_id,item_id) VALUES (?,?,?,?)', ['scope', 'assignment', 'r', '墙面/粉刷']],
      ['INSERT INTO unit_stage_completions (id,unit_id,stage_id,assignment_id,status,completed_at) VALUES (?,?,?,?,?,?)', ['完成记录#1', '一单元101', '工序一', 'assignment', 'completed', '2026-09-01']],
    ]
    for (const [sql, params] of seeds) await db.execute(sql, params)
    const source = (await readQuantityMigrationGraphs(db))[0]!.graph
    const { graph } = mapQuantityMigrationGraph(source, {
      namespace: 'core-quantity_projects-0123456789abcdef01234567',
      projectId: 'project-a',
      crews: new Map([['crew', 'crew-a']]),
      workers: new Map(),
      boqLineIds: new Set(),
    })
    return {
      unitId: String(graph.tables.units[0]!.id),
      stageId: String(graph.tables.construction_stages[0]!.id),
      itemId: String(graph.tables.items[0]!.id),
      completionId: String(graph.tables.unit_stage_completions[0]!.id),
    }
  }
  finally { db.close() }
}

function sourceTarget(unitId: string, filters: Partial<Omit<MappedSource, 'unitId'>> = {}): URL {
  const result = resolveNavigationTarget({
    kind: 'entity-detail',
    subject: { state: 'resolved', entity: 'quantity-unit', id: unitId, label: '101', no: null },
    variant: 'detail',
    view: null,
    filters: { projectId: 'project-a', dataOrigin: 'real', ...filters },
  }, { returnTo: back })
  if (result.state !== 'resolved')
    throw new Error('真实原量来源应有可达路径')
  return new URL(result.to, 'https://test.invalid')
}

describe('迁入编码量身份的工资来源往返', () => {
  beforeAll(async () => {
    mapped = await migratedSource()
  })

  it('中文旧户映射后可按同一稳定身份返回原费用配置及费用行', () => {
    const url = sourceTarget(mapped.unitId)
    expect(decodeURIComponent(url.pathname.split('/').at(-1)!)).toBe(mapped.unitId)
    expect(payrollSourceContext(Object.fromEntries(url.searchParams), { kind: 'quantity-unit', id: mapped.unitId, projectId: 'project-a', origin: 'real' })).toMatchObject({
      returnTo: back,
      id: mapped.unitId,
      configScope: { projectId: 'project-a', month: '2026-09', leaderWorkerId: 'manager', crewId: null, book: { bookPurpose: 'management', managementBookId: 'book-a' } },
    })
  })

  it('迁入后的工序、分项及完成记录焦点完整保留，不退回整户无焦点', () => {
    const url = sourceTarget(mapped.unitId, mapped)
    expect(Object.fromEntries(['stageId', 'itemId', 'completionId'].map(key => [key, url.searchParams.get(key)]))).toEqual({
      stageId: mapped.stageId,
      itemId: mapped.itemId,
      completionId: mapped.completionId,
    })
  })

  it('冷恢复保留迁入户和三处原量焦点、原费用配置范围，配置本身仍不恢复', () => {
    const url = sourceTarget(mapped.unitId, mapped)
    const restored = inspectRestorableTabPath(`${url.pathname}${url.search}`)
    expect(restored).not.toBeNull()
    const restoredUrl = new URL(restored!.fullPath, 'https://test.invalid')
    expect(decodeURIComponent(restoredUrl.pathname.split('/').at(-1)!)).toBe(mapped.unitId)
    expect(restoredUrl.searchParams.get('payrollReturnTo')).toBe(back)
    expect(payrollSourceContext(Object.fromEntries(restoredUrl.searchParams), { kind: 'quantity-unit', id: mapped.unitId, projectId: 'project-a', origin: 'real' })?.configScope?.book.managementBookId).toBe('book-a')
    expect(inspectRestorableTabPath(back)).toBeNull()
  })

  it.each(Array.from(['stageId', 'itemId', 'completionId'] as const).map(input => ({ input })))('冷恢复保留迁入户和三处原量焦点、原费用配置范围，配置本身仍不恢复：输入组合 1 案例 %#', ({ input: key }) => {
    const url = sourceTarget(mapped.unitId, mapped)
    const restored = inspectRestorableTabPath(`${url.pathname}${url.search}`)
    expect(restored).not.toBeNull()
    const restoredUrl = new URL(restored!.fullPath, 'https://test.invalid')
    expect(decodeURIComponent(restoredUrl.pathname.split('/').at(-1)!)).toBe(mapped.unitId)
    expect(restoredUrl.searchParams.get(key)).toBe(mapped[key])
  })

  function createPayrollSourceContextFixture() {
    const url = sourceTarget(mapped.unitId)
    const query = Object.fromEntries(url.searchParams)
    expect(inspectRestorableTabPath(`/base/worker/${encodeURIComponent(mapped.unitId)}?origin=real`)).toBeNull()
    return { url, query }
  }

  it('编码扩展不接受错表、非迁入百分号或坏编码，也不扩展其他主体', () => {
    expect(inspectRestorableTabPath(`/base/worker/${encodeURIComponent(mapped.unitId)}?origin=real`)).toBeNull()
  })

  it.each([
    { case: 'query / { kind: \'quantity-unit\', id: mapped.unitId, projectId: \'other-project\', origin: \'real\' }', prepare: ({ query }: Awaited<ReturnType<typeof createPayrollSourceContextFixture>>) => {
      return { input: query, argument2: { kind: 'quantity-unit', id: mapped.unitId, projectId: 'other-project', origin: 'real' } } as const
    } },
    { case: 'query / { kind: \'quantity-unit\', id: mapped.unitId, projectId: \'project-a\', origin: \'demo\' }', prepare: ({ query }: Awaited<ReturnType<typeof createPayrollSourceContextFixture>>) => {
      return { input: query, argument2: { kind: 'quantity-unit', id: mapped.unitId, projectId: 'project-a', origin: 'demo' } } as const
    } },
  ])('编码扩展不接受错表、非迁入百分号或坏编码，也不扩展其他主体 / payrollSourceContext：$case', ({ prepare }) => {
    const fixture = createPayrollSourceContextFixture()
    const { input, argument2 } = prepare(fixture)
    expect(payrollSourceContext(input, argument2)).toBeNull()
  })

  it.each([
    { case: '错表', makeId: (source: MappedSource) => source.itemId },
    { case: '非迁入百分号', makeId: () => 'unit%20a' },
    { case: '假命名空间', makeId: (source: MappedSource) => source.unitId.replace('core-quantity_projects-', 'untrusted-') },
    { case: '非法编码', makeId: (source: MappedSource) => source.unitId.replace(/:units:.+$/, ':units:%ZZ') },
    { case: '非规范编码', makeId: (source: MappedSource) => source.unitId.replace(/:units:.+$/, ':units:%41') },
  ])('编码扩展拒绝 $case', ({ makeId }) => {
    const id = makeId(mapped)
    const url = sourceTarget(id)
    expect(payrollSourceContext(Object.fromEntries(url.searchParams), { kind: 'quantity-unit', id, projectId: 'project-a', origin: 'real' })).toBeNull()
    expect(inspectRestorableTabPath(`${url.pathname}${url.search}`)).toBeNull()
  })

  it.each(Array.from(['worker', 'crew', 'quantity-project'] as const).map(input => ({ input })))('编码扩展不接受错表、非迁入百分号或坏编码，也不扩展其他主体：输入组合 2 案例 %#', ({ input: kind }) => {
    const url = sourceTarget(mapped.unitId)
    const query = Object.fromEntries(url.searchParams)
    expect(payrollSourceContext({ ...query, payrollSourceKind: kind }, { kind, id: mapped.unitId, projectId: 'project-a', origin: 'real' })).toBeNull()
  })

  it('三个焦点仅接受其明确表，冷恢复仍拒绝重复参数并移除未接入的房间焦点', () => {
    const duplicated = sourceTarget(mapped.unitId, mapped)
    duplicated.searchParams.append('stageId', mapped.stageId)
    expect(inspectRestorableTabPath(`${duplicated.pathname}${duplicated.search}`)).toBeNull()
    const extraRoom = sourceTarget(mapped.unitId, mapped)
    extraRoom.searchParams.set('roomId', 'room-a')
    const restored = inspectRestorableTabPath(`${extraRoom.pathname}${extraRoom.search}`)
    expect(restored).not.toBeNull()
    expect(new URL(restored!.fullPath, 'https://test.invalid').searchParams.has('roomId')).toBe(false)
  })

  it.each(Array.from(['stageId', 'itemId', 'completionId']).map(input => ({ input })))('三个焦点仅接受其明确表，冷恢复仍拒绝重复参数并移除未接入的房间焦点：输入组合 1 案例 %#', ({ input: key }) => {
    const invalid = sourceTarget(mapped.unitId, { stageId: mapped.itemId, itemId: mapped.completionId, completionId: mapped.stageId })
    expect(invalid.searchParams.has(key)).toBe(false)
  })

  it.each([['stageId', 'itemId'], ['itemId', 'completionId'], ['completionId', 'stageId']] as const)('焦点 %s 拒绝来自 %s 的身份', (key, sourceKey) => {
    const value = mapped[sourceKey]
    const url = sourceTarget(mapped.unitId, mapped)
    url.searchParams.set(key, value)
    expect(inspectRestorableTabPath(`${url.pathname}${url.search}`)).toBeNull()
  })
})
