import type { TestDb } from './memory-db'
import { LATEST_VERSION, runMigrations } from '../../app/lib/db/migrations'
import { createCoreMigrationLocalSource } from '../../app/lib/migration/core-local-source'

async function unused(): Promise<never> {
  throw new Error('本例只读取真实 SQLite 来源')
}

export function readQuantityCoreSource(db: TestDb) {
  return createCoreMigrationLocalSource({
    isDemoActive: () => false,
    currentSchemaVersion: async () => LATEST_VERSION,
    select: (sql, params) => db.select(sql, params),
    closeDatabase: unused,
    loadProductionSnapshot: unused,
    readSnapshotSource: unused,
    createBackup: unused,
    loadBackup: unused,
    restoreBackup: unused,
    activateMigration: unused,
    clearMigration: unused,
    prepareMigration: unused,
    loadMigrationMarker: unused,
    loadPendingMigrationMarker: unused,
    now: () => '2026-09-11T00:00:00.000Z',
  }).readSource()
}

/** 全部十五张量域表均来自真实 SQLite；清单具备真实文件祖先。 */
export async function seedQuantityNativeRows(db: TestDb) {
  await runMigrations(db)
  const statements = [
    'INSERT INTO customers (id,name) VALUES (\'q-customer\',\'迁入甲方\')',
    'INSERT INTO projects (id,name,customer_id) VALUES (\'q-project\',\'迁入工程\',\'q-customer\')',
    'INSERT INTO contracts (id,no,name,kind,project_id,customer_id,amount,status,content,sign_date) VALUES (\'q-contract\',\'SG-Q442\',\'迁入合同\',\'施工\',\'q-project\',\'q-customer\',1000,\'履约中\',\'工程量迁移施工内容\',\'2026-09-01\')',
    'INSERT INTO boq_files (id,contract_id,file_name) VALUES (\'q-source\',\'q-contract\',\'原始工程量.xlsx\')',
    'INSERT INTO boq_lines (id,boq_file_id,project_id,contract_id,item_name,unit,qty,unit_price,building) VALUES (\'q-boq\',\'q-source\',\'q-project\',\'q-contract\',\'腻子\',\'㎡\',NULL,0,\'一栋\')',
    'INSERT INTO buildings (id,project_id,code,name) VALUES (\'q-building\',\'q-project\',\'B1\',\'一栋\')',
    'INSERT INTO buildings (id,project_id,code,name,deleted_at) VALUES (\'q-deleted\',\'q-project\',\'B0\',\'旧栋\',\'2026-09-10 01:00:00\')',
    'INSERT INTO floors (id,building_id,code,name) VALUES (\'q-floor\',\'q-building\',\'F1\',\'一层\')',
    'INSERT INTO house_type_templates (id,project_id,code,name) VALUES (\'q-template\',\'q-project\',\'T\',\'户型\')',
    'INSERT INTO rooms (id,template_id,code,name) VALUES (\'q-room\',\'q-template\',\'R\',\'客厅\')',
    'INSERT INTO units (id,floor_id,house_type_template_id,code) VALUES (\'q-unit\',\'q-floor\',\'q-template\',\'101\')',
    'INSERT INTO items (id,project_id,code,name,trade,unit) VALUES (\'q-item\',\'q-project\',\'I\',\'腻子\',\'油漆工\',\'㎡\')',
    'INSERT INTO house_type_template_items (id,room_id,item_id,boq_line_id,recognized_contract_qty,contract_qty,provisional_qty,field_qty) VALUES (\'q-line\',\'q-room\',\'q-item\',\'q-boq\',8,0,6,NULL)',
    'INSERT INTO construction_stages (id,project_id,code,name,trade) VALUES (\'q-stage\',\'q-project\',\'S\',\'腻子\',\'油漆工\')',
    'INSERT INTO construction_stage_items (id,stage_id,item_id,is_reporting_stage) VALUES (\'q-mapping\',\'q-stage\',\'q-item\',1)',
    'INSERT INTO crews (id,name,trade) VALUES (\'q-crew\',\'迁入班组\',\'油漆工\')',
    'INSERT INTO unit_assignments (id,unit_id,trade,crew_id) VALUES (\'q-assignment\',\'q-unit\',\'油漆工\',\'q-crew\')',
    'INSERT INTO unit_assignment_scopes (id,assignment_id,room_id,item_id) VALUES (\'q-scope\',\'q-assignment\',\'q-room\',\'q-item\')',
    'INSERT INTO unit_stage_completions (id,unit_id,stage_id,assignment_id,status,completed_at,note) VALUES (\'q-done\',\'q-unit\',\'q-stage\',\'q-assignment\',\'completed\',\'2026-09-11\',\'旧库备注\')',
    'INSERT INTO file_refs (id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader) VALUES (\'q-photo\',\'unit_stage_completion\',\'q-done\',\'验收.png\',\'C:/历史照片.png\',3,\'image/png\',\'acceptance_photo\',\'历史经办人\')',
    'INSERT INTO file_payloads (file_ref_id,encoding,content) VALUES (\'q-photo\',\'base64\',\'AQID\')',
  ]
  for (const statement of statements) await db.execute(statement)
  const [completion] = await db.select('SELECT * FROM unit_stage_completions WHERE id = ?', ['q-done'])
  await db.execute('INSERT INTO operation_logs (id,table_name,record_id,action,before_data,after_data,operator) VALUES (?,?,?,?,?,?,?)', [
    'q-audit',
    'unit_stage_completions',
    'q-done',
    'update',
    JSON.stringify({ ...completion as object, note: '更早备注' }),
    JSON.stringify(completion),
    '历史经办人',
  ])
}

export async function seedQuantityMigrationSource(db: TestDb) {
  await seedQuantityNativeRows(db)
  return readQuantityCoreSource(db)
}
