import type {
  BrowserCoreMigrationMarker,
  BrowserCoreMigrationPendingMarker,
  BrowserDatabaseBackupMetadata,
} from '../db/browser-storage'
import type {
  CoreMigrationEntityType,
  CoreMigrationSourceDTO,
  CoreMigrationSourceEntitiesDTO,
  CoreMigrationSourceEntityDTO,
  CoreMigrationTotalExpectationDTO,
} from './core-contract'
import { CREW_PAYROLL_FEE_FIELDS, crewPayrollFeeAttributes } from '../crew-worker/payroll-fee-defaults'
import {
  activateBrowserCoreMigration,
  clearBrowserCoreMigration,
  createBrowserDatabaseBackup,
  loadBrowserCoreMigrationMarker,
  loadBrowserCoreMigrationPendingMarker,
  loadBrowserDatabase,
  loadBrowserDatabaseBackup,
  prepareBrowserCoreMigration,
  restoreBrowserDatabaseBackup,
} from '../db/browser-storage'
import { closeDb, getDb } from '../db/connection'
import { getCurrentVersion } from '../db/migrations'
import { openBrowserSqlite } from '../db/sqljs'
import { assertQuotationCoreMigrationGate } from '../material-quotation/migration-gate'
import { quantityMigrationTimestamp } from '../quantity/migration-graph'
import { readQuantityMigrationGraphs } from '../quantity/migration-source'
import { AUXILIARY_CONTRACT_SOURCE_SQL, auxiliaryContractSourceEntity, COMPANY_CONTRACT_SOURCE_SQL } from './auxiliary-contract-source'
import {
  compareCanonicalText,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_TOPOLOGY,
  coreMigrationCentsToMoney,
  coreMigrationMoneyToCents,
  coreMigrationSourceHashInput,
  isCoreMigrationMoney,
} from './core-contract'
import { DELIVERY_RECORD_SOURCE_SQL, deliveryRecordSourceEntities } from './delivery-record-source'
import { assertDeliverySourceDiagnostics, DELIVERY_SOURCE_DIAGNOSTICS_SQL } from './delivery-source-diagnostics'
import { readMaterialContractGraphs } from './material-contract-source'
import { OTHER_SETTLEMENT_SOURCE_SQL, otherSettlementSourceEntity } from './other-settlement-source'
import { OTHER_SETTLEMENT_APPLICATION_SOURCE_SQL, OTHER_SETTLEMENT_PAYMENT_SOURCE_SQL, otherSettlementDocumentSource } from './other-settlement-source-documents'
import { OWNER_DOCUMENT_SOURCE_SQL, PROJECT_PENALTY_SOURCE_SQL } from './owner-document-source'
import { readPayrollProjectMigrationGraphs } from './payroll-source'
import { readProcessLibraryMigrationGraphs } from './process-library-source'
import { readSupplierCredentialMigrationGraphs, supplierCredentialMasterAttributes } from './supplier-credential-source'
import { readBudgetVersionMigrationGraphs } from './target-cost-source'
import { readWbsMigrationGraphs } from './wbs-source'
import { readWorkerModernGraphs } from './worker-roster-modern-source'
import { WORKER_ROSTER_SOURCE_SQL, workerRosterSourceAttributes } from './worker-roster-source'

export interface CoreMigrationLocalSourceDependencies {
  isDemoActive: () => boolean
  currentSchemaVersion: () => Promise<number>
  select: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>
  closeDatabase: () => Promise<void>
  loadProductionSnapshot: () => Promise<Uint8Array | null>
  readSnapshotSource: (snapshot: Uint8Array) => Promise<CoreMigrationSourceDTO>
  createBackup: typeof createBrowserDatabaseBackup
  loadBackup: typeof loadBrowserDatabaseBackup
  restoreBackup: typeof restoreBrowserDatabaseBackup
  activateMigration: typeof activateBrowserCoreMigration
  clearMigration: typeof clearBrowserCoreMigration
  prepareMigration: typeof prepareBrowserCoreMigration
  loadMigrationMarker: typeof loadBrowserCoreMigrationMarker
  loadPendingMigrationMarker: typeof loadBrowserCoreMigrationPendingMarker
  now: () => string
}

export interface CoreMigrationLocalSourceProblem extends Error {
  code:
    | 'browser-only'
    | 'demo-source-not-allowed'
    | 'production-snapshot-missing'
    | 'source-changed-after-preflight'
    | 'backup-integrity-failed'
    | 'unidentifiable-source-row'
}

