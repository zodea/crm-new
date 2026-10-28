import type { BusinessSession } from '../../server/utils/business-session'
import { afterEach, describe, expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { decodePayrollRead, encodePayrollWire, parsePayrollQuery } from '~/lib/payroll/central-codec'
import { loadPayrollGraph, payrollSourceLocks } from '~/lib/payroll/central-read'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
async function fixture() {
  const db = await createMigratedMemoryDb()
  const coordinator = createDbCoordinator(async () => db)
  closers.push(() => coordinator.close())
  let session: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] }
  const source = { version: 'v1', projects: [{ id: 'p', name: '工资来源项目', code: 'P' }, { id: 'other', name: '其他项目', code: 'O' }], crews: [{ id: 'crew-a', name: '甲班组' }, { id: 'crew-b', name: '乙班组' }], workers: [{ id: 'w', name: '负责人', crewId: null }, { id: 'zero', name: '零成员', crewId: null }] }
  let hook: (() => Promise<void>) | null = null
  const service = createPayrollService({ session: () => session, identities: async () => {
    await hook?.()
    return structuredClone(source)
  }, transaction: work => coordinator.withTransaction(tx => work(tx, session)) })
  await service.list({ origin: 'real' })
  return { db, service, source, setSession: (value: BusinessSession) => {
    session = value
  }, hook: (next: typeof hook) => {
    hook = next
  } }
}
describe('工资 P0 中央读取事务', () => {
  it('来源页按保存的班组关系筛选月份锁，详情仍保留另一班组的完整历史锁', async () => {
    const f = await fixture()
    await f.db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,quantity_source,status) VALUES (\'crew-head-a\',\'p\',\'crew-a\',\'w\',\'2026-09\',\'C1\',\'field\',\'released\'),(\'crew-head-b\',\'p\',\'crew-b\',\'zero\',\'2026-09\',\'C1\',\'field\',\'released\')')
    expect((await f.service.sources({ origin: 'real', projectId: 'p', month: '2026-09' })).locks).toHaveLength(2)
    const read = await f.service.sources({ origin: 'real', projectId: 'p', month: '2026-09', crewId: 'crew-a' })
    expect(read.locks.map(lock => lock.statementId)).toEqual(['crew-head-a'])
    expect((await f.service.detail({ origin: 'real' }, 'crew-head-b')).statement.locks.map(lock => lock.statementId)).toEqual(['crew-head-b'])
  })
  it('迁入缺失子行日志按显式旧ID映射回所属工资，隔离成员及独立来源原值仍可读', async () => {
    const f = await fixture()
    await f.db.execute('INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source) VALUES (\'one\',\'p\',\'w\',\'2026-09\',\'A\',\'field\')')
    const original = { schemaVersion: 1, projectId: 'old-p', statements: [{ id: 'old-one', project_id: 'old-p', snapshot_json: null }], members: [{ id: 'missing-member', statement_id: 'old-one', worker_id: 'unknown-worker', is_leader: 0 }], attendance: [{ id: 'isolated-attendance', project_id: 'old-p', worker_id: 'unknown-worker', hours: 0 }], lines: [], configs: [], allocations: [], daywork: [], statementDaywork: [], logs: [] }
    const mappings = [{ tableName: 'wage_statements', legacyId: 'old-one', centralId: 'one' }, { tableName: 'operation_logs', legacyId: 'old-log', centralId: 'new-log' }, { tableName: 'wage_statement_members', legacyId: 'missing-member', centralId: null }]
    await f.db.execute('INSERT INTO payroll_migration_evidence(entity_id,project_id,batch_id,source_graph_json,diagnostics_json,mapping_json) VALUES (\'e\',\'p\',\'b\',?,\'[]\',?)', [JSON.stringify(original), JSON.stringify(mappings)])
    await f.db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'new-log\',\'wage_statement_lines\',\'report-missing-line\',\'delete\',?)', [JSON.stringify({ statement_id: 'old-one', amount: 7 })])
    const detail = await f.service.detail({ origin: 'real' }, 'one')
    expect(detail.history.map(row => row.id)).toEqual(['new-log'])
    expect(detail.history[0]?.afterData).toEqual({ statement_id: 'old-one', amount: 7 })
    expect(detail.evidence[0]?.source.members).toEqual(original.members)
    expect((await f.service.sources({ origin: 'real', projectId: 'p' })).evidence[0]?.source.attendance).toEqual(original.attendance)
  })
  it('没有工资单的项目仍可读取配置、真实零考勤和未领用签工，不要求量域或项目目录权限', async () => {
    const f = await fixture()
    await f.db.execute('INSERT INTO payroll_subject_configs(id,project_id,leader_worker_id,unit_rate,rule_text,enabled,updated_at) VALUES (\'cfg\',\'p\',\'w\',300,\'人工确认\',0,\'2026-09-01 10:00:00\')')
    await f.db.execute('INSERT INTO attendance_records(id,project_id,worker_id,work_date,hours) VALUES (\'attendance\',\'p\',\'zero\',\'2026-08-01\',0)')
    await f.db.execute('INSERT INTO signed_daywork_records(id,project_id,worker_id,work_date,labor_units,status) VALUES (\'day\',\'p\',\'w\',\'2026-09-02\',1,\'draft\')')
    const list = await f.service.list({ origin: 'real' })
    expect(list.rows).toEqual([])
    expect(list.projects.map(p => p.id)).toEqual(['p'])
    const sources = await f.service.sources({ origin: 'real', projectId: 'p' })
    expect(sources.configs[0]).toMatchObject({ unitRate: 300, ruleText: '人工确认', enabled: false, updatedAt: '2026-09-01 10:00:00' })
    expect(sources.attendance[0]).toMatchObject({ hours: 0 })
    expect(sources.daywork[0]).toMatchObject({ status: 'draft' })
    expect((await f.service.sources({ origin: 'real', projectId: 'p', month: '2026-08' })).daywork).toEqual([])
    await expect(f.service.sources({ origin: 'real', projectId: 'missing' })).rejects.toMatchObject({ problem: { code: 'not-found' } })
    const wire = encodePayrollWire(sources)
    expect(wire).toMatchObject({ configs: [{ unitRate: '300.00' }], attendance: [{ hours: '0' }] })
    expect(decodePayrollRead(wire, 'sources', { origin: 'real', projectId: 'p' })).toEqual(sources)
  })
  it('最终等待后撤权或身份来源变化拒绝返回，并回滚读期间镜像更正', async () => {
    const f = await fixture()
    let reads = 0
    f.hook(async () => {
      if (++reads === 2)
        f.setSession({ workspaceId: 'work', actorId: 'other', capabilities: ['payroll:read'] })
    })
    await expect(f.service.list({ origin: 'real' })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    f.hook(null)
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    reads = 0
    f.hook(async () => {
      if (++reads === 2)
        f.source.projects[0]!.name = '读取后发生更名'
    })
    await expect(f.service.list({ origin: 'real' })).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    expect((await f.db.select<{ name: string }>('SELECT name FROM projects WHERE id=\'p\''))[0]!.name).toBe('工资来源项目')
  })
  it('已发月锁保留零成员及软删关系；未发 C2 仍有格式互斥与唯一签工占用', async () => {
    const f = await fixture()
    await f.db.execute('INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source,status,deleted_at) VALUES (\'released\',\'p\',\'w\',\'2026-08\',\'C1\',\'field\',\'released\',\'2026-09-01\'),(\'draft\',\'p\',\'w\',\'2026-09\',\'C2\',\'field\',\'draft\',NULL)')
    await f.db.execute('INSERT INTO wage_statement_members(id,statement_id,worker_id,is_leader,deleted_at) VALUES (\'member\',\'released\',\'zero\',0,\'2026-09-01\')')
    await f.db.execute('INSERT INTO signed_daywork_records(id,project_id,worker_id,work_date,labor_units,status) VALUES (\'day\',\'p\',\'zero\',\'2026-09-02\',1,\'confirmed\')')
    await f.db.execute('INSERT INTO wage_statement_daywork_records(id,statement_id,daywork_record_id) VALUES (\'link\',\'draft\',\'day\')')
    const locks = payrollSourceLocks(await loadPayrollGraph(f.db))
    expect(locks).toContainEqual(expect.objectContaining({ workerId: 'zero', month: '2026-08', kind: 'released-month' }))
    expect(locks).toContainEqual(expect.objectContaining({ workerId: 'w', month: '2026-09', kind: 'format-exclusion' }))
    expect(locks).toContainEqual(expect.objectContaining({ workerId: 'zero', dayworkRecordId: 'day', kind: 'daywork-occupation' }))
    expect((await f.service.detail({ origin: 'real' }, 'released')).statement).toMatchObject({ hidden: true, actualAmount: null })
  })
  it('可识别缺失子行日志仍可读，其他工资与其他表日志不能混入', async () => {
    const f = await fixture()
    await f.db.execute('INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source) VALUES (\'one\',\'p\',\'w\',\'2026-09\',\'A\',\'field\'),(\'two\',\'other\',\'w\',\'2026-09\',\'A\',\'field\')')
    for (const [id, table, statement] of [['own', 'wage_statement_lines', 'one'], ['foreign', 'wage_statement_lines', 'two'], ['unrelated', 'payment_records', 'one']])
      await f.db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES (?,?,?,\'delete\',?,NULL)', [id, table, 'missing', JSON.stringify({ statement_id: statement })])
    const detail = await f.service.detail({ origin: 'real' }, 'one')
    expect(detail.history.map(row => row.id)).toEqual(['own'])
    expect(detail.history[0]?.operator).toBeNull()
    await expect(f.service.detail({ origin: 'real', projectId: 'other' }, 'one')).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(f.service.list({ origin: 'demo', includeDemo: true })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })
  it('严格读范围及 wire 校验不会把错误来源或 number 金额当成有效响应', async () => {
    const f = await fixture()
    const valid = await f.service.list({ origin: 'real' })
    expect(() => decodePayrollRead({ ...valid, context: { ...valid.context, origin: 'demo' } }, 'list', { origin: 'real' })).toThrow('工资读取内容或范围不完整')
  })

  it.each([
    { label: '月份 13', input: { month: '2026-13' }, reason: '工资月份必须是有效年月' },
    { label: '空白项目', input: { projectId: ' ' }, reason: '工资项目或班组身份无效' },
    { label: '夹带伪造操作人', input: { actorId: 'forged' }, reason: '工资读取含不支持的范围字段' },
  ])('工资读取范围拒绝$label', ({ input, reason }) => {
    expect(() => parsePayrollQuery(input)).toThrow(reason)
  })
})
