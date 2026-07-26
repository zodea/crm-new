import type { MigrationDb } from './migrations'
import { addCalendarDays } from '~/lib/schedule/planning'
import { SCHEDULE_TASK_TEMPLATES } from '~/lib/schedule/template'
import { generateId } from '~/lib/util/id'

type SeedRow = Record<string, unknown>

const localFiles = import.meta.glob<{ default: SeedRow[] }>('./seed/*.local.json', { eager: true })
const baseFiles = import.meta.glob<{ default: SeedRow[] }>('./seed/*.json', { eager: true })

function loadSeedJson(table: string): SeedRow[] | null {
  const localKey = `./seed/${table}.local.json`
  if (localFiles[localKey])
    return localFiles[localKey].default

  const baseKey = `./seed/${table}.json`
  if (baseFiles[baseKey])
    return baseFiles[baseKey].default

  return null
}

function columnPlaceholders(row: SeedRow): { cols: string[], vals: unknown[] } {
  const cols = Object.keys(row)
  const vals = cols.map(c => row[c])
  return { cols, vals }
}

async function seedFromJson(db: MigrationDb, table: string, rows: SeedRow[]) {
  for (const row of rows) {
    const { cols, vals } = columnPlaceholders(row)
    const placeholders = cols.map(() => '?').join(', ')
    const colNames = cols.map(c => `"${c}"`).join(', ')
    await db.execute(`INSERT OR IGNORE INTO "${table}" (${colNames}) VALUES (${placeholders})`, vals)
  }
}

export const QUANTITY_SEED_TABLES = [
  'items',
  'buildings',
  'floors',
  'house_type_templates',
  'rooms',
  'units',
  'house_type_template_items',
  'construction_stages',
  'construction_stage_items',
  'unit_assignments',
  'unit_assignment_scopes',
  'unit_stage_completions',
] as const

function loadBaseSeedJson(table: string): SeedRow[] {
  const key = `./seed/${table}.json`
  const rows = baseFiles[key]?.default
  if (!rows?.length)
    throw new Error(`[seed] 工程量演示数据缺失或为空: ${table}.json`)
  return rows
}

async function seedStrictById(db: MigrationDb, table: string, rows: SeedRow[]) {
  for (const row of rows) {
    const { cols, vals } = columnPlaceholders(row)
    const placeholders = cols.map(() => '?').join(', ')
    const colNames = cols.map(c => `"${c}"`).join(', ')
    await db.execute(
      `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) ON CONFLICT(id) DO NOTHING`,
      vals,
    )
  }
}

/**
 * v12 工程量演示图是一个紧密关联的整体：不能沿用“表非空就整表跳过”，因为插入
 * 户型时 trigger 会先创建 whole_unit 房间。确定性 ID 允许中断后整组重放；旧用户库
 * 不一定包含演示项目/班组祖先，缺任一哨兵时安全跳过，不向真实数据硬塞 demo。
 */
export async function seedQuantityDemo(db: MigrationDb) {
  const [project] = await db.select<{ id: string }>(
    `SELECT id FROM projects WHERE id = 'proj_demo_001' AND deleted_at IS NULL`,
  )
  const crews = await db.select<{ id: string }>(
    `SELECT id FROM crews
     WHERE id IN ('crew_demo_001', 'crew_demo_002', 'crew_demo_005', 'crew_demo_006')
       AND deleted_at IS NULL`,
  )
  const [worker] = await db.select<{ id: string }>(
    `SELECT id FROM workers WHERE id = 'wkr_demo_003' AND deleted_at IS NULL`,
  )
  if (!project || crews.length !== 4 || !worker)
    return

  // 完整 seed 的尾哨兵物理存在后不再重放，避免用户后续编辑 demo 自然键时每次启动
  // 都被确定性 seed 干扰；事务失败不会留下该哨兵，预置的半成品仍可收敛。
  const [seeded] = await db.select<{ id: string }>(
    `SELECT id FROM unit_stage_completions WHERE id = 'qty_done_2_01_01_wall'`,
  )
  if (seeded)
    return

  await db.execute('BEGIN')
  try {
    for (const table of QUANTITY_SEED_TABLES)
      await seedStrictById(db, table, loadBaseSeedJson(table))
    await db.execute('COMMIT')
  }
  catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
}

