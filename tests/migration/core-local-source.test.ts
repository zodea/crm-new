import type { CoreMigrationLocalSourceDependencies } from '~/lib/migration/core-local-source'
import { describe, expect, it, vi } from 'vitest'
import { LATEST_VERSION, runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  CORE_MIGRATION_TOPOLOGY,
} from '~/lib/migration/core-contract'
import { createCoreMigrationLocalSource } from '~/lib/migration/core-local-source'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { createMemoryDb } from '../helpers/memory-db'

function sourceRows(sql: string): Record<string, unknown>[] {
  if (sql.includes('\'other_expense\' auxiliary_kind') || sql.includes('\'company_expense\' auxiliary_kind'))
    return []
  if (sql.includes('FROM penalty_records penalty'))
    return []
  if (sql.includes('FROM customers')) {
    return [
      { id: 'customer-local-1', name: '本地客户' },
      { id: 'customer_demo_001', name: '随包测试客户' },
    ]
  }
  if (sql.includes('FROM suppliers'))
    return [{ id: 'supplier-local-1', name: '本地分供方', deleted_at: null }]
  if (sql.includes('FROM crews'))
    return [{ id: 'crew-local-1', name: '本地班组', deleted_at: null }]
  if (sql.includes('FROM projects')) {
    return [{
      id: 'project-local-1',
      name: '本地项目',
      customer_id: 'customer-local-1',
      secondary_customer_id: null,
      area: 12.5,
      contract_amount: 100,
      deleted_at: null,
    }]
  }
  if (sql.includes('WHERE c.kind = \'分包\'')) {
    return [{
      id: 'subcontract-local-1',
      no: 'FB-001',
      name: '既有分包合同',
      sub_kind: '劳务',
      project_id: 'project-local-1',
      supplier_id: 'supplier-local-1',
      content: '存量正式分包合同',
      amount: 180000,
      status: '履约中',
      settlement_status: null,
      clearance_status: null,
      sign_date: '2026-02-01',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-08-24T00:00:00.000Z',
      deleted_at: null,
    }]
  }
  if (sql.includes('FROM contract_supplements')) {
    return [{
      id: 'supplement-local-1',
      contract_id: 'construction-local-1',
      no: 'BC-001',
      name: '既有补充协议',
      content: '补充施工范围',
      amount: 8000,
      sign_date: '2026-03-01',
      status: '有效',
      external_ref: 'legacy-bc-001',
      note: '',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-08-24T00:00:00.000Z',
      deleted_at: null,
    }]
  }
  if (sql.includes('FROM receipt_registrations')) {
    return [{
      id: 'receipt-local-1',
      no: 'SK-LOCAL-001',
      receipt_date: '2026-05-01',
      project_id: 'project-local-1',
      contract_id: 'construction-local-1',
      customer_id: 'customer-local-1',
      payer_account: '本地客户',
      amount: 90000,
      payment_method: '银行转账',
      review_status: 'approved',
      status: 'submitted',
      note: '',
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
      deleted_at: null,
    }]
  }
  if (sql.includes('FROM boq_change_orders change_order')) {
    return [
      {
        id: 'change-local-1',
        name: '既有甲方变更',
        project_id: 'project-local-1',
        contract_id: 'construction-local-1',
        amount: 520,
        audited_amount: null,
        tax_exclusive_amount: 480,
        applied_tax_exclusive_amount: 500,
        kind: 'owner_change',
        no: 'BG-LOCAL-001',
        document_type: 'change_negotiation',
        source_type: 'boq_change_order',
        source_locked: 1,
        period_no: '',
        application_date: '2026-04-02',
        status: 'approved',
        status_note: '甲方已签证',
        note: '',
        lines_json: '[{"id":"change-line-local-1","boqLineId":"boq-line-local-1","operation":"qty","itemName":"桥架安装","unit":"m","contractQty":100,"contractUnitPrice":52,"deltaQty":10,"amount":520}]',
        files_json: '[]',
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-02T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'report-local-1',
        name: '2026-06月度报量',
        project_id: 'project-local-1',
        contract_id: 'construction-local-1',
        amount: 4960,
        audited_amount: 4680,
        kind: 'owner_report',
        no: 'BL-LOCAL-001',
        document_type: 'monthly_statement',
        source_type: 'monthly_statement',
        source_locked: 1,
        period_no: '2026-06',
        application_date: '2026-07-01',
        status: 'exported',
        status_note: '甲方已审定',
        note: '',
        lines_json: '[]',
        files_json: '[]',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-03T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'owner-penalty-local-1',
        name: '施工进度延误',
        project_id: 'project-local-1',
        contract_id: 'construction-local-1',
        amount: 36000,
        audited_amount: null,
        tax_exclusive_amount: null,
        applied_tax_exclusive_amount: null,
        kind: 'owner_penalty',
        no: 'FK-LOCAL-001',
        document_type: 'owner_penalty',
        source_type: 'owner_penalty',
        source_locked: 1,
        period_no: '',
        application_date: '2026-08-24',
        status: 'submitted',
        status_note: '已提交甲方罚扣事实',
        note: '项目部已核对',
        lines_json: '[]',
        files_json: '[{"id":"file-owner-penalty-local-1","fileName":"甲方联系单.pdf","fileSize":326,"mimeType":"application/pdf","category":"contact-letter","uploader":"周经办","uploadedAt":"2026-08-24T10:00:00.000Z","deletedAt":null}]',
        notice_no: 'LX-LOCAL-001',
        penalty_reason: '施工进度延误',
        appeal_note: '已提交工期顺延说明',
        created_at: '2026-08-24T00:00:00.000Z',
        updated_at: '2026-08-24T10:00:00.000Z',
        deleted_at: null,
      },
    ]
  }
  if (sql.includes('FROM contracts c')) {
    return [{
      id: 'construction-local-1',
      no: 'SG-001',
      name: '既有施工合同',
      project_id: 'project-local-1',
      customer_id: 'customer-local-1',
      content: '存量正式合同',
      amount: 320000,
      status: '履约中',
      sign_date: '2026-01-01',
      actual_completion_date: null,
      boq_catalog_json: '[{"id":"boq-line-without-history","itemName":"未变更管线","unit":"m","qty":40,"unitPrice":30}]',
      monthly_quantity_facts_json: '[{"periodNo":"2026-09","boqLineId":"boq-line-without-history","autoQty":12,"missingQtyCount":0,"quantityBasis":"field","sourceVersion":"migration-field-2026-09-v1","sourceUpdatedAt":"2026-09-20T08:00:00.000Z"}]',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-08-24T00:00:00.000Z',
      deleted_at: null,
    }]
  }
  if (sql.includes('FROM workers')) {
    return [{
      id: 'worker-local-1',
      name: '本地工人',
      crew_id: 'crew-local-1',
      current_project_id: 'project-local-1',
      deleted_at: null,
    }]
  }
  if (sql.includes('FROM project_suppliers')) {
    return [{
      id: 'project-supplier-local-1',
      project_id: 'project-local-1',
      supplier_id: 'supplier-local-1',
      deleted_at: null,
    }]
  }
  throw new Error(`unexpected SQL: ${sql}`)
}

