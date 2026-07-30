import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMonthlyQuantities } from '~/lib/boq/monthly'
import { runMigrations } from '~/lib/db/migrations'
import {
  listOwnerDocumentAttachments,
  listOwnerDocumentBoqLines,
  listOwnerDocumentContractOptions,
  listOwnerDocumentForms,
  loadOwnerDocumentForm,
  loadPenaltyDeductions,
  ownerDocumentStatusIsEditable,
} from '~/lib/owner-document/forms'
import { useOwnerDocumentStore } from '~/stores/owner-document'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
  withTransaction: async <T>(
    work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>,
  ) => {
    await mem.execute('BEGIN')
    try {
      const result = await work({
        execute: (sql, params) => mem.execute(sql, params),
        select: (sql, params) => mem.select(sql, params),
      })
      await mem.execute('COMMIT')
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())
  await mem.execute(`
    INSERT INTO customers (id, name, status)
    VALUES ('customer-owner', '甲方客户', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id, approval_status)
    VALUES ('project-owner', '甲方项目', 'customer-owner', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO suppliers (id, name, approval_status)
    VALUES
      ('supplier-sub', '分包分供方', 'approved'),
      ('supplier-other', '其他分供方', 'approved')
  `)
  await mem.execute(`
    INSERT INTO crews (id, name, status)
    VALUES ('crew-owner', '泥水班组', '在场')
  `)
  await mem.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, supplier_id, amount, changed, paid, status
    )
    VALUES
      (
        'contract-owner', 'SG-OWNER', '施工合同', '施工',
        'project-owner', NULL, 1000, 1200, 300, '履约中'
      ),
      (
        'contract-sub', 'FB-OWNER', '分包合同', '分包',
        'project-owner', 'supplier-sub', 500, 560, 100, '履约中'
      )
  `)
  await mem.execute(`
    INSERT INTO boq_files (
      id, contract_id, file_name, file_path, format_class, parse_status
    )
    VALUES (
      'boq-file-owner', 'contract-owner', '施工合同清单.xlsx', '', 'A', 'parsed'
    )
  `)
  await mem.execute(`
    INSERT INTO boq_lines (
      id, boq_file_id, project_id, contract_id, item_name, unit,
      qty, unit_price, amount, trace_key, sort_order
    )
    VALUES (
      'boq-line-owner', 'boq-file-owner', 'project-owner', 'contract-owner',
      '墙砖铺贴', '㎡', 10, 20, 200, 'owner-line-1', 10
    )
  `)
  for (const sql of [
    `INSERT INTO items (id, project_id, code, name, trade)
     VALUES ('item-owner', 'project-owner', 'ITEM-OWNER', '墙砖铺贴', '瓦工')`,
    `INSERT INTO buildings (id, project_id, code, name)
     VALUES ('building-owner', 'project-owner', 'B-OWNER', '1#楼')`,
    `INSERT INTO floors (id, building_id, code, name)
     VALUES ('floor-owner', 'building-owner', 'F-OWNER', '1层')`,
    `INSERT INTO house_type_templates (id, project_id, code, name)
     VALUES ('template-owner', 'project-owner', 'HT-OWNER', 'A户型')`,
    `INSERT INTO rooms (id, template_id, code, name)
     VALUES ('room-owner', 'template-owner', 'ROOM-OWNER', '客厅')`,
    `INSERT INTO units (id, floor_id, house_type_template_id, code, name)
     VALUES ('unit-owner', 'floor-owner', 'template-owner', 'U-OWNER', '101')`,
    `INSERT INTO house_type_template_items (
       id, room_id, item_id, boq_line_id, field_qty
     )
     VALUES ('hti-owner', 'room-owner', 'item-owner', 'boq-line-owner', 3)`,
    `INSERT INTO construction_stages (id, project_id, code, name, trade)
     VALUES ('stage-owner', 'project-owner', 'STAGE-OWNER', '墙砖完成', '瓦工')`,
    `INSERT INTO construction_stage_items (
       id, stage_id, item_id, is_reporting_stage
     )
     VALUES ('stage-item-owner', 'stage-owner', 'item-owner', 1)`,
    `INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
     VALUES ('assignment-owner', 'unit-owner', '瓦工', 'crew-owner')`,
    `INSERT INTO unit_stage_completions (
       id, unit_id, stage_id, assignment_id, status, completed_at
     )
     VALUES (
       'completion-owner', 'unit-owner', 'stage-owner', 'assignment-owner',
       'completed', '2026-07-20 12:00:00'
     )`,
  ]) {
    await mem.execute(sql)
  }
})

afterEach(() => {
  mem.close()
})

describe('f5 甲方/分包单据领域事务', () => {
  it('甲方量价变更复用 BOQ，单据类型独立保存并只生成一条锁定台账', async () => {
    const store = useOwnerDocumentStore()
    const saved = await store.saveForm('owner_change', {
      no: 'BQ-OWNER-001',
      name: '墙砖工程量调整',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentType: 'site_visa',
      directiveNo: 'ZL-001',
      directiveType: 'issued',
      applicationDate: '2026-07-20',
      approvedTaxInclusiveAmount: 50,
      approvedTaxExclusiveAmount: 45,
      appliedTaxExclusiveAmount: 48,
      reason: '现场范围增加',
      lines: [{
        operation: 'qty',
        boqLineId: 'boq-line-owner',
        itemName: '墙砖铺贴',
        unit: '㎡',
        deltaQty: 2,
      }],
    }, 'submit', {
      add: [{
        fileName: '现场签证.pdf',
        category: 'owner_directive',
      }],
    })

    expect(await loadOwnerDocumentForm('owner_change', saved.id)).toMatchObject({
      id: saved.id,
      no: 'BQ-OWNER-001',
      status: 'submitted',
      documentType: 'site_visa',
      changeType: 'qty',
      totalAmount: 40,
      lines: [
        expect.objectContaining({
          operation: 'qty',
          boqLineId: 'boq-line-owner',
          deltaQty: 2,
        }),
      ],
    })
    await store.approveOwnerChange(saved.id, '2026-07-26')
    const approved = await loadOwnerDocumentForm('owner_change', saved.id)
    expect(approved).toMatchObject({
      status: 'approved',
      approvedTaxInclusiveAmount: 50,
      approvedTaxExclusiveAmount: 45,
      appliedTaxExclusiveAmount: 48,
      ledger: {
        sourceLocked: true,
        taxInclusiveAmount: 50,
        taxExclusiveAmount: 45,
        appliedAmount: 48,
      },
    })
    expect(await listOwnerDocumentForms('owner_change')).toEqual([
      expect.objectContaining({
        id: saved.id,
        no: 'BQ-OWNER-001',
        contractId: 'contract-owner',
        contractName: '施工合同',
        type: 'site_visa',
        amount: 50,
        secondaryAmount: 45,
        tertiaryAmount: 48,
        date: '2026-07-26',
        status: 'approved',
      }),
    ])
    expect(await mem.select(`
      SELECT COUNT(*) AS count
      FROM owner_change_orders
      WHERE source_type = 'boq_change_order'
        AND source_id = ?
        AND deleted_at IS NULL
    `, [saved.id])).toEqual([{ count: 1 }])
    expect(await listOwnerDocumentAttachments('owner_change', saved.id)).toEqual([
      expect.objectContaining({
        fileName: '现场签证.pdf',
        category: 'owner_directive',
      }),
    ])
    await expect(
      store.removeForm('owner_change', saved.id),
    ).rejects.toThrow('已签证变更不可直接删除')

    const pureAmount = await store.saveForm('owner_change', {
      no: 'BQ-OWNER-PURE-001',
      name: '纯金额现场签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentType: 'site_visa',
      applicationDate: '2026-07-21',
      approvedTaxInclusiveAmount: 88,
      approvedTaxExclusiveAmount: 80,
      reason: '仅确认金额、不调整量价',
      lines: [],
    }, 'submit')
    await store.approveOwnerChange(pureAmount.id, '2026-07-27')
    expect(await loadOwnerDocumentForm('owner_change', pureAmount.id)).toMatchObject({
      status: 'approved',
      sourceLocked: true,
      approvedTaxInclusiveAmount: 88,
      approvedTaxExclusiveAmount: 80,
      lines: [],
    })
    await expect(
      store.removeForm('owner_change', pureAmount.id),
    ).rejects.toThrow('已生效纯金额签证不可直接删除')
  })

  it('合同清单行按基准缺量时标注缺数，不回退到其他量源', async () => {
    // 现场复核量缺失：既不能顶替成暂估/合同量，也不能只报 0 让缺数看不出来。
    await mem.execute(
      `UPDATE house_type_template_items
       SET field_qty = NULL, provisional_qty = 9, contract_qty = 8
       WHERE id = 'hti-owner'`,
    )
    const lines = await listOwnerDocumentBoqLines(
      'project-owner',
      'contract-owner',
      '2026-07',
    )
    expect(lines).toEqual([expect.objectContaining({
      id: 'boq-line-owner',
      autoQty: 0,
      missingQtyCount: 1,
    })])
  })

  it('月度报量从阶段完成事实派生自动量，忽略客户端伪造值并保留申报与审定量', async () => {
    const store = useOwnerDocumentStore()
    expect(await loadMonthlyQuantities(
      mem,
      'project-owner',
      'contract-owner',
      '2026-07',
    )).toEqual([{ boq_line_id: 'boq-line-owner', auto_qty: 3, missing_count: 0 }])
    const saved = await store.saveForm('owner_report', {
      no: 'BL-OWNER-001',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      periodNo: '2026-07',
      applicationDate: '2026-07-25',
      note: '七月报量',
      lines: [{
        boqLineId: 'boq-line-owner',
        itemName: '墙砖铺贴',
        unit: '㎡',
        autoQty: 999,
        reportedQty: 2.5,
        unitPrice: 20,
      }],
    }, 'submit')

    expect(await loadOwnerDocumentForm('owner_report', saved.id)).toMatchObject({
      status: 'reported',
      reportedAmount: 50,
      auditedAmount: null,
      auditDifference: null,
      lines: [
        expect.objectContaining({
          boqLineId: 'boq-line-owner',
          autoQty: 3,
          reportedQty: 2.5,
          auditedQty: null,
          amount: 50,
        }),
      ],
    })
    await expect(store.auditOwnerReport(saved.id, {
      auditedAmount: 0,
      lines: [],
    })).rejects.toThrow('全部明细')
    await store.auditOwnerReport(saved.id, {
      auditedAmount: 40,
      lines: [{
        boqLineId: 'boq-line-owner',
        auditedQty: 2,
        auditedAmount: 40,
      }],
    })
    expect(await loadOwnerDocumentForm('owner_report', saved.id)).toMatchObject({
      status: 'audited',
      reportedAmount: 50,
      auditedAmount: 40,
      auditDifference: -10,
      lines: [
        expect.objectContaining({
          autoQty: 3,
          reportedQty: 2.5,
          auditedQty: 2,
          auditedAmount: 40,
        }),
      ],
    })
  })

  it('六类独立单据复用真实合同与支出结算，项目罚扣从抵扣关系派生金额', async () => {
    const store = useOwnerDocumentStore()
    await mem.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, no, name, amount, status
      )
      VALUES
        ('supplement-owner-effective', 'contract-owner', 'BC-001', '有效补充协议', 250, '有效'),
        ('supplement-owner-draft', 'contract-owner', 'BC-002', '草稿补充协议', 500, '草稿')
    `)
    await mem.execute(`
      INSERT INTO receipt_registrations (
        id, no, receipt_date, project_id, contract_id, customer_id, amount
      )
      VALUES (
        'receipt-owner', 'SK-001', '2026-07-20', 'project-owner',
        'contract-owner', 'customer-owner', 320
      )
    `)
    const acceptance = await store.saveForm('acceptance', {
      no: 'YS-001',
      type: 'acceptance',
      name: '项目竣工验收',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentDate: '2026-07-20',
      contractEstimate: 1200,
      acceptor: '张工',
      warrantyOwner: '李工',
      conclusion: '合格',
    }, 'submit')
    const finalSettlement = await store.saveForm('final_settlement', {
      no: 'ZZ-001',
      name: '项目最终结算',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      settlementAmount: 1180,
      submissionDate: '2026-07-21',
      basis: '合同与已签证变更',
      differenceNote: '审减 20 元',
    }, 'submit')
    const ownerPenalty = await store.saveForm('owner_penalty', {
      no: 'JFFK-001',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      noticeNo: 'LX-001',
      amount: 10,
      penaltyDate: '2026-07-22',
      reason: '成品保护',
      appealNote: '已提交说明',
    }, 'submit')
    const subChange = await store.saveForm('sub_change', {
      no: 'FBBQ-001',
      changeType: '增项',
      projectId: 'project-owner',
      supplierId: 'supplier-sub',
      contractId: 'contract-sub',
      changeDate: '2026-07-23',
      approvedAmount: 30,
      changedArea: 5,
      actualApprovedPrice: 28,
      reason: '增加收口',
    }, 'submit')
    const subSettlement = await store.saveForm('sub_settlement', {
      no: 'FBJS-001',
      name: '七月过程结算',
      projectId: 'project-owner',
      supplierId: 'supplier-sub',
      contractId: 'contract-sub',
      settlementType: '过程结算',
      totalAmount: 100,
      settlementDate: '2026-07-24',
      deductionNote: '待抵扣罚扣',
    }, 'submit')
    const penalty = await store.saveForm('project_penalty', {
      no: 'XMFK-001',
      projectId: 'project-owner',
      supplierId: 'supplier-sub',
      contractId: 'contract-sub',
      crewId: 'crew-owner',
      penaltyDate: '2026-07-25',
      reason: '质量整改超期',
      amount: 20,
      deductionMethod: '按金额扣除',
      deadline: '2026-07-30',
      rectificationNote: '复查合格后抵扣',
    }, 'submit')

    for (const [kind, id] of [
      ['acceptance', acceptance.id],
      ['final_settlement', finalSettlement.id],
      ['owner_penalty', ownerPenalty.id],
      ['sub_change', subChange.id],
      ['sub_settlement', subSettlement.id],
      ['project_penalty', penalty.id],
    ] as const) {
      await expect(store.saveForm(kind, { id }, 'draft')).rejects.toThrow('只有草稿')
    }

    expect(await loadOwnerDocumentForm('acceptance', acceptance.id)).toMatchObject({
      projectId: 'project-owner',
      contractId: 'contract-owner',
      status: 'submitted',
    })
    await store.transitionAcceptance(acceptance.id, 'accepted')
    expect(await loadOwnerDocumentForm('acceptance', acceptance.id)).toMatchObject({
      type: 'acceptance',
      status: 'accepted',
    })
    await store.transitionAcceptance(acceptance.id, 'warranty')
    expect(await loadOwnerDocumentForm('acceptance', acceptance.id)).toMatchObject({
      type: 'warranty',
      status: 'warranty',
    })
    await store.transitionAcceptance(acceptance.id, 'expired')
    expect(await loadOwnerDocumentForm('acceptance', acceptance.id)).toMatchObject({
      type: 'warranty',
      status: 'expired',
    })
    expect(await loadOwnerDocumentForm('final_settlement', finalSettlement.id)).toMatchObject({
      settlementAmount: 1180,
      changedContractAmount: 1250,
      receivedAmount: 320,
      settlementReceiptGap: 860,
    })
    expect(await loadOwnerDocumentForm('owner_penalty', ownerPenalty.id)).toMatchObject({
      noticeNo: 'LX-001',
      amount: 10,
    })
    expect(await listOwnerDocumentForms('owner_penalty')).toEqual([
      expect.objectContaining({
        id: ownerPenalty.id,
        noticeNo: 'LX-001',
      }),
    ])
    expect(await loadOwnerDocumentForm('sub_change', subChange.id)).toMatchObject({
      supplierId: 'supplier-sub',
      contractId: 'contract-sub',
    })
    expect(await loadOwnerDocumentForm('sub_settlement', subSettlement.id)).toMatchObject({
      sourceTable: 'expenditure_settlements',
      bizType: '分包',
      totalAmount: 100,
    })
    expect(await loadOwnerDocumentForm('project_penalty', penalty.id)).toMatchObject({
      amount: 20,
      deductedAmount: 0,
      remainingDeductionAmount: 20,
    })

    await store.deductProjectPenalty(penalty.id, subSettlement.id, 20, '本期结算抵扣')
    expect(await loadPenaltyDeductions(penalty.id)).toEqual([
      expect.objectContaining({
        settlementId: subSettlement.id,
        settlementNo: 'FBJS-001',
        amount: 20,
      }),
    ])
    expect(await loadOwnerDocumentForm('project_penalty', penalty.id)).toMatchObject({
      status: 'deducted',
      deductedAmount: 20,
      remainingDeductionAmount: 0,
    })
    await expect(
      store.deductProjectPenalty(penalty.id, subSettlement.id, 1),
    ).rejects.toThrow()
    await expect(store.removeForm('sub_settlement', subSettlement.id))
      .rejects
      .toThrow('只有草稿或已退回单据可以删除')
    await expect(store.removeForm('project_penalty', penalty.id))
      .rejects
      .toThrow('只有草稿或已退回单据可以删除')

    await expect(store.saveForm('sub_settlement', {
      no: 'FBJS-BAD',
      name: '错误分供方结算',
      projectId: 'project-owner',
      supplierId: 'supplier-other',
      contractId: 'contract-sub',
      totalAmount: 10,
      settlementDate: '2026-07-26',
    }, 'submit')).rejects.toThrow('分供方')
  })

  it('草稿可在原单继续编辑，列表和软删除恢复使用同一真实记录', async () => {
    const store = useOwnerDocumentStore()
    const created = await store.saveForm('acceptance', {
      no: 'YS-DRAFT-001',
      type: 'acceptance',
      name: '待完善验收',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentDate: '2026-07-26',
    }, 'draft')

    const updated = await store.saveForm('acceptance', {
      id: created.id,
      no: 'YS-DRAFT-001',
      type: 'warranty',
      name: '保修移交',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentDate: '2026-07-27',
      warrantyOwner: '王工',
    }, 'draft')

    expect(updated.id).toBe(created.id)
    expect(await loadOwnerDocumentForm('acceptance', created.id)).toMatchObject({
      type: 'warranty',
      name: '保修移交',
      status: 'draft',
      warrantyOwner: '王工',
    })
    expect(await listOwnerDocumentForms('acceptance')).toEqual([
      expect.objectContaining({
        id: created.id,
        no: 'YS-DRAFT-001',
        name: '保修移交',
        status: 'draft',
      }),
    ])

    expect(await store.removeForm('acceptance', created.id)).toEqual(expect.any(String))
    expect(await listOwnerDocumentForms('acceptance')).toEqual([])
    expect(await store.restoreForm('acceptance', created.id)).toEqual(expect.any(String))
    expect(await listOwnerDocumentForms('acceptance')).toHaveLength(1)
    await store.saveForm('acceptance', {
      id: created.id,
      no: 'YS-DRAFT-001',
      type: 'warranty',
      name: '保修移交',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentDate: '2026-07-27',
      warrantyOwner: '王工',
    }, 'submit')
    await expect(store.removeForm('acceptance', created.id))
      .rejects
      .toThrow('只有草稿或已退回单据可以删除')
  })

  it('草稿合同不进入候选，伪造合同 ID 也不能保存业务单据', async () => {
    await mem.execute(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, supplier_id, amount, status
      )
      VALUES
        (
          'contract-owner-draft', 'SG-DRAFT', '草稿施工合同', '施工',
          'project-owner', NULL, 100, 'draft'
        ),
        (
          'contract-sub-draft', 'FB-DRAFT', '草稿分包合同', '分包',
          'project-owner', 'supplier-sub', 80, '草稿'
        )
    `)

    expect(await listOwnerDocumentContractOptions(
      'project-owner',
      'owner',
      '',
      '草稿',
    )).toEqual([])
    expect(await listOwnerDocumentContractOptions(
      'project-owner',
      'expenditure',
      'supplier-sub',
      '草稿',
    )).toEqual([])

    const store = useOwnerDocumentStore()
    await expect(store.saveForm('acceptance', {
      name: '伪造草稿合同验收',
      projectId: 'project-owner',
      contractId: 'contract-owner-draft',
      documentDate: '2026-07-30',
    }, 'submit')).rejects.toThrow('草稿合同不能用于业务单据')
    await expect(store.saveForm('sub_settlement', {
      name: '伪造草稿合同结算',
      projectId: 'project-owner',
      supplierId: 'supplier-sub',
      contractId: 'contract-sub-draft',
      totalAmount: 10,
      settlementDate: '2026-07-30',
    }, 'submit')).rejects.toThrow('草稿合同不能用于业务单据')

    expect(ownerDocumentStatusIsEditable('draft')).toBe(true)
    expect(ownerDocumentStatusIsEditable('rejected')).toBe(true)
    expect(ownerDocumentStatusIsEditable('confirmed')).toBe(false)
    expect(ownerDocumentStatusIsEditable('deducted')).toBe(false)
  })

  it('甲方变更、月度报量与项目罚扣草稿允许缺少项目、合同和必填业务字段', async () => {
    const store = useOwnerDocumentStore()
    const change = await store.saveForm('owner_change', {
      note: '待选择项目与合同',
      lines: [],
    }, 'draft')
    const report = await store.saveForm('owner_report', {
      note: '待选择报量期次',
      lines: [],
    }, 'draft')
    const penalty = await store.saveForm('project_penalty', {
      note: '待补罚扣信息',
    }, 'draft')

    expect(await loadOwnerDocumentForm('owner_change', change.id)).toMatchObject({
      projectId: null,
      contractId: null,
      status: 'draft',
      note: '待选择项目与合同',
    })
    expect(await loadOwnerDocumentForm('owner_report', report.id)).toMatchObject({
      projectId: null,
      contractId: null,
      status: 'draft',
      note: '待选择报量期次',
    })
    expect(await loadOwnerDocumentForm('project_penalty', penalty.id)).toMatchObject({
      projectId: null,
      status: 'draft',
      note: '待补罚扣信息',
    })

    const converted = await store.saveForm('owner_change', {
      id: change.id,
      name: '草稿完善为量价变更',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      applicationDate: '2026-07-26',
      reason: '补齐后提交',
      lines: [{
        operation: 'qty',
        boqLineId: 'boq-line-owner',
        itemName: '墙砖铺贴',
        deltaQty: 1,
      }],
    }, 'submit')
    expect(converted.id).toBe(change.id)
    expect(await loadOwnerDocumentForm('owner_change', change.id)).toMatchObject({
      name: '草稿完善为量价变更',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      status: 'submitted',
      lines: [expect.objectContaining({ boqLineId: 'boq-line-owner' })],
    })
    expect(await mem.select(`
      SELECT deleted_at
      FROM owner_change_orders
      WHERE id = ?
    `, [change.id])).toEqual([
      expect.objectContaining({ deleted_at: expect.any(String) }),
    ])
  })

  it('甲方变更与月度报量草稿在原单替换明细后提交，不复制业务单据', async () => {
    const store = useOwnerDocumentStore()
    const change = await store.saveForm('owner_change', {
      no: 'BQ-DRAFT-001',
      name: '草稿变更',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentType: 'change_negotiation',
      lines: [{
        operation: 'qty',
        boqLineId: 'boq-line-owner',
        itemName: '墙砖铺贴',
        unit: '㎡',
        deltaQty: 1,
      }],
    }, 'draft')
    const changed = await store.saveForm('owner_change', {
      id: change.id,
      no: 'BQ-DRAFT-001',
      name: '草稿变更已完善',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      documentType: 'site_visa',
      reason: '现场增量',
      lines: [{
        operation: 'qty',
        boqLineId: 'boq-line-owner',
        itemName: '墙砖铺贴',
        unit: '㎡',
        deltaQty: 3,
      }],
    }, 'submit')

    expect(changed.id).toBe(change.id)
    expect(await loadOwnerDocumentForm('owner_change', change.id)).toMatchObject({
      name: '草稿变更已完善',
      documentType: 'site_visa',
      status: 'submitted',
      totalAmount: 60,
      lines: [expect.objectContaining({ deltaQty: 3, amount: 60 })],
    })
    expect(await mem.select(`
      SELECT COUNT(*) AS count
      FROM boq_change_orders
      WHERE code = 'BQ-DRAFT-001' AND deleted_at IS NULL
    `)).toEqual([{ count: 1 }])

    const report = await store.saveForm('owner_report', {
      no: 'BL-DRAFT-001',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      periodNo: '2026-08',
      lines: [{
        boqLineId: 'boq-line-owner',
        itemName: '墙砖铺贴',
        unit: '㎡',
        autoQty: 999,
        reportedQty: 2,
        unitPrice: 20,
      }],
    }, 'draft')
    await expect(store.auditOwnerReport(report.id, {
      auditedAmount: 0,
      lines: [],
    })).rejects.toThrow('只有已申报')
    const reported = await store.saveForm('owner_report', {
      id: report.id,
      no: 'BL-DRAFT-001',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      periodNo: '2026-08',
      applicationDate: '2026-08-25',
      lines: [{
        boqLineId: 'boq-line-owner',
        itemName: '墙砖铺贴',
        unit: '㎡',
        autoQty: 999,
        reportedQty: 1.5,
        unitPrice: 20,
      }],
    }, 'submit')

    expect(reported.id).toBe(report.id)
    expect(await loadOwnerDocumentForm('owner_report', report.id)).toMatchObject({
      status: 'reported',
      reportedAmount: 30,
      lines: [expect.objectContaining({ autoQty: 0, reportedQty: 1.5, amount: 30 })],
    })
    expect(await mem.select(`
      SELECT COUNT(*) AS count
      FROM monthly_statements
      WHERE contract_id = 'contract-owner' AND month = '2026-08' AND deleted_at IS NULL
    `)).toEqual([{ count: 1 }])
  })
})