const ENTITY_SQL: Record<Exclude<CoreMigrationEntityType, 'material_contracts' | 'quantity_projects' | 'process_libraries' | 'supplier_credentials' | 'wbs_projects' | 'target_cost_versions' | 'payroll_projects'>, string> = {
  delivery_records: DELIVERY_RECORD_SOURCE_SQL,
  customers: `
    SELECT id, name, deleted_at
    FROM customers
    ORDER BY id
  `,
  suppliers: `
    SELECT id, name, deleted_at
    FROM suppliers
    ORDER BY id
  `,
  crews: `
    SELECT id, name, default_pay_ratio, deleted_at
    FROM crews
    ORDER BY id
  `,
  projects: `
    SELECT
      id, name, customer_id, secondary_customer_id,
      area, contract_amount, deleted_at
    FROM projects
    ORDER BY id
  `,
  construction_contracts: `
    SELECT
      c.id, c.no, c.name, c.party_a, c.project_id, p.customer_id,
      c.content, c.invoice_type, c.contact_name, c.contact_phone,
      c.tax_rate, c.sign_date, c.main_terms, c.payment_terms,
      c.warranty_terms, c.retention_ratio, c.retention_amount,
      c.retention_days, c.invoice_name, c.invoice_tax_no,
      c.invoice_address_phone, c.invoice_bank, c.invoice_bank_account,
      c.amount, c.status, c.note, c.actual_completion_date,
      (SELECT COALESCE(json_group_array(json_object(
        'id', f.id, 'ownerType', f.owner_type, 'ownerId', f.owner_id,
        'fileName', f.file_name, 'filePath', f.file_path, 'fileSize', f.file_size,
        'mimeType', f.mime_type, 'category', f.category, 'uploader', f.uploader,
        'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at,
        'payloadEncoding', payload.encoding, 'payloadBase64', CASE WHEN payload.encoding = 'base64' THEN payload.content ELSE NULL END
      )), '[]') FROM (
        SELECT * FROM file_refs WHERE owner_type = 'contract' AND owner_id = c.id ORDER BY id
      ) f LEFT JOIN file_payloads payload ON payload.file_ref_id = f.id) AS attachments_json,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', boq_catalog.id,
          'itemName', boq_catalog.item_name,
          'unit', boq_catalog.unit,
          'qty', boq_catalog.qty,
          'unitPrice', boq_catalog.unit_price,
          'building', boq_catalog.building,
          'unitType', boq_catalog.unit_type,
          'floorZone', boq_catalog.floor_zone,
          'source', json_object(
            'boqFileId', boq_catalog.boq_file_id,
            'changeOrderId', boq_catalog.change_order_id,
            'traceKey', boq_catalog.trace_key,
            'sourceSheet', boq_catalog.source_sheet,
            'sourceRow', boq_catalog.source_row,
            'confirmed', json(CASE WHEN boq_catalog.confirmed = 1 THEN 'true' ELSE 'false' END)
          ),
          'updatedAt', boq_catalog.updated_at
        ))
        FROM (
          SELECT boq_line.id,
                 boq_line.item_name,
                 boq_line.unit,
                 COALESCE(boq_line.recognized_qty, boq_line.qty) AS qty,
                 COALESCE(boq_line.recognized_unit_price, boq_line.unit_price) AS unit_price,
                 boq_line.building,
                 boq_line.unit_type,
                 boq_line.floor_zone,
                 boq_line.boq_file_id, boq_line.change_order_id,
                 boq_line.trace_key, boq_line.source_sheet, boq_line.source_row,
                 CASE WHEN boq_line.change_order_id IS NULL AND boq_file.id IS NOT NULL
                   AND boq_file.contract_id = c.id AND boq_file.deleted_at IS NULL
                   AND boq_file.parse_status = 'parsed' THEN 1 ELSE 0 END AS confirmed,
                 boq_line.updated_at
          FROM boq_lines boq_line
          LEFT JOIN boq_files boq_file ON boq_file.id = boq_line.boq_file_id
          WHERE boq_line.contract_id = c.id
            AND boq_line.project_id = c.project_id
            AND boq_line.deleted_at IS NULL
          ORDER BY boq_line.sort_order, boq_line.id
        ) boq_catalog
      ), '[]') AS boq_catalog_json,
      COALESCE((
        SELECT json_group_array(json_object(
          'periodNo', quantity_fact.period_no,
          'boqLineId', quantity_fact.boq_line_id,
          'autoQty', quantity_fact.auto_qty,
          'missingQtyCount', quantity_fact.missing_qty_count,
          'quantityBasis', 'field',
          'sourceVersion', quantity_fact.source_version,
          'sourceUpdatedAt', quantity_fact.source_updated_at
        ))
        FROM (
          SELECT substr(usc.completed_at, 1, 7) AS period_no,
                 hti.boq_line_id,
                 COALESCE(SUM(hti.field_qty), 0) AS auto_qty,
                 SUM(CASE WHEN hti.field_qty IS NULL THEN 1 ELSE 0 END) AS missing_qty_count,
                 'migration-field:' || substr(usc.completed_at, 1, 7) || ':'
                   || COALESCE(MAX(MAX(COALESCE(hti.updated_at, ''), COALESCE(usc.updated_at, ''))), '') AS source_version,
                 MAX(MAX(COALESCE(hti.updated_at, ''), COALESCE(usc.updated_at, ''))) AS source_updated_at
          FROM unit_stage_completions usc
          JOIN units unit_row ON unit_row.id = usc.unit_id
          JOIN floors floor_row ON floor_row.id = unit_row.floor_id
          JOIN buildings building ON building.id = floor_row.building_id
          JOIN construction_stage_items csi
            ON csi.stage_id = usc.stage_id
           AND csi.is_reporting_stage = 1
          JOIN house_type_template_items hti ON hti.item_id = csi.item_id
          JOIN rooms room_row
            ON room_row.id = hti.room_id
           AND room_row.template_id = unit_row.house_type_template_id
          JOIN boq_lines quantity_boq_line ON quantity_boq_line.id = hti.boq_line_id
          WHERE usc.deleted_at IS NULL
            AND unit_row.deleted_at IS NULL
            AND floor_row.deleted_at IS NULL
            AND building.deleted_at IS NULL
            AND csi.deleted_at IS NULL
            AND hti.deleted_at IS NULL
            AND room_row.deleted_at IS NULL
            AND quantity_boq_line.deleted_at IS NULL
            AND usc.status = 'completed'
            AND building.project_id = c.project_id
            AND quantity_boq_line.contract_id = c.id
          GROUP BY substr(usc.completed_at, 1, 7), hti.boq_line_id
          ORDER BY period_no, MIN(quantity_boq_line.sort_order), hti.boq_line_id
        ) quantity_fact
      ), '[]') AS monthly_quantity_facts_json,
      c.created_at, c.updated_at, c.deleted_at
    FROM contracts c
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.kind = '施工'
    ORDER BY c.id
  `,
  auxiliary_contracts: AUXILIARY_CONTRACT_SOURCE_SQL,
  other_settlements: OTHER_SETTLEMENT_SOURCE_SQL,
  other_settlement_sources: OTHER_SETTLEMENT_APPLICATION_SOURCE_SQL,
  subcontract_contracts: `
    SELECT
      c.id, c.no, c.name, c.party_a, c.sub_kind, c.project_id, c.supplier_id,
      c.content, c.invoice_type, c.contact_name, c.contact_phone,
      c.tax_rate, c.sign_date, c.main_terms, c.payment_terms,
      c.warranty_terms, c.retention_ratio, c.retention_amount,
      c.retention_days, c.invoice_name, c.invoice_tax_no,
      c.invoice_address_phone, c.invoice_bank, c.invoice_bank_account,
      c.amount, c.status, c.settlement_status, c.clearance_status,
      c.note, c.created_at, c.updated_at, c.deleted_at,
      (SELECT COALESCE(json_group_array(json_object(
        'id', f.id, 'ownerType', f.owner_type, 'ownerId', f.owner_id,
        'fileName', f.file_name, 'filePath', f.file_path, 'fileSize', f.file_size,
        'mimeType', f.mime_type, 'category', f.category, 'uploader', f.uploader,
        'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at,
        'payloadEncoding', payload.encoding, 'payloadBase64', CASE WHEN payload.encoding = 'base64' THEN payload.content ELSE NULL END
      )), '[]') FROM (
        SELECT * FROM file_refs WHERE owner_type = 'contract' AND owner_id = c.id ORDER BY id
      ) f LEFT JOIN file_payloads payload ON payload.file_ref_id = f.id) AS attachments_json
    FROM contracts c
    WHERE c.kind = '分包'
    ORDER BY c.id
  `,
  contract_supplements: `
    SELECT
      id, contract_id, no, name, content, amount, sign_date, status,
      external_ref, note, created_at, updated_at, deleted_at
    FROM contract_supplements
    WHERE contract_id NOT IN (SELECT id FROM contracts WHERE kind = '其他支出')
    ORDER BY id
  `,
  receipt_registrations: `
    SELECT
      id, no, receipt_date, project_id, contract_id, customer_id,
      payer_account, amount, payment_method, acceptance_bill_no, bill_due_date,
      period_no, bank_serial_no, handler, review_status, status, note,
      created_at, updated_at, deleted_at,
      (SELECT COALESCE(json_group_array(json_object(
        'id', f.id, 'ownerType', f.owner_type, 'ownerId', f.owner_id,
        'fileName', f.file_name, 'filePath', f.file_path, 'fileSize', f.file_size,
        'mimeType', f.mime_type, 'category', f.category, 'uploader', f.uploader,
        'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at,
        'payloadEncoding', payload.encoding, 'payloadBase64', CASE WHEN payload.encoding = 'base64' THEN payload.content ELSE NULL END
      )), '[]') FROM (
        SELECT * FROM file_refs
        WHERE owner_type = 'receipt_registration' AND owner_id = receipt_registrations.id
        ORDER BY id
      ) f LEFT JOIN file_payloads payload ON payload.file_ref_id = f.id) AS attachments_json
    FROM receipt_registrations
    ORDER BY id
  `,
  owner_documents: OWNER_DOCUMENT_SOURCE_SQL,
  workers: WORKER_ROSTER_SOURCE_SQL,
  project_suppliers: `
    SELECT id, project_id, supplier_id, deleted_at
    FROM project_suppliers
    ORDER BY id
  `,
}