const BOQ_SEED_TABLES = [
  'boq_files',
  'boq_lines',
  'boq_change_orders',
  'boq_change_lines',
  'monthly_statements',
  'monthly_statement_lines',
] as const

const BOQ_TEMPLATE_LINKS = [
  ['qty_hti_a_pipe', 'boq_line_demo_a_pipe'],
  ['qty_hti_a_wp_wall', 'boq_line_demo_a_wp_wall'],
  ['qty_hti_a_wp_floor', 'boq_line_demo_a_wp_floor'],
  ['qty_hti_a_wall', 'boq_line_demo_a_wall'],
  ['qty_hti_a_floor', 'boq_line_demo_a_floor'],
  ['qty_hti_b_pipe', 'boq_line_demo_b_pipe'],
  ['qty_hti_b_wp_wall', 'boq_line_demo_b_wp_wall'],
  ['qty_hti_b_wp_floor', 'boq_line_demo_b_wp_floor'],
  ['qty_hti_b_wall', 'boq_line_demo_b_wall'],
  ['qty_hti_b_floor', 'boq_line_demo_b_floor'],
] as const

/**
 * #115 演示清单与 #103 工程量事实共享稳定行 ID；缺施工合同或工程量演示图时不污染旧库。
 */
export async function seedBoqDemo(db: MigrationDb) {
  const [contract] = await db.select<{ id: string }>(`
    SELECT id
    FROM contracts
    WHERE id = 'con_demo_sg01'
      AND project_id = 'proj_demo_001'
      AND kind = '施工'
      AND deleted_at IS NULL
  `)
  const [quantitySentinel] = await db.select<{ id: string }>(`
    SELECT id
    FROM house_type_template_items
    WHERE id = 'qty_hti_b_floor'
      AND deleted_at IS NULL
  `)
  if (!contract || !quantitySentinel)
    return

  const [seeded] = await db.select<{ id: string }>(`
    SELECT id FROM monthly_statement_lines WHERE id = 'monthly_statement_line_demo_001'
  `)
  if (seeded)
    return

  await db.execute('BEGIN')
  try {
    const ledgerRows = loadBaseSeedJson('owner_change_orders')
      .filter(row => row.id === 'boq_ledger_demo_001')
    await seedStrictById(db, 'owner_change_orders', ledgerRows)
    for (const table of BOQ_SEED_TABLES)
      await seedStrictById(db, table, loadBaseSeedJson(table))
    for (const [templateItemId, boqLineId] of BOQ_TEMPLATE_LINKS) {
      await db.execute(
        `UPDATE house_type_template_items
         SET boq_line_id = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [boqLineId, templateItemId],
      )
    }
    await db.execute('COMMIT')
  }
  catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
}

const DEMO_SCHEDULE_PROJECT_ID = 'proj_demo_001'
const DEMO_SCHEDULE_GROUP_ID = 'schedule_group_demo_001'

const DEMO_SCHEDULE_WINDOWS = [
  ['2026-05-06', '2026-06-04'],
  ['2026-05-08', '2026-06-06'],
  ['2026-05-12', '2026-06-10'],
  ['2026-06-07', '2026-07-06'],
  ['2026-06-11', '2026-06-28'],
  ['2026-06-11', '2026-07-10'],
  ['2026-07-07', '2026-07-24'],
  ['2026-07-04', '2026-07-21'],
  ['2026-06-13', '2026-08-01'],
  ['2026-07-23', '2026-08-21'],
  ['2026-06-21', '2026-07-10'],
  ['2026-07-11', '2026-07-30'],
  ['2026-07-31', '2026-08-17'],
  ['2026-08-13', '2026-09-06'],
  ['2026-07-31', '2026-08-29'],
  ['2026-08-02', '2026-08-21'],
  ['2026-08-18', '2026-09-06'],
  ['2026-08-23', '2026-09-16'],
  ['2026-09-27', '2026-10-06'],
  ['2026-07-31', '2026-08-19'],
  ['2026-09-17', '2026-10-06'],
  ['2026-10-16', '2026-10-23'],
] as const

const DEMO_MANUAL_PROGRESS: Record<string, number> = {
  'setting-out': 1,
  'plumbing': 1,
  'wiring': 0.8,
  'air-conditioning': 1,
}

function calendarDayDifference(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00Z`)
  const toTime = Date.parse(`${to}T00:00:00Z`)
  return Math.round((toTime - fromTime) / 86_400_000)
}

/**
 * #114 演示排程是确定性 seed：只在完整的 #103 演示图存在时写入，不污染真实旧库。
 * stage/item 均按稳定 code 解析，排程 seed 不复制工程量身份。
 */
export async function seedScheduleDemo(db: MigrationDb) {
  const [project] = await db.select<{ id: string }>(
    `SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL`,
    [DEMO_SCHEDULE_PROJECT_ID],
  )
  if (!project)
    return

  const [seededTask] = await db.select<{ id: string }>(
    `SELECT id FROM schedule_tasks WHERE id = 'schedule_task_demo_22'`,
  )
  const [seededFloorPlan] = await db.select<{ id: string }>(
    `SELECT id FROM schedule_task_floor_plans
     WHERE task_id LIKE 'schedule_task_demo_%'
     LIMIT 1`,
  )
  if (seededTask && seededFloorPlan)
    return

  const buildings = await db.select<{ id: string }>(
    `SELECT id FROM buildings
     WHERE project_id = ? AND deleted_at IS NULL
     ORDER BY sort_order, code, id`,
    [DEMO_SCHEDULE_PROJECT_ID],
  )
  const stages = await db.select<{ id: string, code: string }>(
    `SELECT id, code FROM construction_stages
     WHERE project_id = ? AND deleted_at IS NULL`,
    [DEMO_SCHEDULE_PROJECT_ID],
  )
  const floors = await db.select<{ id: string, building_id: string }>(
    `SELECT floor_row.id, floor_row.building_id
     FROM floors floor_row
     JOIN buildings building ON building.id = floor_row.building_id
     WHERE building.project_id = ?
       AND building.deleted_at IS NULL
       AND floor_row.deleted_at IS NULL
     ORDER BY building.sort_order, building.code, floor_row.sort_order, floor_row.code, floor_row.id`,
    [DEMO_SCHEDULE_PROJECT_ID],
  )
  const items = await db.select<{ id: string, code: string }>(
    `SELECT id, code FROM items
     WHERE project_id = ? AND deleted_at IS NULL`,
    [DEMO_SCHEDULE_PROJECT_ID],
  )
  const stageByCode = new Map(stages.map(stage => [stage.code, stage.id]))
  const itemByCode = new Map(items.map(item => [item.code, item.id]))
  const [contract] = await db.select<{ id: string }>(`
    SELECT id
    FROM contracts
    WHERE project_id = ?
      AND kind = '施工'
      AND deleted_at IS NULL
    ORDER BY created_at, id
    LIMIT 1
  `, [DEMO_SCHEDULE_PROJECT_ID])
  const boqLines = await db.select<{ id: string, item_id: string }>(`
    SELECT id, item_id
    FROM boq_lines
    WHERE project_id = ?
      AND contract_id = ?
      AND item_id IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY sort_order, id
  `, [DEMO_SCHEDULE_PROJECT_ID, contract?.id ?? ''])
  const boqLineByItem = new Map<string, string>()
  for (const line of boqLines) {
    if (!boqLineByItem.has(line.item_id))
      boqLineByItem.set(line.item_id, line.id)
  }
  const missingStage = SCHEDULE_TASK_TEMPLATES.find(
    template => template.stageCode && !stageByCode.has(template.stageCode),
  )
  const missingItem = SCHEDULE_TASK_TEMPLATES
    .flatMap(template => template.itemCodes)
    .find(code => !itemByCode.has(code))
  if (!buildings.length || !contract || missingStage || missingItem)
    return

  await db.execute('BEGIN')
  try {
    await db.execute(
      `INSERT INTO schedule_groups (id, project_id, contract_id, name, sort_order)
       VALUES (?, ?, ?, ?, 10) ON CONFLICT(id) DO NOTHING`,
      [DEMO_SCHEDULE_GROUP_ID, DEMO_SCHEDULE_PROJECT_ID, contract.id, '户内1栋-2栋'],
    )
    for (const [index, building] of buildings.entries()) {
      await db.execute(
        `INSERT INTO schedule_group_buildings (id, group_id, building_id, sort_order)
         VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        [`schedule_group_building_demo_${index + 1}`, DEMO_SCHEDULE_GROUP_ID, building.id, (index + 1) * 10],
      )
    }

    for (const [index, template] of SCHEDULE_TASK_TEMPLATES.entries()) {
      const id = `schedule_task_demo_${String(index + 1).padStart(2, '0')}`
      const [plannedStart, plannedFinish] = DEMO_SCHEDULE_WINDOWS[index]!
      const stageId = template.stageCode ? stageByCode.get(template.stageCode)! : null
      await db.execute(
        `INSERT INTO schedule_tasks
          (id, project_id, group_id, name, trade, color, duration_days,
           planned_start, planned_finish, has_qty, manual_progress, stage_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          id,
          DEMO_SCHEDULE_PROJECT_ID,
          DEMO_SCHEDULE_GROUP_ID,
          template.name,
          template.trade,
          template.color,
          template.durationDays,
          plannedStart,
          plannedFinish,
          stageId ? 1 : 0,
          stageId ? null : (DEMO_MANUAL_PROGRESS[template.key] ?? 0),
          stageId,
          (index + 1) * 10,
        ],
      )

      for (const [mapIndex, itemCode] of template.itemCodes.entries()) {
        const itemId = itemByCode.get(itemCode)!
        const boqLineId = boqLineByItem.get(itemId) ?? null
        await db.execute(
          `INSERT INTO task_item_map (id, task_id, item_id, boq_line_id)
           VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
          [
            `schedule_task_item_demo_${index + 1}_${mapIndex + 1}`,
            id,
            itemId,
            boqLineId,
          ],
        )
        if (boqLineId) {
          const durationDays = calendarDayDifference(plannedStart, plannedFinish) + 1
          for (const [floorIndex, floor] of floors.entries()) {
            const startOffset = Math.floor(floorIndex * durationDays / floors.length)
            const finishOffset = Math.max(
              startOffset,
              Math.ceil((floorIndex + 1) * durationDays / floors.length) - 1,
            )
            await db.execute(
              `INSERT INTO schedule_task_floor_plans
                (id, task_id, floor_id, boq_line_id, planned_start, planned_finish, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT DO NOTHING`,
              [
                `schedule_floor_plan_demo_${index + 1}_${mapIndex + 1}_${floorIndex + 1}`,
                id,
                floor.id,
                boqLineId,
                addCalendarDays(plannedStart, startOffset),
                addCalendarDays(plannedStart, finishOffset),
                (floorIndex + 1) * 10,
              ],
            )
          }
        }
      }

      if (index > 0) {
        const predId = `schedule_task_demo_${String(index).padStart(2, '0')}`
        const previousFinish = DEMO_SCHEDULE_WINDOWS[index - 1]![1]
        await db.execute(
          `INSERT INTO task_dependencies
            (id, pred_id, succ_id, dependency_type, lag_days)
           VALUES (?, ?, ?, 'FS', ?) ON CONFLICT(id) DO NOTHING`,
          [
            `schedule_dependency_demo_${String(index).padStart(2, '0')}`,
            predId,
            id,
            calendarDayDifference(previousFinish, plannedStart),
          ],
        )
      }
    }
    await db.execute('COMMIT')
  }
  catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
}

export async function seedIfEmpty(db: MigrationDb) {
  const jsonTables = [
    'projects',
    'suppliers',
    'crews',
    'workers',
    'supplier_credentials',
    'project_suppliers',
    'phase_tasks',
    'construction_contracts',
    'owner_change_orders',
    'expenditure_contracts',
    'invoice_applications',
    'receipt_registrations',
    'current_receipts',
    'current_payments',
    'payment_records',
    'invoices',
    'settlements',
    'supplement_agreements',
    'contract_line_items',
    'ticket_registrations',
    'payment_applications',
    'file_refs',
    'contracts',
    'delivery_records',
    'delivery_lines',
  ]

  let anySeeded = false

  for (const table of jsonTables) {
    const [row] = await db.select<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM "${table}"`)
    if ((row?.cnt ?? 0) > 0)
      continue

    const json = loadSeedJson(table)
    if (json && json.length > 0) {
      await seedFromJson(db, table, json)
      anySeeded = true
    }
  }

  if (!anySeeded) {
    const [row] = await db.select<{ cnt: number }>('SELECT COUNT(*) as cnt FROM projects')
    if ((row?.cnt ?? 0) === 0) {
      await seedHardcoded(db)
    }
  }

  await seedQuantityDemo(db)
  await seedBoqDemo(db)
  await seedScheduleDemo(db)
}

async function seedHardcoded(db: MigrationDb) {
  const projIds = await seedProjects(db)
  const supIds = await seedSuppliers(db)
  await seedProjectSuppliers(db, projIds, supIds)
}

async function seedProjects(db: MigrationDb) {
  const projects = [
    {
      name: '合和新城·3号楼',
      code: 'HHXC-03',
      address: '广州市天河区天河北路385号',
      region: '广州市',
      operationType: '自营',
      startDate: '2025-09-15',
      plannedEnd: '2027-03-15',
      status: '施工中',
      developer: '广州合和置业有限公司',
      contractor: '广州市瑞航建筑工程有限公司',
      manager: '陈志强',
      managerPhone: '13800001001',
      siteLeader: '赵工',
      siteLeaderPhone: '13800001002',
      contractAmount: 3238.84,
    },
    {
      name: '车骏商业大楼',
      code: 'CJSY-01',
      address: '广州市番禺区大石街道礼村路18号',
      region: '广州市',
      operationType: '联营',
      startDate: '2025-06-01',
      plannedEnd: '2026-12-31',
      status: '施工中',
      developer: '广州车骏实业发展有限公司',
      contractor: '广州睿瑛装饰工程有限公司',
      manager: '古富联',
      managerPhone: '13800002001',
      contractAmount: 1838.62,
    },
    {
      name: '天誉花园·二期',
      code: 'TYHY-02',
      address: '广州市荔湾区花地大道南228号',
      region: '广州市',
      operationType: '自营',
      startDate: '2026-01-10',
      plannedEnd: '2027-06-30',
      status: '筹备中',
      developer: '广州市天誉置业有限公司',
      contractor: '广州市瑞航建筑工程有限公司',
      manager: '陈志强',
      managerPhone: '13800001001',
      contractAmount: 5200.00,
    },
  ]

  const ids: string[] = []
  for (const p of projects) {
    const id = generateId('proj')
    ids.push(id)
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO projects (id, name, code, address, region, operation_type, start_date, planned_end, status, developer, contractor, manager, manager_phone, site_leader, site_leader_phone, contract_amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, p.name, p.code, p.address, p.region, p.operationType, p.startDate, p.plannedEnd, p.status, p.developer, p.contractor, p.manager, p.managerPhone, p.siteLeader ?? '', p.siteLeaderPhone ?? '', p.contractAmount, now, now],
    )
  }
  return ids
}

async function seedSuppliers(db: MigrationDb) {
  const suppliers = [
    {
      name: '广州市大板东建材有限公司',
      aliases: ['大板东'],
      taxNo: '91440101MA9EXAMPLE1',
      supplierCategory: '材料供应商',
      legalRep: '王大明',
      address: '广州市白云区石井街道红星村工业区A栋',
      mainBusiness: 'HRB400螺纹钢、C30商品混凝土、水泥',
      bank: '中国建设银行广州白云支行',
      bankAccount: '4400 1234 5678 0001',
      contact: '张三',
      contactPhone: '13900001001',
      credentialStatus: 'qualified',
    },
    {
      name: '广州市顺利圆铝业有限公司',
      aliases: ['顺利圆'],
      taxNo: '91440101MA9EXAMPLE2',
      supplierCategory: '材料供应商',
      legalRep: '李顺',
      address: '广州市花都区狮岭镇工业园B区',
      mainBusiness: '铝单板、铝型材、幕墙工程',
      bank: '中国农业银行广州花都支行',
      bankAccount: '4400 9876 5432 0002',
      contact: '李工',
      contactPhone: '13900002001',
      credentialStatus: 'incomplete',
    },
    {
      name: '广州固力建筑劳务有限公司',
      aliases: ['固力劳务'],
      taxNo: '91440101MA9EXAMPLE3',
      supplierCategory: '劳务分包商',
      legalRep: '陈国强',
      address: '广州市增城区新塘镇汇太东路12号',
      mainBusiness: '建筑劳务分包、泥水工程、木工工程',
      contact: '陈工',
      contactPhone: '13900003001',
      credentialStatus: 'qualified',
    },
    {
      name: '佛山市南海区鸿运五金建材经营部',
      aliases: ['鸿运五金'],
      taxNo: '91440605MA9EXAMPLE4',
      supplierCategory: '材料供应商',
      address: '佛山市南海区大沥镇广佛五金城C区',
      mainBusiness: '水管、电线、五金配件',
      contact: '黄老板',
      contactPhone: '13900004001',
      credentialStatus: 'incomplete',
    },
    {
      name: '广州市越秀建筑机械租赁有限公司',
      aliases: ['越秀机械'],
      taxNo: '91440104MA9EXAMPLE5',
      supplierCategory: '设备供应商',
      address: '广州市越秀区环市东路368号',
      mainBusiness: '塔吊租赁、施工电梯、脚手架',
      contact: '周经理',
      contactPhone: '13900005001',
      credentialStatus: 'reviewing',
    },
  ]

  const ids: string[] = []
  for (const s of suppliers) {
    const id = generateId('sup')
    ids.push(id)
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO suppliers (id, name, aliases, tax_no, supplier_category, legal_rep, address, main_business, bank, bank_account, contact, contact_phone, credential_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, s.name, JSON.stringify(s.aliases), s.taxNo, s.supplierCategory, s.legalRep ?? '', s.address, s.mainBusiness, s.bank ?? '', s.bankAccount ?? '', s.contact, s.contactPhone, s.credentialStatus, now, now],
    )
  }
  return ids
}

async function seedProjectSuppliers(db: MigrationDb, projIds: string[], supIds: string[]) {
  const relations = [
    { projIdx: 0, supIdx: 0, status: 'contracted' },
    { projIdx: 0, supIdx: 1, status: 'claiming' },
    { projIdx: 0, supIdx: 2, status: 'contracted' },
    { projIdx: 1, supIdx: 1, status: 'collecting' },
    { projIdx: 1, supIdx: 3, status: 'contracted' },
    { projIdx: 2, supIdx: 0, status: 'collecting' },
  ]

  for (const r of relations) {
    const id = generateId('ps')
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO project_suppliers (id, project_id, supplier_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, projIds[r.projIdx], supIds[r.supIdx], r.status, now, now],
    )
  }
}
