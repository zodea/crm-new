import type { PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '~/lib/payroll/central-a-codec'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

async function brokenSource(kind: 'assignment' | 'scope' = 'scope') {
  const f = await createPayrollAServiceFixture({ quantityFacts: loadPayrollAQuantityFacts })
  closers.push(f.close)
  await f.service.list({ origin: 'real' })
  f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write', 'quantity:read'] })
  for (const sql of [
    'INSERT INTO buildings(id,project_id,code,name) VALUES (\'building\',\'p\',\'A\',\'一栋\')',
    'INSERT INTO floors(id,building_id,code,name) VALUES (\'floor\',\'building\',\'1\',\'一层\')',
    'INSERT INTO house_type_templates(id,project_id,code,name) VALUES (\'template\',\'p\',\'T\',\'甲户型\')',
    'INSERT INTO rooms(id,template_id,code,name) VALUES (\'r\',\'template\',\'R\',\'客厅\')',
    'INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES (\'u\',\'floor\',\'template\',\'101\')',
    'INSERT INTO items(id,project_id,code,name,trade,unit) VALUES (\'item\',\'p\',\'I\',\'墙砖\',\'贴砖\',\'㎡\')',
    'INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES (\'stage\',\'p\',\'S\',\'贴砖完成\',\'贴砖\')',
    'INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES (\'assignment\',\'u\',\'贴砖\',\'w\')',
  ]) await f.db.execute(sql)
  await f.db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES (\'completed\',\'u\',\'stage\',\'assignment\',\'completed\',\'2026-08-05\')')
  if (kind === 'assignment') {
    // 仅在隔离内存库复现旧悬空责任，不放松任何中央命令的关系校验。
    await f.db.execute('PRAGMA foreign_keys=OFF')
    await f.db.execute('DELETE FROM unit_assignments WHERE id=\'assignment\'')
    await f.db.execute('PRAGMA foreign_keys=ON')
  }
  if (kind === 'scope') {
    await f.db.execute('INSERT INTO operation_logs(id,action,table_name,record_id,after_data) VALUES (\'scope-proof\',\'create\',\'unit_assignment_scopes\',\'missing-scope\',?)', [JSON.stringify({ id: 'missing-scope', assignment_id: 'assignment', room_id: 'r', item_id: 'item' })])
  }
  return f
}

describe('中央工资损坏来源的原位置读取', () => {
  it('原责任缺失且无工资行，仍可定位已证明的原户，不猜房间或当前责任', async () => {
    const f = await brokenSource('assignment')
    const read = await f.form()
    expect(read.facts).toEqual([])
    expect(read.blockers.find(block => block.code === 'assignment-unproven')).toMatchObject({
      unitId: 'u',
      roomId: null,
      itemId: null,
      locationLabel: '一栋 · 一层 · 101',
      sourceUnavailableReason: null,
      source: { kind: 'entity-detail', subject: { entity: 'quantity-unit', id: 'u' }, filters: { projectId: 'p', dataOrigin: 'real' } },
    })
  })
  it('原细分行已缺失仍按原审计精确呈现房间分项，HTTP形状往返保留定位', async () => {
    const f = await brokenSource()
    const read = await f.form()
    expect(read.facts).toEqual([])
    const decoded = decodePayrollARead<PayrollAFormRead>(encodePayrollAWire(read), 'form', { origin: 'real' }, { statementId: null, draftKey: 'new-a' })
    expect(decoded.blockers.find(block => block.code === 'assignment-scope-incomplete')).toMatchObject({
      unitId: 'u',
      roomId: 'r',
      itemId: 'item',
      locationLabel: '一栋 · 一层 · 101 · 客厅 · 墙砖',
      sourceUnavailableReason: null,
      source: { subject: { entity: 'quantity-unit', id: 'u' }, filters: { projectId: 'p', dataOrigin: 'real' } },
    })
  })
  it('工资可读但工程量无权时保原位置与身份，明确原因且不提供入口', async () => {
    const f = await brokenSource()
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    const read = await f.form()
    expect(read.blockers.find(block => block.code === 'assignment-scope-incomplete')).toMatchObject({
      unitId: 'u',
      roomId: 'r',
      itemId: 'item',
      locationLabel: '一栋 · 一层 · 101 · 客厅 · 墙砖',
      source: null,
      sourceUnavailableReason: '当前身份无权打开工程量来源',
    })
  })
  it('原户祖先停用后保位置并取消入口，不因原完成记录仍在而生成失效链接', async () => {
    const f = await brokenSource()
    await f.db.execute('UPDATE floors SET deleted_at=\'2026-08-10\' WHERE id=\'floor\'')
    const read = await f.form()
    expect(read.blockers.find(block => block.code === 'assignment-scope-incomplete')).toMatchObject({
      unitId: 'u',
      locationLabel: '一栋 · 一层 · 101 · 客厅 · 墙砖',
      source: null,
      sourceUnavailableReason: '原户或其所属楼层、楼栋、户型已停用或缺失',
    })
  })
  it('原户已无法证明属于当前项目时仅保原身份，不泄露其他项目名称或猜来源', async () => {
    const f = await brokenSource()
    await f.db.execute('INSERT INTO projects(id,name) VALUES (\'foreign\',\'其他项目\')')
    await f.db.execute('UPDATE buildings SET project_id=\'foreign\',name=\'其他项目私有楼栋\' WHERE id=\'building\'')
    const read = await f.form()
    expect(read.blockers.find(block => block.code === 'assignment-scope-incomplete')).toMatchObject({
      unitId: 'u',
      roomId: 'r',
      itemId: 'item',
      locationLabel: null,
      source: null,
      sourceUnavailableReason: '原户已缺失，或无法证明属于当前工资项目',
    })
    expect(JSON.stringify(read.blockers)).not.toContain('其他项目私有楼栋')
  })
})
