import type { TestDb } from './memory-db'
import { runMigrations } from '../../app/lib/db/migrations'

/** 真实物理完成保留旧个人细分责任；当前人员转组不改施工归属。 */
export async function seedPayrollAQuantitySource(db: TestDb) {
  await runMigrations(db)
  const sql = `
INSERT INTO projects(id,name) VALUES ('pa-project','A 工资来源工程');
INSERT INTO crews(id,name,trade,default_pay_ratio) VALUES ('pa-crew-old','施工时班组','油漆工',0.8);
INSERT INTO crews(id,name,trade,default_pay_ratio) VALUES ('pa-crew-current','当前班组','油漆工',0);
INSERT INTO workers(id,name,crew_id,current_project_id) VALUES ('pa-worker-old','原执行工人','pa-crew-old','pa-project');
INSERT INTO workers(id,name,crew_id,current_project_id) VALUES ('pa-worker-current','当前责任工人','pa-crew-current','pa-project');
INSERT INTO workers(id,name,crew_id,current_project_id) VALUES ('pa-worker-other','独立另一主体','pa-crew-current','pa-project');
INSERT INTO buildings(id,project_id,code,name) VALUES ('pa-building','pa-project','A','一栋');
INSERT INTO floors(id,building_id,code,name) VALUES ('pa-floor','pa-building','1','一层');
INSERT INTO house_type_templates(id,project_id,code,name) VALUES ('pa-template-old','pa-project','OLD','个人细分户型');
INSERT INTO house_type_templates(id,project_id,code,name) VALUES ('pa-template-other','pa-project','OTHER','独立主体户型');
INSERT INTO rooms(id,template_id,code,name) VALUES ('pa-room-eight','pa-template-old','R8','已知八的房间');
INSERT INTO rooms(id,template_id,code,name) VALUES ('pa-room-missing','pa-template-old','RN','缺量房间');
INSERT INTO rooms(id,template_id,code,name) VALUES ('pa-room-zero','pa-template-old','R0','真实零房间');
INSERT INTO rooms(id,template_id,code,name) VALUES ('pa-room-other','pa-template-other','R4','独立房间');
INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES ('pa-unit-old','pa-floor','pa-template-old','101');
INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES ('pa-unit-other','pa-floor','pa-template-other','102');
INSERT INTO items(id,project_id,code,name,trade,unit) VALUES ('pa-item','pa-project','I','腻子','油漆工','㎡');
INSERT INTO house_type_template_items(id,room_id,item_id,field_qty,field_formula,updated_at) VALUES ('pa-line-eight','pa-room-eight','pa-item',8,'2*4','2026-08-01 08:00:00');
INSERT INTO house_type_template_items(id,room_id,item_id,field_qty,field_formula,updated_at) VALUES ('pa-line-missing','pa-room-missing','pa-item',NULL,NULL,'2026-08-01 08:00:00');
INSERT INTO house_type_template_items(id,room_id,item_id,field_qty,field_formula,updated_at) VALUES ('pa-line-zero','pa-room-zero','pa-item',0,'0','2026-08-01 08:00:00');
INSERT INTO house_type_template_items(id,room_id,item_id,field_qty,field_formula,updated_at) VALUES ('pa-line-other','pa-room-other','pa-item',4,'2*2','2026-08-01 08:00:00');
INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES ('pa-stage','pa-project','S','腻子完成','油漆工');
INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES ('pa-stage-item','pa-stage','pa-item',1);
INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES ('pa-asg-old','pa-unit-old','油漆工','pa-worker-old');
INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES ('pa-asg-other','pa-unit-other','油漆工','pa-worker-other');
INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES ('pa-scope-eight','pa-asg-old','pa-room-eight','pa-item');
INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES ('pa-scope-missing','pa-asg-old','pa-room-missing','pa-item');
INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES ('pa-scope-zero','pa-asg-old','pa-room-zero','pa-item');
INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES ('pa-done-old','pa-unit-old','pa-stage','pa-asg-old','completed','2026-08-10');
INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES ('pa-done-other','pa-unit-other','pa-stage','pa-asg-other','completed','2026-08-10');
UPDATE unit_assignments SET deleted_at='2026-08-12 08:00:00' WHERE id='pa-asg-old';
UPDATE unit_assignment_scopes SET deleted_at='2026-08-12 08:00:00' WHERE assignment_id='pa-asg-old';
INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES ('pa-asg-current','pa-unit-old','油漆工','pa-worker-current');
UPDATE workers SET crew_id='pa-crew-current',name='当前改名工人' WHERE id='pa-worker-old';
`
  for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean))
    await db.execute(statement)
}