function problem(
  code: CoreMigrationLocalSourceProblem['code'],
  message: string,
): CoreMigrationLocalSourceProblem {
  return Object.assign(new Error(message), { code })
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function nullableText(value: unknown): string | null {
  return text(value) || null
}

function isoDateTimeText(value: unknown): string | null {
  const normalized = nullableText(value)
  if (!normalized)
    return null
  const sqliteUtc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(normalized)
  if (!sqliteUtc)
    return normalized
  return `${sqliteUtc[1]}T${sqliteUtc[2]}.${(sqliteUtc[3] ?? '').padEnd(3, '0')}Z`
}

function normalizeFileRefsJson(value: unknown): string {
  const serialized = text(value) || '[]'
  try {
    const parsed = JSON.parse(serialized)
    if (!Array.isArray(parsed))
      return serialized
    return JSON.stringify(parsed.map((file) => {
      if (!file || typeof file !== 'object' || Array.isArray(file))
        return file
      const record = file as Record<string, unknown>
      return {
        ...record,
        uploadedAt: isoDateTimeText(record.uploadedAt),
        deletedAt: isoDateTimeText(record.deletedAt),
      }
    }))
  }
  catch {
    return serialized
  }
}

function normalizeMonthlyQuantityFactsJson(value: unknown): string {
  const serialized = text(value) || '[]'
  try {
    const parsed = JSON.parse(serialized)
    if (!Array.isArray(parsed))
      return serialized
    return JSON.stringify(parsed.map((fact) => {
      if (!fact || typeof fact !== 'object' || Array.isArray(fact))
        return fact
      const record = fact as Record<string, unknown>
      return {
        ...record,
        sourceUpdatedAt: isoDateTimeText(record.sourceUpdatedAt),
      }
    }))
  }
  catch {
    return serialized
  }
}

function normalizeBoqCatalogJson(value: unknown): string {
  const serialized = text(value) || '[]'
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!Array.isArray(parsed))
      return serialized
    return JSON.stringify(parsed.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Object.hasOwn(entry, 'updatedAt'))
        return entry
      return { ...entry, updatedAt: isoDateTimeText(entry.updatedAt) }
    }))
  }
  catch { return serialized }
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nullableMoney(value: unknown): string | null {
  const parsed = nullableNumber(value)
  if (parsed === null)
    return null
  const money = (Math.round((parsed + Number.EPSILON) * 100) / 100).toFixed(2)
  if (!isCoreMigrationMoney(money))
    throw problem('unidentifiable-source-row', '本地金额超出可精确迁移范围')
  return money
}

