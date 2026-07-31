import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import {
  buildQuantityVarianceRows,
  filterQuantityVarianceRows,
  loadQuantityVarianceFacts,
} from '~/lib/quantity/variance'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await seedIfEmpty(db)
})

afterEach(() => db.close())

describe('工程量量差总表', () => {
  it('按楼栋与分项聚合户型三量，跨楼栋签证只形成一条待分摊项目事实', async () => {
    const facts = await loadQuantityVarianceFacts(db, 'proj_demo_001')
    const rows = buildQuantityVarianceRows(facts, 'provisional')
    const wall = rows.find(row =>
      row.buildingName === '1栋'
      && row.itemName === '墙砖铺贴',
    )
    const unallocatedChange = rows.find(row =>
      row.buildingName === '待分摊签证'
      && row.itemName === '墙砖铺贴',
    )

    expect(wall).toMatchObject({
      section: '装饰装修',
      trade: '泥水工',
      unit: '㎡',
      sourceLineCount: 4,
      contractQty: 115,
      basisQty: 118,
      differenceQty: 3,
      contractUnitPrice: 260,
      priceStatus: 'single',
      differenceAmount: 780,
      missingContractCount: 0,
      missingBasisCount: 0,
      missingPriceCount: 0,
    })
    expect(unallocatedChange).toMatchObject({
      sourceLineCount: 1,
      contractQty: 2,
      basisQty: null,
      differenceQty: null,
      contractUnitPrice: 260,
      differenceAmount: null,
      basisStatus: 'missing',
      missingBasisCount: 1,
    })
    expect(rows
      .filter(row => row.itemName === '墙砖铺贴')
      .reduce((sum, row) => sum + (row.contractQty ?? 0), 0))
      .toBe(232)
  })

  it('待分摊签证只调整合同量，工资口径下按缺值暴露而不产生虚假结余', async () => {
    const facts = await loadQuantityVarianceFacts(db, 'proj_demo_001')
    const contractChange = buildQuantityVarianceRows(facts, 'contract')
      .find(row => row.buildingName === '待分摊签证')
    expect(contractChange).toMatchObject({
      contractQty: 2,
      basisQty: 2,
      differenceQty: 0,
      differenceAmount: 0,
      basisStatus: 'complete',
    })

    for (const basis of ['provisional', 'field'] as const) {
      const change = buildQuantityVarianceRows(facts, basis)
        .find(row => row.buildingName === '待分摊签证')
      expect(change?.basisQty, basis).toBeNull()
      expect(change?.differenceAmount, basis).toBeNull()
    }
  })

  it('只采用已审批的最新价格变更，草稿变更不得进入金额口径', async () => {
    await db.execute(`
      INSERT INTO boq_change_lines (
        id, change_order_id, boq_line_id, operation, item_name, unit,
        new_unit_price, amount, created_at, updated_at
      ) VALUES (
        'price-approved', 'boq_change_demo_001', 'boq_line_demo_a_wall',
        'price', '墙砖铺贴', '㎡', 300, 0,
        '2026-04-03T09:00:00.000Z', '2026-04-03T09:00:00.000Z'
      )
    `)
    await db.execute(`
      INSERT INTO boq_change_orders (
        id, project_id, contract_id, code, name, change_type, status
      ) VALUES (
        'change-draft', 'proj_demo_001', 'con_demo_sg01',
        'BG-DRAFT', '未审批价格', 'price', 'draft'
      )
    `)
    await db.execute(`
      INSERT INTO boq_change_lines (
        id, change_order_id, boq_line_id, operation, item_name, unit,
        new_unit_price, amount
      ) VALUES (
        'price-draft', 'change-draft', 'boq_line_demo_a_wall',
        'price', '墙砖铺贴', '㎡', 999, 0
      )
    `)

    const facts = await loadQuantityVarianceFacts(db, 'proj_demo_001')
    const rows = buildQuantityVarianceRows(facts, 'provisional')
    const wall = rows.find(row =>
      row.buildingName === '1栋'
      && row.itemName === '墙砖铺贴',
    )

    expect(wall).toMatchObject({
      contractUnitPrice: null,
      priceStatus: 'mixed',
      differenceAmount: 820,
    })
    const unallocatedChange = rows.find(row =>
      row.buildingName === '待分摊签证'
      && row.itemName === '墙砖铺贴',
    )
    expect(unallocatedChange).toMatchObject({
      contractUnitPrice: 300,
      differenceAmount: null,
      basisStatus: 'missing',
    })
  })

  it('字段缺失时不静默回退，量差和金额保持不可计算并说明缺口', async () => {
    const facts = await loadQuantityVarianceFacts(db, 'proj_demo_001')
    const rows = buildQuantityVarianceRows(facts, 'field')
    const wall = rows.find(row =>
      row.buildingName === '1栋'
      && row.itemName === '墙砖铺贴',
    )

    expect(wall).toMatchObject({
      basisQty: null,
      differenceQty: null,
      differenceAmount: null,
      missingBasisCount: 4,
      basisStatus: 'missing',
    })
  })

  it('项目、楼栋、分部、工种和分项筛选只收窄派生行', async () => {
    const facts = await loadQuantityVarianceFacts(db, 'proj_demo_001')
    const rows = buildQuantityVarianceRows(facts, 'provisional')
    const filtered = filterQuantityVarianceRows(rows, {
      buildingId: 'qty_bld_2',
      section: '装饰装修',
      trade: '泥水工',
      itemKeyword: '墙砖',
    })

    expect(filtered).toHaveLength(1)
    expect(filtered[0]).toMatchObject({
      buildingId: 'qty_bld_2',
      itemName: '墙砖铺贴',
    })
  })

  it('即使出现跨项目模板脏关联，也不得把其他项目分项串入量差', async () => {
    await db.execute(`INSERT INTO projects (id, name, code) VALUES ('variance-other', '其他项目', 'OTHER')`)
    await db.execute(`
      INSERT INTO items (id, project_id, code, name, trade)
      VALUES ('variance-other-item', 'variance-other', 'OTHER', '跨项目分项', '泥水工')
    `)
    await db.execute(`
      INSERT INTO house_type_template_items (
        id, room_id, item_id, contract_qty, provisional_qty
      ) VALUES (
        'variance-cross-project', 'qty_tpl_a:whole_unit', 'variance-other-item', 10, 12
      )
    `)

    const facts = await loadQuantityVarianceFacts(db, 'proj_demo_001')

    expect(facts.some(fact => fact.itemId === 'variance-other-item')).toBe(false)
  })

  it('跨项目 BOQ 脏关联不得把其他项目合同单价串入量差', async () => {
    await db.execute(`INSERT INTO projects (id, name, code) VALUES ('variance-other', '其他项目', 'OTHER')`)
    await db.execute(`
      UPDATE boq_lines
      SET project_id = 'variance-other'
      WHERE id = 'boq_line_demo_a_floor'
    `)

    const facts = await loadQuantityVarianceFacts(db, 'proj_demo_001')
    const linkedFacts = facts.filter(fact => fact.id.endsWith(':qty_hti_a_floor'))

    expect(linkedFacts).not.toHaveLength(0)
    expect(linkedFacts.every(fact => fact.effectiveUnitPrice == null)).toBe(true)
  })
})