function dependencies(
  overrides: Partial<CoreMigrationLocalSourceDependencies> = {},
): CoreMigrationLocalSourceDependencies {
  return {
    isNative: () => false,
    isDemoActive: () => false,
    currentSchemaVersion: vi.fn().mockResolvedValue(LATEST_VERSION),
    select: vi.fn(async (sql: string) => sourceRows(sql)),
    closeDatabase: vi.fn().mockResolvedValue(undefined),
    loadProductionSnapshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    readSnapshotSource: vi.fn().mockRejectedValue(new Error('snapshot source not configured')),
    createBackup: vi.fn().mockResolvedValue({
      backupId: 'core-source-hash',
      createdAt: '2026-08-15T01:00:00.000Z',
      sourceSchemaVersion: LATEST_VERSION,
      sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
      sourceHash: 'a'.repeat(64),
      snapshotSha256: 'b'.repeat(64),
      immutable: true,
      snapshotKey: 'production',
      byteLength: 3,
    }),
    loadBackup: vi.fn().mockResolvedValue(null),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    activateMigration: vi.fn().mockResolvedValue(undefined),
    clearMigration: vi.fn().mockResolvedValue(undefined),
    prepareMigration: vi.fn().mockResolvedValue(undefined),
    loadMigrationMarker: vi.fn().mockResolvedValue(null),
    loadPendingMigrationMarker: vi.fn().mockResolvedValue(null),
    now: () => '2026-08-15T01:00:00.000Z',
    ...overrides,
  }
}