function baseEntity(row: Record<string, unknown>): CoreMigrationSourceEntityDTO {
  return {
    legacyId: text(row.id),
    name: text(row.name),
    deletedAt: nullableText(row.deleted_at),
  }
}

function sourceEntity(
  entityType: CoreMigrationEntityType,
  row: Record<string, unknown>,
): CoreMigrationSourceEntityDTO {
  const entity = baseEntity(row)
  if (entityType === 'crews') {
    try {
      const fees = crewPayrollFeeAttributes(Object.fromEntries(CREW_PAYROLL_FEE_FIELDS.filter(field => Object.hasOwn(row, field.column)).map(field => [field.attribute, row[field.column]])))
      return { ...entity, attributes: { ...(Object.hasOwn(row, 'default_pay_ratio') ? { defaultPayRatio: nullableNumber(row.default_pay_ratio) } : {}), ...fees } }
    }
    catch (cause) { throw problem('unidentifiable-source-row', cause instanceof Error ? cause.message : '班组费用默认来源无效') }
  }
  if (entityType === 'suppliers')
    return { ...entity, attributes: { laborScope: text(row.labor_scope) } }
  if (entityType === 'projects') {
    return {
      ...entity,
      references: {
        customerId: nullableText(row.customer_id),
        secondaryCustomerId: nullableText(row.secondary_customer_id),
      },
      quantity: nullableNumber(row.area),
      amount: nullableMoney(row.contract_amount),
    }
  }
  if (entityType === 'workers') {
    const dailyWage = row.daily_wage
    if (dailyWage !== undefined && dailyWage !== null && (typeof dailyWage !== 'number' || !Number.isFinite(dailyWage) || dailyWage < 0))
      throw problem('unidentifiable-source-row', '本地工人日薪不是可确认的非负数值，不能以缺价或零代替')
    return {
      ...entity,
      attributes: { ...workerRosterSourceAttributes(row), ...(dailyWage !== undefined ? { dailyWage } : {}) },
      references: {
        crewId: nullableText(row.crew_id),
        projectId: nullableText(row.current_project_id),
      },
    }
  }
  if (entityType === 'construction_contracts') {
    const signatory = { legacyPartyA: typeof row.party_a === 'string' ? row.party_a : null, ourSignatoryId: nullableText(row.our_signatory_id), ourSignatorySnapshotJson: typeof row.our_signatory_snapshot === 'string' ? row.our_signatory_snapshot : 'null' }
    return {
      ...entity,
      references: {
        projectId: nullableText(row.project_id),
        customerId: nullableText(row.customer_id),
      },
      amount: nullableMoney(row.amount),
      attributes: {
        ...signatory,
        managementFeeAmount: nullableNumber(row.management_fee_amount),
        managementFeeBasis: text(row.management_fee_basis),
        ...(row.management_fee_configuration_json !== undefined ? { managementFeeConfigurationJson: text(row.management_fee_configuration_json) } : {}),
        no: text(row.no),
        content: text(row.content),
        invoiceType: text(row.invoice_type),
        contactName: text(row.contact_name),
        contactPhone: text(row.contact_phone),
        taxRate: nullableNumber(row.tax_rate),
        signDate: nullableText(row.sign_date),
        mainTerms: text(row.main_terms),
        paymentTerms: text(row.payment_terms),
        warrantyTerms: text(row.warranty_terms),
        retentionRatio: nullableNumber(row.retention_ratio),
        retentionAmount: nullableNumber(row.retention_amount),
        retentionDays: nullableNumber(row.retention_days),
        invoiceName: text(row.invoice_name),
        invoiceTaxNo: text(row.invoice_tax_no),
        invoiceAddressPhone: text(row.invoice_address_phone),
        invoiceBank: text(row.invoice_bank),
        invoiceBankAccount: text(row.invoice_bank_account),
        status: text(row.status),
        note: text(row.note),
        actualCompletionDate: nullableText(row.actual_completion_date),
        attachmentsJson: text(row.attachments_json) || '[]',
        boqCatalogJson: normalizeBoqCatalogJson(row.boq_catalog_json),
        monthlyQuantityFactsJson: normalizeMonthlyQuantityFactsJson(row.monthly_quantity_facts_json),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      },
    }
  }
  if (entityType === 'subcontract_contracts') {
    const signatory = { legacyPartyA: typeof row.party_a === 'string' ? row.party_a : null, ourSignatoryId: nullableText(row.our_signatory_id), ourSignatorySnapshotJson: typeof row.our_signatory_snapshot === 'string' ? row.our_signatory_snapshot : 'null' }
    return {
      ...entity,
      references: {
        projectId: nullableText(row.project_id),
        supplierId: nullableText(row.supplier_id),
      },
      amount: nullableMoney(row.amount),
      attributes: {
        ...signatory,
        no: text(row.no),
        subKind: text(row.sub_kind),
        content: text(row.content),
        invoiceType: text(row.invoice_type),
        contactName: text(row.contact_name),
        contactPhone: text(row.contact_phone),
        taxRate: nullableNumber(row.tax_rate),
        signDate: nullableText(row.sign_date),
        mainTerms: text(row.main_terms),
        paymentTerms: text(row.payment_terms),
        warrantyTerms: text(row.warranty_terms),
        retentionRatio: nullableNumber(row.retention_ratio),
        retentionAmount: nullableNumber(row.retention_amount),
        retentionDays: nullableNumber(row.retention_days),
        invoiceName: text(row.invoice_name),
        invoiceTaxNo: text(row.invoice_tax_no),
        invoiceAddressPhone: text(row.invoice_address_phone),
        invoiceBank: text(row.invoice_bank),
        invoiceBankAccount: text(row.invoice_bank_account),
        status: text(row.status),
        settlementStatus: nullableText(row.settlement_status),
        clearanceStatus: nullableText(row.clearance_status),
        attachmentsJson: text(row.attachments_json) || '[]',
        note: text(row.note),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      },
    }
  }
  if (entityType === 'contract_supplements') {
    return {
      ...entity,
      references: {
        contractId: nullableText(row.contract_id),
      },
      amount: nullableMoney(row.amount),
      attributes: {
        no: text(row.no),
        content: text(row.content),
        signDate: nullableText(row.sign_date),
        status: text(row.status),
        externalRef: nullableText(row.external_ref),
        note: text(row.note),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      },
    }
  }
  if (entityType === 'receipt_registrations') {
    return {
      ...entity,
      name: text(row.no) || `收款登记 ${text(row.id)}`,
      references: {
        projectId: nullableText(row.project_id),
        contractId: nullableText(row.contract_id),
        customerId: nullableText(row.customer_id),
      },
      amount: nullableMoney(row.amount),
      attributes: {
        no: text(row.no),
        receiptDate: nullableText(row.receipt_date),
        payerAccount: text(row.payer_account),
        paymentMethod: text(row.payment_method),
        acceptanceBillNo: text(row.acceptance_bill_no),
        billDueDate: text(row.bill_due_date),
        periodNo: text(row.period_no),
        bankSerialNo: text(row.bank_serial_no),
        handler: text(row.handler),
        reviewStatus: text(row.review_status),
        status: text(row.status),
        note: text(row.note),
        createdAt: isoDateTimeText(row.created_at) ?? '',
        updatedAt: isoDateTimeText(row.updated_at) ?? '',
        attachmentsJson: text(row.attachments_json) || '[]',
      },
    }
  }
  if (entityType === 'owner_documents') {
    const supplierId = nullableText(row.supplier_id)
    return {
      ...entity,
      references: {
        projectId: nullableText(row.project_id),
        contractId: nullableText(row.contract_id),
        ...(text(row.kind) === 'project_penalty' ? { crewId: nullableText(row.crew_id) } : {}),
        ...(text(row.kind) === 'project_penalty' || text(row.kind) === 'sub_change' || text(row.kind) === 'sub_settlement' || supplierId ? { supplierId } : {}),
      },
      amount: nullableMoney(row.amount),
      attributes: {
        ...(text(row.kind) === 'project_penalty' ? { penaltyOrigin: nullableText(row.penalty_origin), contractKind: nullableText(row.contract_kind), deadline: nullableText(row.deadline), rectificationNote: text(row.rectification_note), deductionMethod: text(row.deduction_method), penaltyDeductionsJson: text(row.penalty_deductions_json) || '[]' } : {}),
        kind: text(row.kind),
        no: text(row.no),
        documentType: text(row.document_type),
        sourceType: text(row.source_type),
        sourceLocked: nullableNumber(row.source_locked),
        periodNo: text(row.period_no),
        applicationDate: nullableText(row.application_date),
        approvalDate: nullableText(row.approval_date),
        quantityBasis: nullableText(row.quantity_basis),
        quantitySourceVersion: nullableText(row.quantity_source_version),
        quantitySourceUpdatedAt: isoDateTimeText(row.quantity_source_updated_at),
        operatorName: text(row.operator_name),
        submittedAt: isoDateTimeText(row.submitted_at),
        status: text(row.status),
        statusNote: text(row.status_note),
        auditedAmount: nullableNumber(row.audited_amount),
        taxExclusiveAmount: nullableNumber(row.tax_exclusive_amount),
        appliedTaxExclusiveAmount: nullableNumber(row.applied_tax_exclusive_amount),
        changedArea: nullableNumber(row.changed_area),
        actualApprovedPrice: nullableNumber(row.actual_approved_price),
        note: text(row.note),
        linesJson: text(row.lines_json) || '[]',
        filesJson: normalizeFileRefsJson(row.files_json),
        acceptanceLifecycleJson: text(row.acceptance_lifecycle_json) || '{}',
        lifecycleEventsJson: text(row.lifecycle_events_json) || '[]',
        settlementBasis: text(row.settlement_basis),
        settlementDifferenceNote: text(row.settlement_difference_note),
        noticeNo: text(row.notice_no),
        penaltyReason: text(row.penalty_reason),
        appealNote: text(row.appeal_note),
        createdAt: isoDateTimeText(row.created_at) ?? '',
        updatedAt: isoDateTimeText(row.updated_at) ?? '',
      },
    }
  }
  if (entityType === 'project_suppliers') {
    const projectId = nullableText(row.project_id)
    const supplierId = nullableText(row.supplier_id)
    return {
      ...entity,
      name: `${projectId ?? '未关联项目'} × ${supplierId ?? '未关联分供方'}`,
      references: { projectId, supplierId },
    }
  }
  return entity
}

