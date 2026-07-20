import type { MigrationDb } from './migrations'
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
