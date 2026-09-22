import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollAServiceFixture } from './payroll-a-service-fixture'

/** 冻结由公开发放产生，施工来源来自同库物理责任及现场量，供完整迁入输出验收。 */
export async function createPayrollAOutputMigrationFixture() {
  const f = await createPayrollAServiceFixture({ quantityFacts: loadPayrollAQuantityFacts })
  try {
    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write', 'quantity:read'] })
    await f.config()
    const statements = [
      'INSERT INTO buildings(id,project_id,code,name) VALUES(\'output-building\',\'p\',\'A\',\'原一栋\')',
      'INSERT INTO floors(id,building_id,code,name) VALUES(\'output-floor\',\'output-building\',\'1\',\'原一层\')',
      'INSERT INTO house_type_templates(id,project_id,code,name) VALUES(\'output-template\',\'p\',\'T\',\'原户型\')',
      'INSERT INTO rooms(id,template_id,code,name) VALUES(\'output-room\',\'output-template\',\'R\',\'原客厅\')',
      'INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(\'output-unit\',\'output-floor\',\'output-template\',\'101\')',
      'INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'output-item\',\'p\',\'I\',\'原墙砖\',\'泥工\',\'㎡\')',
      'INSERT INTO house_type_template_items(id,room_id,item_id,field_qty,field_formula) VALUES(\'output-template-line\',\'output-room\',\'output-item\',10,\'2*5\')',
      'INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES(\'output-stage\',\'p\',\'S\',\'墙砖完成\',\'泥工\')',
      'INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES(\'output-stage-item\',\'output-stage\',\'output-item\',1)',
      'INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES(\'output-assignment\',\'output-unit\',\'泥工\',\'w\')',
      'INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(\'output-scope\',\'output-assignment\',\'output-room\',\'output-item\')',
      'INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(\'output-completion\',\'output-unit\',\'output-stage\',\'output-assignment\',\'completed\',\'2026-08-05\')',
    ]
    for (const statement of statements) await f.db.execute(statement)
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'output-item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 100, scope: { kind: 'cells', cells: [{ unitId: 'output-unit', roomId: 'output-room', itemId: 'output-item' }] } }] }))
    const draft = { ...f.draft, payRatio: 1 }
    const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
    const statementId = saved.statementId!
    const read = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'zero', amount: 0 }] } }))
    return { ...f, statementId }
  }
  catch (cause) {
    await f.close()
    throw cause
  }
}