function countExpectations(
  entities: CoreMigrationSourceEntitiesDTO,
): Partial<Record<CoreMigrationEntityType, number>> {
  return Object.fromEntries(
    CORE_MIGRATION_TOPOLOGY.map(entityType => [entityType, entities[entityType]?.length ?? 0]),
  )
}

function totalExpectations(
  entities: CoreMigrationSourceEntitiesDTO,
): CoreMigrationTotalExpectationDTO[] {
  const totals: CoreMigrationTotalExpectationDTO[] = []
  for (const entityType of CORE_MIGRATION_TOPOLOGY) {
    const quantities = (entities[entityType] ?? [])
      .map(entity => entity.quantity)
      .filter((value): value is number => value != null)
    if (quantities.length) {
      totals.push({
        entityType,
        metric: 'quantity',
        expected: quantities.reduce((sum, value) => sum + value, 0),
      })
    }
    const amounts = (entities[entityType] ?? [])
      .map(entity => entity.amount)
      .filter((value): value is string => value != null)
    if (amounts.length) {
      const total = amounts.reduce(
        (sum, value) => sum + coreMigrationMoneyToCents(value),
        BigInt(0),
      )
      totals.push({
        entityType,
        metric: 'amount',
        expected: coreMigrationCentsToMoney(total),
      })
    }
  }
  return totals
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    value.slice().buffer,
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

type SourceSelect = <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>

async function buildSource(
  schemaVersion: number,
  selectSource: SourceSelect,
): Promise<CoreMigrationSourceDTO> {
  await assertQuotationCoreMigrationGate(schemaVersion, selectSource)
  const credentialGraphs = await readSupplierCredentialMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> }, schemaVersion)
  const material = await readMaterialContractGraphs(selectSource, schemaVersion)
  const entries = await Promise.all(CORE_MIGRATION_TOPOLOGY.map(async (entityType) => {
    if (entityType === 'material_contracts')
      return [entityType, material.entities] as const
    if (entityType === 'supplier_credentials')
      return [entityType, credentialGraphs] as const
    if (entityType === 'suppliers')
      return [entityType, credentialGraphs.map(entity => ({ legacyId: entity.legacyId, name: entity.name, deletedAt: entity.deletedAt, attributes: supplierCredentialMasterAttributes(JSON.parse(String(entity.attributes?.graphJson)).supplier) }))] as const
    if (entityType === 'process_libraries')
      return [entityType, await readProcessLibraryMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> })] as const
    if (entityType === 'wbs_projects')
      return [entityType, await readWbsMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> })] as const
    if (entityType === 'payroll_projects')
      return [entityType, await readPayrollProjectMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> })] as const
    if (entityType === 'target_cost_versions')
      return [entityType, await readBudgetVersionMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> })] as const
    if (entityType === 'quantity_projects') {
      const projects = await readQuantityMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> })
      return [entityType, projects.map(({ project, graph }): CoreMigrationSourceEntityDTO => ({
        legacyId: project.id,
        name: project.name,
        references: { projectId: project.id },
        attributes: { graphJson: JSON.stringify(graph) },
        deletedAt: quantityMigrationTimestamp(project.deleted_at, '工程量项目删除'),
      }))] as const
    }
    let sql = ENTITY_SQL[entityType]
    if (schemaVersion >= 53 && (entityType === 'construction_contracts' || entityType === 'subcontract_contracts'))
      sql = sql.replace('c.id, c.no, c.name,', 'c.id, c.no, c.name, c.our_signatory_id, c.our_signatory_snapshot,')
    if (schemaVersion >= 57 && entityType === 'construction_contracts') {
      sql = sql.replace('c.id, c.no, c.name,', `c.id, c.no, c.name, c.management_fee_amount, c.management_fee_basis,
        json_object('amount',c.management_fee_amount,'basis',c.management_fee_basis,'version',c.management_fee_version,'history',json(COALESCE((
          SELECT json_group_array(json_object('version',history.version,'amount',history.amount,'basis',history.basis,'contractVersion',history.contract_version,'adoptedAt',history.adopted_at,'actorId',history.actor_id,'commandId',history.command_id))
          FROM (SELECT * FROM construction_management_fee_history WHERE contract_id=c.id ORDER BY adopted_at,version) history
        ),'[]'))) AS management_fee_configuration_json,`)
    }
    if (entityType === 'crews') {
      const columns = new Set((await selectSource<{ name: string }>('PRAGMA table_info(crews)')).map(row => row.name))
      const fees = CREW_PAYROLL_FEE_FIELDS.filter(field => columns.has(field.column)).map(field => field.column)
      sql = `SELECT ${['id', 'name', 'default_pay_ratio', 'deleted_at', ...fees].join(', ')} FROM crews ORDER BY id`
    }
    const rows = await selectSource<Record<string, unknown>>(sql)
    if (entityType === 'workers') {
      const modern = await readWorkerModernGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> })
      if ([...modern.keys()].some(id => !rows.some(row => row.id === id)))
        throw new Error('工人现代实名图缺少所属原主档，不能静默丢失')
      for (const row of rows) {
        if (modern.has(String(row.id)))
          row.worker_roster_graph_json = JSON.stringify(modern.get(String(row.id)))
      }
    }
    if (entityType === 'delivery_records') {
      assertDeliverySourceDiagnostics(await selectSource(DELIVERY_SOURCE_DIAGNOSTICS_SQL))
      return [entityType, await deliveryRecordSourceEntities(rows)] as const
    }
    if (entityType === 'other_settlement_sources') {
      const payments = await selectSource<Record<string, unknown>>(OTHER_SETTLEMENT_PAYMENT_SOURCE_SQL)
      return [entityType, [...rows.map(row => otherSettlementDocumentSource(row, 'application')), ...payments.map(row => otherSettlementDocumentSource(row, 'payment'))].sort((a, b) => compareCanonicalText(a.legacyId, b.legacyId))] as const
    }
    if (entityType === 'owner_documents')
      rows.push(...await selectSource<Record<string, unknown>>(PROJECT_PENALTY_SOURCE_SQL))
    if (entityType === 'auxiliary_contracts')
      rows.push(...await selectSource<Record<string, unknown>>(COMPANY_CONTRACT_SOURCE_SQL))
    const entities = rows
      .map(row => entityType === 'other_settlements' ? otherSettlementSourceEntity(row) : entityType === 'auxiliary_contracts' ? auxiliaryContractSourceEntity(row) : sourceEntity(entityType, row))
      .sort((left, right) => compareCanonicalText(left.legacyId, right.legacyId))
    if (entityType === 'contract_supplements') {
      for (const entity of entities) {
        const graph = material.graphs.get(entity.legacyId)
        if (graph)
          entity.attributes = { ...entity.attributes, materialGraphJson: JSON.stringify(graph) }
      }
    }
    const invalid = entities.find(entity => !entity.legacyId || !entity.name)
    if (invalid) {
      throw problem(
        'unidentifiable-source-row',
        `${entityType} 存在缺少旧 ID 或名称的记录，不能静默丢弃`,
      )
    }
    return [entityType, entities] as const
  }))
  const entities = Object.fromEntries(entries) as CoreMigrationSourceEntitiesDTO
  const withoutHash = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: `sqlite-v${schemaVersion}`,
    entities,
    expectations: {
      counts: countExpectations(entities),
      totals: totalExpectations(entities),
    },
  }
  return {
    ...withoutHash,
    sourceHash: await sha256(coreMigrationSourceHashInput(withoutHash)),
  }
}