describe('core migration local source', () => {
  it('aX03 从受保护旧库读取项目罚扣及独立抵扣，保留原始身份', async () => {
    const deps = dependencies({ select: async (sql: string) => {
      if (sql.includes('FROM penalty_records penalty'))
        return [{ id: 'p329', name: '历史罚扣', project_id: 'project-local-1', contract_id: 'subcontract-local-1', supplier_id: 'supplier-local-1', crew_id: 'crew-local-1', kind: 'project_penalty', source_type: 'penalty_record', amount: 1000, status: 'pending', rectification_note: '已安排整改', deadline: '2026-09-10', penalty_deductions_json: '[{"id":"d329","settlementId":"s329","amount":400,"occurredAt":"2026-09-01T00:00:00.000Z"}]' }] as any
      return sourceRows(sql) as any
    } })
    const result = await createCoreMigrationLocalSource(deps).readSource()
    expect(result.entities.owner_documents).toContainEqual(expect.objectContaining({ legacyId: 'p329', references: { projectId: 'project-local-1', contractId: 'subcontract-local-1', supplierId: 'supplier-local-1', crewId: 'crew-local-1' }, attributes: expect.objectContaining({ rectificationNote: '已安排整改', penaltyDeductionsJson: expect.stringContaining('s329') }) }))
  })
  it('与当前本地库最新 schema 版本保持同步', () => {
    expect(CORE_MIGRATION_SOURCE_VERSION).toBe(`sqlite-v${LATEST_VERSION}`)
  })

  it('构建确定性正式拓扑，不按与 demo 相同的 ID 猜测来源', async () => {
    const source = createCoreMigrationLocalSource(dependencies())

    const first = await source.readSource()
    const second = await source.readSource()

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
      mode: CORE_MIGRATION_SOURCE_MODE,
      sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
      expectations: {
        counts: {
          customers: 2,
          suppliers: 1,
          crews: 1,
          projects: 1,
          construction_contracts: 1,
          subcontract_contracts: 1,
          contract_supplements: 1,
          receipt_registrations: 1,
          owner_documents: 3,
          workers: 1,
          project_suppliers: 1,
        },
        totals: [
          { entityType: 'projects', metric: 'quantity', expected: 12.5 },
          { entityType: 'projects', metric: 'amount', expected: '100.00' },
          { entityType: 'construction_contracts', metric: 'amount', expected: '320000.00' },
          { entityType: 'subcontract_contracts', metric: 'amount', expected: '180000.00' },
          { entityType: 'contract_supplements', metric: 'amount', expected: '8000.00' },
          { entityType: 'receipt_registrations', metric: 'amount', expected: '90000.00' },
          { entityType: 'owner_documents', metric: 'amount', expected: '41480.00' },
        ],
      },
    })
    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.entities.customers).toEqual([
      { legacyId: 'customer-local-1', name: '本地客户', deletedAt: null },
      { legacyId: 'customer_demo_001', name: '随包测试客户', deletedAt: null },
    ])
    expect(first.entities.projects[0]).toEqual({
      legacyId: 'project-local-1',
      name: '本地项目',
      references: {
        customerId: 'customer-local-1',
        secondaryCustomerId: null,
      },
      quantity: 12.5,
      amount: '100.00',
      deletedAt: null,
    })
    expect(first.entities.project_suppliers[0]).toEqual({
      legacyId: 'project-supplier-local-1',
      name: 'project-local-1 × supplier-local-1',
      references: {
        projectId: 'project-local-1',
        supplierId: 'supplier-local-1',
      },
      deletedAt: null,
    })
    expect(first.entities.construction_contracts[0]).toMatchObject({
      legacyId: 'construction-local-1',
      references: { projectId: 'project-local-1', customerId: 'customer-local-1' },
      amount: '320000.00',
      attributes: {
        no: 'SG-001',
        signDate: '2026-01-01',
        actualCompletionDate: null,
        boqCatalogJson: '[{"id":"boq-line-without-history","itemName":"未变更管线","unit":"m","qty":40,"unitPrice":30}]',
        monthlyQuantityFactsJson: '[{"periodNo":"2026-09","boqLineId":"boq-line-without-history","autoQty":12,"missingQtyCount":0,"quantityBasis":"field","sourceVersion":"migration-field-2026-09-v1","sourceUpdatedAt":"2026-09-20T08:00:00.000Z"}]',
      },
    })
    expect(first.entities.subcontract_contracts[0]).toMatchObject({
      legacyId: 'subcontract-local-1',
      references: { projectId: 'project-local-1', supplierId: 'supplier-local-1' },
      amount: '180000.00',
      attributes: { no: 'FB-001', subKind: '劳务', settlementStatus: null, clearanceStatus: null },
    })
    expect(first.entities.contract_supplements[0]).toMatchObject({
      legacyId: 'supplement-local-1',
      references: { contractId: 'construction-local-1' },
      amount: '8000.00',
      attributes: { no: 'BC-001', signDate: '2026-03-01', status: '有效' },
    })
    expect(first.entities.receipt_registrations[0]).toMatchObject({
      legacyId: 'receipt-local-1',
      references: {
        projectId: 'project-local-1',
        contractId: 'construction-local-1',
        customerId: 'customer-local-1',
      },
      amount: '90000.00',
      attributes: { no: 'SK-LOCAL-001', receiptDate: '2026-05-01', status: 'submitted' },
    })
    expect(first.entities.owner_documents).toEqual([
      expect.objectContaining({
        legacyId: 'change-local-1',
        references: { projectId: 'project-local-1', contractId: 'construction-local-1' },
        amount: '520.00',
        attributes: expect.objectContaining({
          kind: 'owner_change',
          sourceType: 'boq_change_order',
          sourceLocked: 1,
          taxExclusiveAmount: 480,
          appliedTaxExclusiveAmount: 500,
        }),
      }),
      expect.objectContaining({
        legacyId: 'owner-penalty-local-1',
        name: '施工进度延误',
        amount: '36000.00',
        attributes: expect.objectContaining({
          kind: 'owner_penalty',
          sourceType: 'owner_penalty',
          noticeNo: 'LX-LOCAL-001',
          penaltyReason: '施工进度延误',
          appealNote: '已提交工期顺延说明',
          filesJson: expect.stringContaining('甲方联系单.pdf'),
        }),
      }),
      expect.objectContaining({
        legacyId: 'report-local-1',
        amount: '4960.00',
        attributes: expect.objectContaining({
          kind: 'owner_report',
          auditedAmount: 4680,
        }),
      }),
    ])
    expect(Object.values(first.entities).flat().map(row => row.legacyId))
      .toContain('customer_demo_001')
  })

  it('保留分包变洽签缺失分供方的显式空关系供 dry-run 阻断', async () => {
    const deps = dependencies({
      select: vi.fn(async (sql: string) => {
        if (sql.includes('FROM boq_change_orders change_order')) {
          return [{
            id: 'sub-change-missing-supplier-327',
            name: '缺失分供方的分包变洽签',
            project_id: 'project-local-1',
            contract_id: 'subcontract-local-1',
            supplier_id: null,
            amount: 38000,
            kind: 'sub_change',
            no: 'FB-MISSING-327',
            document_type: '增项',
            source_type: 'subcontract_change_order',
            status: 'submitted',
            lines_json: '[]',
            files_json: '[]',
            deleted_at: null,
          }]
        }
        return sourceRows(sql)
      }),
    })

    const migrationSource = await createCoreMigrationLocalSource(deps).readSource()

    expect(migrationSource.entities.owner_documents[0]?.references).toEqual({
      projectId: 'project-local-1',
      contractId: 'subcontract-local-1',
      supplierId: null,
    })
  })

  it('迁移已签证新增项时优先导出结果 BOQ 稳定 ID 与结果量价', async () => {
    const deps = dependencies()
    const source = createCoreMigrationLocalSource(deps)

    await source.readSource()

    const ownerQuery = vi.mocked(deps.select).mock.calls.map(([sql]) => sql).find(sql => sql.includes('FROM boq_change_orders change_order'))
    expect(ownerQuery).toContain('\'boqLineId\', COALESCE(change_line.result_boq_line_id, change_line.boq_line_id)')
    expect(ownerQuery).toContain('LEFT JOIN boq_lines boq_line ON boq_line.id = COALESCE(change_line.result_boq_line_id, change_line.boq_line_id)')
    expect(ownerQuery).toContain('FROM owner_penalties penalty')
  })

  it('施工合同快照同时导出完整 BOQ 目录与无单据新期次完成量事实', async () => {
    const deps = dependencies()
    await createCoreMigrationLocalSource(deps).readSource()

    const contractQuery = vi.mocked(deps.select).mock.calls.map(([sql]) => sql).find(sql => sql.includes('WHERE c.kind = \'施工\''))
    expect(contractQuery).toContain('boq_catalog_json')
    expect(contractQuery).toContain('monthly_quantity_facts_json')
    expect(contractQuery).toContain('FROM unit_stage_completions usc')
    expect(contractQuery).toContain('substr(usc.completed_at, 1, 7)')
  })

  it('完整 BOQ 与月度事实查询可在最新 SQLite schema 上执行', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
      await seedIfEmpty(db)

      const result = await createCoreMigrationLocalSource(dependencies({
        select: async sql => sql.includes('FROM boq_change_orders change_order')
          ? []
          : db.select(sql),
      })).readSource()
      const constructionContract = result.entities.construction_contracts
        .find(row => row.legacyId === 'con_demo_sg01')

      expect(constructionContract).toBeDefined()
      expect(JSON.parse(String(constructionContract?.attributes?.boqCatalogJson)))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'boq_line_demo_a_pipe', itemName: '给排水管安装' }),
        ]))
      expect(JSON.parse(String(constructionContract?.attributes?.monthlyQuantityFactsJson)))
        .toEqual(expect.any(Array))
    }
    finally {
      db.close()
    }
  })

  it('sqlite 本地写入时间经 ISO 规范化后可完成甲方单据受控迁移', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
      await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-local-323', '迁移甲方')`)
      await db.execute(`
        INSERT INTO projects (id, name, customer_id)
        VALUES ('project-local-323', '迁移项目', 'customer-local-323')
      `)
      await db.execute(`
        INSERT INTO contracts (id, no, name, kind, project_id, customer_id, status)
        VALUES (
          'contract-local-323', 'SG-LOCAL-323', '迁移施工合同', '施工',
          'project-local-323', 'customer-local-323', '履约中'
        )
      `)
      await db.execute(`
        INSERT INTO boq_files (id, contract_id, file_name, parse_status)
        VALUES ('boq-file-local-323', 'contract-local-323', '迁移清单.xlsx', 'parsed')
      `)
      await db.execute(`
        INSERT INTO boq_lines (
          id, boq_file_id, project_id, contract_id, item_name, unit, qty, unit_price, sort_order
        )
        VALUES (
          'boq-line-local-323', 'boq-file-local-323', 'project-local-323', 'contract-local-323',
          '给排水管安装', 'm', 100, 52, 1
        )
      `)
      await db.execute(`INSERT INTO crews (id, name) VALUES ('crew-local-323', '迁移班组')`)
      await db.execute(`
        INSERT INTO buildings (id, project_id, code, name)
        VALUES ('building-local-323', 'project-local-323', '1', '1栋')
      `)
      await db.execute(`
        INSERT INTO floors (id, building_id, code, name)
        VALUES ('floor-local-323', 'building-local-323', '1', '1层')
      `)
      await db.execute(`
        INSERT INTO house_type_templates (id, project_id, code, name)
        VALUES ('template-local-323', 'project-local-323', 'A', 'A户型')
      `)
      await db.execute(`
        INSERT INTO units (id, floor_id, house_type_template_id, code, name)
        VALUES ('unit-local-323', 'floor-local-323', 'template-local-323', '101', '101户')
      `)
      await db.execute(`
        INSERT INTO rooms (id, template_id, code, name)
        VALUES ('room-local-323', 'template-local-323', 'kitchen', '厨房')
      `)
      await db.execute(`
        INSERT INTO items (id, project_id, code, name, trade, unit)
        VALUES ('item-local-323', 'project-local-323', 'W001', '给排水管安装', '给排水', 'm')
      `)
      await db.execute(`
        INSERT INTO house_type_template_items (
          id, room_id, item_id, field_qty, boq_line_id, sort_order
        )
        VALUES (
          'template-item-local-323', 'room-local-323', 'item-local-323',
          12, 'boq-line-local-323', 1
        )
      `)
      await db.execute(`
        INSERT INTO construction_stages (id, project_id, code, name, trade)
        VALUES ('stage-local-323', 'project-local-323', 'water', '给排水安装', '给排水')
      `)
      await db.execute(`
        INSERT INTO construction_stage_items (id, stage_id, item_id, is_reporting_stage)
        VALUES ('stage-item-local-323', 'stage-local-323', 'item-local-323', 1)
      `)
      await db.execute(`
        INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
        VALUES ('assignment-local-323', 'unit-local-323', '给排水', 'crew-local-323')
      `)
      await db.execute(`
        INSERT INTO unit_stage_completions (
          id, unit_id, stage_id, assignment_id, status, completed_at
        )
        VALUES (
          'completion-local-323', 'unit-local-323', 'stage-local-323',
          'assignment-local-323', 'completed', '2026-08-24'
        )
      `)
      await db.execute(`
        INSERT INTO owner_change_orders (
          id, project_id, contract_id, change_no, name, document_type,
          application_date, approval_date, status, source_type, source_locked,
          tax_inc_amount, tax_exc_amount, applied_amount
        )
        VALUES (
          'owner-change-local-323', 'project-local-323', 'contract-local-323',
          'BG-LOCAL-323', '真实 SQLite 变洽签', 'change_negotiation',
          '2026-08-24', '2026-08-25', 'approved', 'manual', 0,
          520, 480, 500
        )
      `)
      await db.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-local-327', '迁移劳务分供方')`)
      await db.execute(`
        INSERT INTO contracts (id, no, name, kind, sub_kind, project_id, supplier_id, status)
        VALUES (
          'subcontract-local-327', 'FB-LOCAL-327', '迁移劳务分包合同', '分包', '劳务',
          'project-local-323', 'supplier-local-327', '履约中'
        )
      `)
      await db.execute(`
        INSERT INTO owner_penalties (
          id, no, project_id, contract_id, notice_no, amount,
          penalty_date, reason, appeal_note, status, note
        )
        VALUES (
          'owner-penalty-local-326', 'FK-LOCAL-326', 'project-local-323', 'contract-local-323',
          'LX-LOCAL-326', 36000, '2026-08-24', '施工进度延误',
          '已提交工期顺延说明', 'submitted', '项目部已核对'
        )
      `)
      await db.execute(`
        INSERT INTO subcontract_change_orders (
          id, no, change_type, project_id, supplier_id, contract_id,
          change_date, approved_amount, changed_area, actual_approved_price,
          reason, status, note
        )
        VALUES (
          'sub-change-local-327', 'FB-BG-LOCAL-327', '增项', 'project-local-323',
          'supplier-local-327', 'subcontract-local-327', '2026-08-27', 38000,
          120, 36000, '样板层劳务范围调整', 'submitted', '按现场确认范围执行'
        )
      `)
      await db.execute(`
        INSERT INTO file_refs (
          id, owner_type, owner_id, file_name, file_path, file_size,
          mime_type, category, uploader, uploaded_at
        )
        VALUES (
          'file-owner-penalty-local-326', 'owner_penalty', 'owner-penalty-local-326',
          '甲方联系单.pdf', '', 326, 'application/pdf', 'contact-letter', '周经办',
          '2026-08-24T10:00:00.000Z'
        )
      `)
      await db.execute(`INSERT INTO expenditure_settlements (id, no, name, biz_type, project_id, supplier_id, contract_id, settlement_type, total_amount, settlement_date, deduction_note, status)
        VALUES ('settlement-local-328', 'FBJS-328', '八月分包结算', '分包', 'project-local-323', 'supplier-local-327', 'subcontract-local-327', '过程结算', 28000, '2026-08-31', '合同扣款', 'confirmed')`)
      const [stored] = await db.select<{ created_at: string, updated_at: string }>(`
        SELECT created_at, updated_at
        FROM owner_change_orders
        WHERE id = 'owner-change-local-323'
      `)
      expect(stored?.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

      const migrationSource = await createCoreMigrationLocalSource(dependencies({
        select: sql => db.select(sql),
      })).readSource()
      const ownerDocument = migrationSource.entities.owner_documents[0]
      expect(ownerDocument?.attributes).toMatchObject({
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
      })
      expect(migrationSource.entities.owner_documents.find(row => row.legacyId === 'owner-penalty-local-326'))
        .toMatchObject({
          name: '施工进度延误',
          references: { projectId: 'project-local-323', contractId: 'contract-local-323' },
          amount: '36000.00',
          attributes: {
            kind: 'owner_penalty',
            sourceType: 'owner_penalty',
            noticeNo: 'LX-LOCAL-326',
            penaltyReason: '施工进度延误',
            appealNote: '已提交工期顺延说明',
            filesJson: expect.stringContaining('甲方联系单.pdf'),
          },
        })
      expect(migrationSource.entities.owner_documents.find(row => row.legacyId === 'sub-change-local-327'))
        .toMatchObject({
          name: '样板层劳务范围调整',
          references: {
            projectId: 'project-local-323',
            supplierId: 'supplier-local-327',
            contractId: 'subcontract-local-327',
          },
          amount: '38000.00',
          attributes: {
            kind: 'sub_change',
            sourceType: 'subcontract_change_order',
            documentType: '增项',
            changedArea: 120,
            actualApprovedPrice: 36000,
          },
        })
      const constructionContract = migrationSource.entities.construction_contracts[0]
      expect(JSON.parse(String(constructionContract?.attributes?.monthlyQuantityFactsJson)))
        .toContainEqual(expect.objectContaining({
          periodNo: '2026-08',
          boqLineId: 'boq-line-local-323',
          sourceUpdatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
        }))

      const commands = createOwnerCommercialDocumentCommandTestInstance()
      const core = createCoreMigrationTestInstance({
        createServerId: input => `central-${input.entityType}-${input.legacyId}`,
        now: () => '2026-08-25T12:00:00.000Z',
        afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
      })
      const migrationSession = {
        workspaceId: 'workspace-local-source-323',
        actorId: 'actor-local-source-323',
        capabilities: [CORE_MIGRATION_CAPABILITY, 'owner-document:read', 'owner-document:write'],
      }
      const envelope = (commandId: string) => ({
        workspaceId: migrationSession.workspaceId,
        actorId: migrationSession.actorId,
        requiredCapability: CORE_MIGRATION_CAPABILITY,
        commandId,
      })
      await core.preflight({ ...envelope('preflight-local-source-323'), source: migrationSource, backup: null }, migrationSession)
      const snapshotSha256 = 'e'.repeat(64)
      const dryRun = await core.dryRun({
        ...envelope('dry-run-local-source-323'),
        source: migrationSource,
        backup: {
          backupId: `core-migration-${migrationSource.sourceHash}-${snapshotSha256}`,
          sourceHash: migrationSource.sourceHash,
          sourceVersion: migrationSource.sourceVersion,
          snapshotSha256,
          byteLength: 323,
          createdAt: '2026-08-25T12:00:00.000Z',
          immutable: true,
        },
      }, migrationSession)
      await core.importBatch({ ...envelope('import-local-source-323'), batchId: dryRun.batchId }, migrationSession)
      await expect(core.confirm({
        ...envelope('confirm-local-source-323'),
        batchId: dryRun.batchId,
      }, migrationSession)).resolves.toMatchObject({ status: 'confirmed' })
      expect(commands.rows()).toContainEqual(expect.objectContaining({
        kind: 'owner_change',
        no: 'BG-LOCAL-323',
        name: '真实 SQLite 变洽签',
      }))
      expect(commands.rows()).toContainEqual(expect.objectContaining({
        kind: 'owner_penalty',
        no: 'FK-LOCAL-326',
        noticeNo: 'LX-LOCAL-326',
        penaltyReason: '施工进度延误',
        appealNote: '已提交工期顺延说明',
        files: [expect.objectContaining({
          id: 'file-owner-penalty-local-326',
          category: 'contact-letter',
        })],
      }))
      expect(commands.rows()).toContainEqual(expect.objectContaining({ kind: 'sub_settlement', amount: 28000, status: 'confirmed', deductionNote: '合同扣款', contractId: expect.stringContaining('subcontract-local-327') }))
      expect(commands.rows()).toContainEqual(expect.objectContaining({
        kind: 'sub_change',
        no: 'FB-BG-LOCAL-327',
        supplierId: expect.stringContaining('supplier-local-327'),
        contractId: expect.stringContaining('subcontract-local-327'),
        amount: 38000,
        changedArea: 120,
        actualApprovedPrice: 36000,
      }))
    }
    finally {
      db.close()
    }
  })

  it('遇到无法定位的正式行时显式阻断，不静默丢弃', async () => {
    const deps = dependencies({
      select: vi.fn(async (sql: string) => sql.includes('FROM customers')
        ? [{ id: '', name: '无法定位客户' }]
        : sourceRows(sql)),
    })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.readSource()).rejects.toMatchObject({
      code: 'unidentifiable-source-row',
    })
  })

  it('refuses to read the demo snapshot as a formal migration source', async () => {
    const deps = dependencies({ isDemoActive: () => true })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.readSource()).rejects.toMatchObject({
      code: 'demo-source-not-allowed',
    })
    expect(deps.select).not.toHaveBeenCalled()
  })

  it('tauri 桌面端不读取浏览器 IndexedDB 迁移源', async () => {
    const deps = dependencies({ isNative: () => true })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.readSource()).rejects.toMatchObject({ code: 'browser-only' })
    await expect(source.createBackup('a'.repeat(64))).rejects.toMatchObject({ code: 'browser-only' })
    expect(deps.select).not.toHaveBeenCalled()
    expect(deps.loadProductionSnapshot).not.toHaveBeenCalled()
  })

  it('flushes the production connection before creating an immutable backup', async () => {
    const events: string[] = []
    const protectedSource = await createCoreMigrationLocalSource(dependencies()).readSource()
    const deps = dependencies({
      closeDatabase: vi.fn(async () => {
        events.push('close')
      }),
      loadProductionSnapshot: vi.fn(async () => {
        events.push('snapshot')
        return new Uint8Array([1, 2, 3])
      }),
      readSnapshotSource: vi.fn(async () => {
        events.push('decode-snapshot')
        return protectedSource
      }),
      createBackup: vi.fn(async (input) => {
        events.push('backup')
        return {
          ...input,
          immutable: true as const,
          snapshotKey: 'production' as const,
          byteLength: input.snapshot.byteLength,
        }
      }),
    })
    const source = createCoreMigrationLocalSource(deps)

    const backup = await source.createBackup(protectedSource.sourceHash)

    expect(events).toEqual(['close', 'snapshot', 'decode-snapshot', 'backup'])
    expect(backup.backupId).toMatch(
      new RegExp(`^core-migration-${protectedSource.sourceHash}-[a-f0-9]{64}$`),
    )
    expect(deps.createBackup).toHaveBeenCalledWith({
      backupId: expect.stringMatching(
        new RegExp(`^core-migration-${protectedSource.sourceHash}-[a-f0-9]{64}$`),
      ),
      createdAt: '2026-08-15T01:00:00.000Z',
      sourceSchemaVersion: LATEST_VERSION,
      sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
      sourceHash: protectedSource.sourceHash,
      snapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      snapshot: new Uint8Array([1, 2, 3]),
    })
  })

  it('备份字节解析的来源与预检不同时拒绝绑定', async () => {
    const initial = await createCoreMigrationLocalSource(dependencies()).readSource()
    const changed = { ...initial, sourceHash: 'c'.repeat(64) }
    const deps = dependencies({
      readSnapshotSource: vi.fn().mockResolvedValue(changed),
    })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.createBackup(initial.sourceHash)).rejects.toMatchObject({
      code: 'source-changed-after-preflight',
    })
    expect(deps.createBackup).not.toHaveBeenCalled()
  })

  it('导入与确认前重新读取 production，来源变化时阻断旧批次', async () => {
    const initial = await createCoreMigrationLocalSource(dependencies()).readSource()
    const changed = { ...initial, sourceHash: 'c'.repeat(64) }
    const deps = dependencies({
      loadProductionSnapshot: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      readSnapshotSource: vi.fn().mockResolvedValue(changed),
    })
    const source = createCoreMigrationLocalSource(deps)

    await expect(source.assertCurrentSource(initial.sourceHash, 'b'.repeat(64))).rejects.toMatchObject({
      code: 'source-changed-after-preflight',
    })
    expect(deps.closeDatabase).toHaveBeenCalledOnce()
  })

  it('locks the old source only after confirmation and restores the protected backup on rollback', async () => {
    const events: string[] = []
    const deps = dependencies({
      closeDatabase: vi.fn(async () => events.push('close')),
      loadBackup: vi.fn().mockResolvedValue({
        metadata: {
          backupId: 'core-source-hash',
          createdAt: '2026-08-15T01:00:00.000Z',
          sourceSchemaVersion: LATEST_VERSION,
          sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
          sourceHash: 'a'.repeat(64),
          snapshotSha256: 'b'.repeat(64),
          immutable: true,
          snapshotKey: 'production',
          byteLength: 3,
        },
        snapshot: new Uint8Array([1, 2, 3]),
      }),
      readSnapshotSource: vi.fn().mockResolvedValue({
        contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
        mode: CORE_MIGRATION_SOURCE_MODE,
        sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
        sourceHash: 'a'.repeat(64),
        entities: Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(type => [type, []])),
      }),
      restoreBackup: vi.fn(async id => events.push(`restore:${id}`)),
      activateMigration: vi.fn(async marker => events.push(`activate:${marker.batchId}`)),
      clearMigration: vi.fn(async () => events.push('clear')),
      prepareMigration: vi.fn(async marker => events.push(`prepare:${marker.batchId}`)),
    })
    const source = createCoreMigrationLocalSource(deps)

    await source.confirmSwitch({
      batchId: 'batch-1',
      backupId: 'core-source-hash',
      sourceHash: 'a'.repeat(64),
      confirmedAt: '2026-08-15T01:00:00.000Z',
      rollbackExpiresAt: '2026-08-22T01:00:00.000Z',
    })
    await source.rollback('core-source-hash', 'a'.repeat(64))

    expect(events).toEqual([
      'close',
      'activate:batch-1',
      'close',
      'restore:core-source-hash',
      'clear',
    ])
  })

  it('queries every entity in the declared topology', async () => {
    const deps = dependencies()
    const source = createCoreMigrationLocalSource(deps)

    const result = await source.readSource()

    expect(Object.keys(result.entities)).toEqual([
      'customers',
      'suppliers',
      'crews',
      'projects',
      'construction_contracts',
      'subcontract_contracts',
      'auxiliary_contracts',
      'contract_supplements',
      'receipt_registrations',
      'owner_documents',
      'workers',
      'project_suppliers',
    ])
  })
})