async function readSqliteSnapshotSource(snapshot: Uint8Array): Promise<CoreMigrationSourceDTO> {
  const database = await openBrowserSqlite(snapshot)
  const selectSnapshot: SourceSelect = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const statement = database.prepare(sql)
    if (params.length)
      statement.bind(params as (string | number | null)[])
    const rows: T[] = []
    try {
      while (statement.step())
        rows.push(statement.getAsObject() as T)
      return rows
    }
    finally {
      statement.free()
    }
  }
  try {
    const versions = await selectSnapshot<{ version: number }>(
      'SELECT MAX(version) AS version FROM schema_migrations',
    )
    const schemaVersion = Number(versions[0]?.version ?? 0)
    return await buildSource(schemaVersion, selectSnapshot)
  }
  finally {
    database.close()
  }
}

function defaultDependencies(): CoreMigrationLocalSourceDependencies {
  return {
    isDemoActive: () => useDataVisibilityStore().includeDemo,
    currentSchemaVersion: async () => getCurrentVersion(await getDb()),
    select: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const database = await getDb()
      return database.select<T>(sql, params)
    },
    closeDatabase: closeDb,
    loadProductionSnapshot: () => loadBrowserDatabase('production'),
    readSnapshotSource: readSqliteSnapshotSource,
    createBackup: createBrowserDatabaseBackup,
    loadBackup: loadBrowserDatabaseBackup,
    restoreBackup: restoreBrowserDatabaseBackup,
    activateMigration: activateBrowserCoreMigration,
    clearMigration: clearBrowserCoreMigration,
    prepareMigration: prepareBrowserCoreMigration,
    loadMigrationMarker: loadBrowserCoreMigrationMarker,
    loadPendingMigrationMarker: loadBrowserCoreMigrationPendingMarker,
    now: () => new Date().toISOString(),
  }
}

export function createCoreMigrationLocalSource(
  dependencies: CoreMigrationLocalSourceDependencies = defaultDependencies(),
) {
  async function readSource(): Promise<CoreMigrationSourceDTO> {
    if (dependencies.isDemoActive())
      throw problem('demo-source-not-allowed', '请先关闭“包含测试数据”，再迁移正式本地数据')
    return buildSource(await dependencies.currentSchemaVersion(), dependencies.select)
  }

  async function createBackup(expectedSourceHash: string): Promise<BrowserDatabaseBackupMetadata> {
    await dependencies.closeDatabase()
    const snapshot = await dependencies.loadProductionSnapshot()
    if (!snapshot)
      throw problem('production-snapshot-missing', '找不到可备份的本地 production 数据快照')
    const protectedSource = await dependencies.readSnapshotSource(snapshot)
    if (protectedSource.sourceHash !== expectedSourceHash) {
      throw problem(
        'source-changed-after-preflight',
        '预检后本地数据已变化，未创建备份；请重新运行预检',
      )
    }
    const sourceSchemaVersion = Number.parseInt(
      protectedSource.sourceVersion.replace(/^sqlite-v/, ''),
      10,
    )
    const snapshotSha256 = await sha256Bytes(snapshot)
    return dependencies.createBackup({
      backupId: `core-migration-${protectedSource.sourceHash}-${snapshotSha256}`,
      createdAt: dependencies.now(),
      sourceSchemaVersion,
      sourceVersion: protectedSource.sourceVersion,
      sourceHash: protectedSource.sourceHash,
      snapshotSha256,
      snapshot,
    })
  }

  async function assertCurrentSource(
    expectedSourceHash: string,
    expectedSnapshotSha256: string,
  ): Promise<void> {
    await dependencies.closeDatabase()
    const snapshot = await dependencies.loadProductionSnapshot()
    if (!snapshot)
      throw problem('production-snapshot-missing', '找不到本地 production 数据快照')
    const [currentSource, currentSnapshotSha256] = await Promise.all([
      dependencies.readSnapshotSource(snapshot),
      sha256Bytes(snapshot),
    ])
    if (currentSource.sourceHash !== expectedSourceHash
      || currentSnapshotSha256 !== expectedSnapshotSha256) {
      throw problem(
        'source-changed-after-preflight',
        '备份后本地正式数据已变化，请重新预检并创建新备份',
      )
    }
  }

  async function prepareSwitch(marker: BrowserCoreMigrationPendingMarker): Promise<void> {
    await assertQuotationCoreMigrationGate(await dependencies.currentSchemaVersion(), dependencies.select)
    await dependencies.closeDatabase()
    await dependencies.prepareMigration(marker)
  }

  async function abortSwitch(): Promise<void> {
    await dependencies.clearMigration()
  }

  async function confirmSwitch(marker: BrowserCoreMigrationMarker): Promise<void> {
    // prepareSwitch 已锁定旧库，不能再经普通连接读取；改为核验受保护的原始快照。
    // readSnapshotSource 仍执行报价迁入门禁，且同时校验预检来源和备份字节摘要。
    const backup = await dependencies.loadBackup(marker.backupId)
    if (!backup || backup.metadata.sourceHash !== marker.sourceHash)
      throw problem('source-changed-after-preflight', '受保护的本地备份与待确认来源不匹配')
    await assertCurrentSource(marker.sourceHash, backup.metadata.snapshotSha256)
    await dependencies.activateMigration(marker)
  }

  async function rollback(backupId: string, expectedSourceHash: string): Promise<void> {
    await dependencies.closeDatabase()
    const backup = await dependencies.loadBackup(backupId)
    if (!backup)
      throw problem('backup-integrity-failed', '找不到受保护的本地迁移备份')
    const protectedSource = await dependencies.readSnapshotSource(backup.snapshot)
    if (backup.metadata.sourceHash !== expectedSourceHash
      || protectedSource.sourceHash !== expectedSourceHash
      || protectedSource.sourceVersion !== backup.metadata.sourceVersion) {
      throw problem(
        'backup-integrity-failed',
        '受保护备份的来源哈希或版本与迁移批次不一致',
      )
    }
    await dependencies.restoreBackup(backupId)
    await dependencies.clearMigration()
  }

  return {
    readSource,
    createBackup,
    assertCurrentSource,
    prepareSwitch,
    abortSwitch,
    confirmSwitch,
    rollback,
    loadActiveMigration: dependencies.loadMigrationMarker,
    loadPendingMigration: dependencies.loadPendingMigrationMarker,
  }
}

export type CoreMigrationLocalSource = ReturnType<typeof createCoreMigrationLocalSource>
