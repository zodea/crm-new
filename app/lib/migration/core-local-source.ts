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
import { isTauri } from '@tauri-apps/api/core'
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
import { OTHER_SETTLEMENT_SOURCE_SQL, otherSettlementSourceEntity } from './other-settlement-source'
import { OTHER_SETTLEMENT_APPLICATION_SOURCE_SQL, OTHER_SETTLEMENT_PAYMENT_SOURCE_SQL, otherSettlementDocumentSource } from './other-settlement-source-documents'
import { readProcessLibraryMigrationGraphs } from './process-library-source'
import { readSupplierCredentialMigrationGraphs, supplierCredentialMasterAttributes } from './supplier-credential-source'

export interface CoreMigrationLocalSourceDependencies {
  isNative: () => boolean
  isDemoActive: () => boolean
  currentSchemaVersion: () => Promise<number>
  select: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>
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

const ENTITY_SQL: Record<Exclude<CoreMigrationEntityType, 'quantity_projects' | 'process_libraries' | 'supplier_credentials'>, string> = {
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
    SELECT id, name, deleted_at
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
      c.id, c.no, c.name, c.project_id, p.customer_id,
      c.content, c.invoice_type, c.contact_name, c.contact_phone,
      c.tax_rate, c.sign_date, c.main_terms, c.payment_terms,
      c.warranty_terms, c.retention_ratio, c.retention_amount,
      c.retention_days, c.invoice_name, c.invoice_tax_no,
      c.invoice_address_phone, c.invoice_bank, c.invoice_bank_account,
      c.amount, c.status, c.note, c.actual_completion_date,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', boq_catalog.id,
          'itemName', boq_catalog.item_name,
          'unit', boq_catalog.unit,
          'qty', boq_catalog.qty,
          'unitPrice', boq_catalog.unit_price,
          'building', boq_catalog.building,
          'updatedAt', boq_catalog.updated_at
        ))
        FROM (
          SELECT boq_line.id,
                 boq_line.item_name,
                 boq_line.unit,
                 COALESCE(boq_line.recognized_qty, boq_line.qty) AS qty,
                 COALESCE(boq_line.recognized_unit_price, boq_line.unit_price) AS unit_price,
                 boq_line.building,
                 boq_line.updated_at
          FROM boq_lines boq_line
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
      c.id, c.no, c.name, c.sub_kind, c.project_id, c.supplier_id,
      c.content, c.invoice_type, c.contact_name, c.contact_phone,
      c.tax_rate, c.sign_date, c.main_terms, c.payment_terms,
      c.warranty_terms, c.retention_ratio, c.retention_amount,
      c.retention_days, c.invoice_name, c.invoice_tax_no,
      c.invoice_address_phone, c.invoice_bank, c.invoice_bank_account,
      c.amount, c.status, c.settlement_status, c.clearance_status,
      c.note, c.created_at, c.updated_at, c.deleted_at
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
  owner_documents: `
    SELECT * FROM (
      SELECT
        change_order.id,
        change_order.name,
        change_order.project_id,
        change_order.contract_id,
        NULL AS supplier_id,
        COALESCE(change_order.approved_tax_inclusive_amount, change_order.total_amount, 0) AS amount,
        NULL AS audited_amount,
        change_order.approved_tax_exclusive_amount AS tax_exclusive_amount,
        change_order.applied_tax_exclusive_amount AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_change' AS kind,
        change_order.code AS no,
        change_order.document_type,
        'boq_change_order' AS source_type,
        CASE WHEN change_order.status = 'approved' THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        change_order.application_date,
        change_order.approved_at AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        change_order.status,
        change_order.status_note,
        change_order.note,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', change_line.id,
            'boqLineId', COALESCE(change_line.result_boq_line_id, change_line.boq_line_id),
            'operation', change_line.operation,
            'itemName', change_line.item_name,
            'unit', change_line.unit,
            'contractQty', COALESCE(boq_line.recognized_qty, boq_line.qty),
            'contractUnitPrice', COALESCE(boq_line.recognized_unit_price, boq_line.unit_price),
            'deltaQty', change_line.delta_qty,
            'newUnitPrice', change_line.new_unit_price,
            'amount', change_line.amount,
            'note', change_line.note
          ))
          FROM boq_change_lines change_line
          LEFT JOIN boq_lines boq_line ON boq_line.id = COALESCE(change_line.result_boq_line_id, change_line.boq_line_id)
          WHERE change_line.change_order_id = change_order.id
            AND change_line.deleted_at IS NULL
          ORDER BY change_line.sort_order, change_line.id
        ), '[]') AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'boq_change_order'
            AND file_ref.owner_id = change_order.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        change_order.created_at,
        change_order.updated_at,
        change_order.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM boq_change_orders change_order

      UNION ALL

      SELECT
        ledger.id,
        ledger.name,
        ledger.project_id,
        ledger.contract_id,
        NULL AS supplier_id,
        ledger.tax_inc_amount AS amount,
        NULL AS audited_amount,
        ledger.tax_exc_amount AS tax_exclusive_amount,
        ledger.applied_amount AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_change' AS kind,
        ledger.change_no AS no,
        ledger.document_type,
        'manual' AS source_type,
        ledger.source_locked,
        '' AS period_no,
        ledger.application_date,
        ledger.approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        ledger.status,
        ledger.status_note,
        ledger.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'owner_change_order'
            AND file_ref.owner_id = ledger.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        ledger.created_at,
        ledger.updated_at,
        ledger.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM owner_change_orders ledger
      WHERE ledger.source_type = 'manual'

      UNION ALL

      SELECT
        statement.id,
        COALESCE(NULLIF(statement.period_no, ''), statement.month) || '月度报量' AS name,
        statement.project_id,
        statement.contract_id,
        NULL AS supplier_id,
        COALESCE(statement.reported_amount, statement.total_amount, 0) AS amount,
        statement.audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_report' AS kind,
        statement.no,
        'monthly_statement' AS document_type,
        'monthly_statement' AS source_type,
        CASE WHEN statement.status = 'exported' THEN 1 ELSE 0 END AS source_locked,
        COALESCE(NULLIF(statement.period_no, ''), statement.month) AS period_no,
        statement.application_date,
        NULL AS approval_date,
        statement.quantity_basis,
        statement.source_version AS quantity_source_version,
        statement.source_updated_at AS quantity_source_updated_at,
        statement.operator_name,
        statement.submitted_at,
        statement.status,
        CASE WHEN statement.status = 'exported' THEN '甲方已审定'
             WHEN statement.status = 'adjusted' THEN '已申报甲方'
             ELSE '' END AS status_note,
        statement.note,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', report_line.id,
            'boqLineId', report_line.boq_line_id,
            'operation', NULL,
            'itemName', report_line.item_name,
            'unit', report_line.unit,
            'contractQty', COALESCE(boq_line.recognized_qty, boq_line.qty),
            'contractUnitPrice', report_line.unit_price,
            'autoQty', report_line.auto_qty,
            'reportedQty', COALESCE(report_line.reported_qty, report_line.adjusted_qty),
            'auditedQty', report_line.audited_qty,
            'amount', report_line.amount,
            'auditedAmount', report_line.audited_amount,
            'note', report_line.note
          ))
          FROM monthly_statement_lines report_line
          LEFT JOIN boq_lines boq_line ON boq_line.id = report_line.boq_line_id
          WHERE report_line.statement_id = statement.id
            AND report_line.deleted_at IS NULL
          ORDER BY report_line.sort_order, report_line.id
        ), '[]') AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'monthly_statement'
            AND file_ref.owner_id = statement.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        statement.created_at,
        statement.updated_at,
        statement.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM monthly_statements statement

      UNION ALL

      SELECT
        acceptance.id,
        acceptance.name,
        acceptance.project_id,
        acceptance.contract_id,
        NULL AS supplier_id,
        acceptance.contract_estimate AS amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'acceptance' AS kind,
        acceptance.no,
        'acceptance_lifecycle' AS document_type,
        'manual' AS source_type,
        CASE WHEN acceptance.status IN ('accepted', 'warranty', 'expired') THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        acceptance.document_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        acceptance.acceptor AS operator_name,
        NULL AS submitted_at,
        acceptance.status,
        CASE acceptance.status
          WHEN 'submitted' THEN '验收中'
          WHEN 'accepted' THEN '验收合格'
          WHEN 'warranty' THEN '保修中'
          WHEN 'expired' THEN '保修到期已确认'
          ELSE ''
        END AS status_note,
        acceptance.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', CASE
              WHEN file_ref.category IN ('acceptance-report', 'warranty-confirmation') THEN file_ref.category
              WHEN acceptance.type = 'warranty' THEN 'warranty-confirmation'
              ELSE 'acceptance-report'
            END,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'project_acceptance'
            AND file_ref.owner_id = acceptance.id
        ), '[]') AS files_json,
        json_object(
          'acceptanceOrganization', acceptance.acceptance_organization,
          'acceptancePerson', acceptance.acceptor,
          'acceptanceDate', acceptance.acceptance_date,
          'acceptanceConclusion', acceptance.acceptance_conclusion,
          'warrantyOwner', acceptance.warranty_owner,
          'warrantyStartDate', acceptance.warranty_start_date,
          'warrantyEndDate', acceptance.warranty_end_date,
          'warrantyConfirmationOrganization', acceptance.warranty_confirmation_organization,
          'warrantyConfirmationDate', acceptance.warranty_confirmation_date,
          'warrantyConfirmationNote', acceptance.warranty_confirmation_note
        ) AS acceptance_lifecycle_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', lifecycle_event.id,
            'action', lifecycle_event.action,
            'fromStatus', lifecycle_event.from_status,
            'toStatus', lifecycle_event.to_status,
            'actorId', lifecycle_event.actor_id,
            'actorName', lifecycle_event.actor_name,
            'occurredAt', lifecycle_event.occurred_at,
            'note', lifecycle_event.note
          ))
          FROM project_acceptance_lifecycle_events lifecycle_event
          WHERE lifecycle_event.acceptance_id = acceptance.id
          ORDER BY lifecycle_event.occurred_at, lifecycle_event.id
        ), '[]') AS lifecycle_events_json,
        acceptance.created_at,
        acceptance.updated_at,
        acceptance.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM project_acceptances acceptance

      UNION ALL

      SELECT
        settlement.id,
        settlement.name,
        settlement.project_id,
        settlement.contract_id,
        NULL AS supplier_id,
        settlement.settlement_amount AS amount,
        settlement.audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'final_settlement' AS kind,
        settlement.no,
        'final_settlement' AS document_type,
        'owner_final_settlement' AS source_type,
        CASE WHEN settlement.status <> 'draft' THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        settlement.submission_date AS application_date,
        settlement.audited_date AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        settlement.status,
        CASE settlement.status
          WHEN 'submitted' THEN '已提交甲方结算资料'
          WHEN 'audited' THEN '甲方已审定'
          ELSE ''
        END AS status_note,
        settlement.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'owner_final_settlement'
            AND file_ref.owner_id = settlement.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        settlement.created_at,
        settlement.updated_at,
        settlement.deleted_at,
        settlement.basis AS settlement_basis,
        settlement.difference_note AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM owner_final_settlements settlement

      UNION ALL

      SELECT
        penalty.id,
        penalty.reason AS name,
        penalty.project_id,
        penalty.contract_id,
        NULL AS supplier_id,
        penalty.amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_penalty' AS kind,
        penalty.no,
        'owner_penalty' AS document_type,
        'owner_penalty' AS source_type,
        CASE WHEN penalty.status <> 'draft' THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        penalty.penalty_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        penalty.status,
        CASE WHEN penalty.status = 'submitted' THEN '已提交甲方罚扣事实' ELSE '' END AS status_note,
        penalty.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'owner_penalty'
            AND file_ref.owner_id = penalty.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        penalty.created_at,
        penalty.updated_at,
        penalty.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        penalty.notice_no,
        penalty.reason AS penalty_reason,
        penalty.appeal_note
      FROM owner_penalties penalty

      UNION ALL

      SELECT
        subcontract_change.id,
        subcontract_change.reason AS name,
        subcontract_change.project_id,
        subcontract_change.contract_id,
        subcontract_change.supplier_id,
        subcontract_change.approved_amount AS amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        subcontract_change.changed_area,
        subcontract_change.actual_approved_price,
        'sub_change' AS kind,
        subcontract_change.no,
        subcontract_change.change_type AS document_type,
        'subcontract_change_order' AS source_type,
        CASE WHEN subcontract_change.status NOT IN ('draft', 'rejected') THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        subcontract_change.change_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        subcontract_change.status,
        CASE WHEN subcontract_change.status = 'submitted' THEN '已提交分包变洽签'
             WHEN subcontract_change.status = 'approved' THEN '分包变洽签已审批'
             ELSE '' END AS status_note,
        subcontract_change.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'subcontract_change_order'
            AND file_ref.owner_id = subcontract_change.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        subcontract_change.created_at,
        subcontract_change.updated_at,
        subcontract_change.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM subcontract_change_orders subcontract_change

      UNION ALL

      SELECT
        settlement.id,
        settlement.name,
        settlement.project_id,
        settlement.contract_id,
        settlement.supplier_id,
        settlement.total_amount AS amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'sub_settlement' AS kind,
        settlement.no,
        settlement.settlement_type AS document_type,
        'expenditure_settlement' AS source_type,
        CASE WHEN settlement.status NOT IN ('draft') THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        settlement.settlement_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        settlement.status,
        CASE WHEN settlement.status = 'confirmed' THEN '已确认分包结算'
             ELSE '' END AS status_note,
        settlement.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'expenditure_settlement'
            AND file_ref.owner_id = settlement.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        settlement.created_at,
        settlement.updated_at,
        settlement.deleted_at,
        '' AS settlement_basis,
        settlement.deduction_note AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM expenditure_settlements settlement
      WHERE settlement.biz_type IN ('分包', '专业分包', '合同劳务')
    ) owner_document
    ORDER BY kind, id
  `,
  workers: `
    SELECT id, name, crew_id, current_project_id, deleted_at
    FROM workers
    ORDER BY id
  `,
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
    return {
      ...entity,
      references: {
        crewId: nullableText(row.crew_id),
        projectId: nullableText(row.current_project_id),
      },
    }
  }
  if (entityType === 'construction_contracts') {
    return {
      ...entity,
      references: {
        projectId: nullableText(row.project_id),
        customerId: nullableText(row.customer_id),
      },
      amount: nullableMoney(row.amount),
      attributes: {
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
        boqCatalogJson: normalizeBoqCatalogJson(row.boq_catalog_json),
        monthlyQuantityFactsJson: normalizeMonthlyQuantityFactsJson(row.monthly_quantity_facts_json),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      },
    }
  }
  if (entityType === 'subcontract_contracts') {
    return {
      ...entity,
      references: {
        projectId: nullableText(row.project_id),
        supplierId: nullableText(row.supplier_id),
      },
      amount: nullableMoney(row.amount),
      attributes: {
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

const PROJECT_PENALTY_SOURCE_SQL = `
  SELECT penalty.id, penalty.reason AS name, penalty.no,
    penalty.source AS penalty_origin,
    penalty.projectId AS project_id, penalty.crewId AS crew_id,
    penalty.supplier_id,
    CASE WHEN EXISTS (SELECT 1 FROM contracts c WHERE c.id = penalty.contract_id AND c.kind = '其他支出') THEN 'other_expense:' || penalty.contract_id ELSE penalty.contract_id END AS contract_id,
    CASE WHEN EXISTS (SELECT 1 FROM contracts c WHERE c.id = penalty.contract_id AND c.kind = '其他支出') THEN 'other_expense' ELSE 'subcontract' END AS contract_kind,
    penalty.amount,
    'project_penalty' AS kind, 'penalty_record' AS source_type,
    CASE WHEN penalty.status <> 'draft' THEN 1 ELSE 0 END AS source_locked,
    penalty.penaltyDate AS application_date, penalty.status,
    penalty.deduction_method AS document_type, penalty.deduction_method,
    penalty.deadline, penalty.rectification_note, penalty.note,
    penalty.createdAt AS created_at, penalty.updated_at, penalty.deleted_at,
    (SELECT json_group_array(json_object(
      'id', d.id, 'settlementId', d.settlement_id, 'amount', d.amount,
      'occurredAt', strftime('%Y-%m-%dT%H:%M:%fZ', d.created_at),
      'actorId', '', 'commandId', '', 'note', d.note))
      FROM penalty_settlement_deductions d WHERE d.penalty_id = penalty.id AND d.deleted_at IS NULL) AS penalty_deductions_json,
    (SELECT json_group_array(json_object(
      'id', f.id, 'fileName', f.file_name, 'fileSize', f.file_size, 'mimeType', f.mime_type,
      'category', f.category, 'uploader', f.uploader, 'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at))
      FROM file_refs f WHERE f.owner_type = 'penalty_record' AND f.owner_id = penalty.id) AS files_json
  FROM penalty_records penalty WHERE penalty.source = 'project'
    OR EXISTS (SELECT 1 FROM penalty_settlement_deductions d JOIN expenditure_settlements s ON s.id = d.settlement_id WHERE d.penalty_id = penalty.id AND s.biz_type IN ('机械', '其他', '其他支出'))
`

type SourceSelect = <T extends Record<string, unknown>>(sql: string) => Promise<T[]>

async function buildSource(
  schemaVersion: number,
  selectSource: SourceSelect,
): Promise<CoreMigrationSourceDTO> {
  const credentialGraphs = await readSupplierCredentialMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> }, schemaVersion)
  const entries = await Promise.all(CORE_MIGRATION_TOPOLOGY.map(async (entityType) => {
    if (entityType === 'supplier_credentials')
      return [entityType, credentialGraphs] as const
    if (entityType === 'suppliers')
      return [entityType, credentialGraphs.map(entity => ({ legacyId: entity.legacyId, name: entity.name, deletedAt: entity.deletedAt, attributes: supplierCredentialMasterAttributes(JSON.parse(String(entity.attributes?.graphJson)).supplier) }))] as const
    if (entityType === 'process_libraries')
      return [entityType, await readProcessLibraryMigrationGraphs({ select: <T>(sql: string) => selectSource(sql) as Promise<T[]> })] as const
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
    const sql = ENTITY_SQL[entityType]
    const rows = await selectSource<Record<string, unknown>>(sql)
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
  const selectSnapshot: SourceSelect = async <T extends Record<string, unknown>>(sql: string) => {
    const statement = database.prepare(sql)
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
    isNative: isTauri,
    isDemoActive: () => useDataVisibilityStore().includeDemo,
    currentSchemaVersion: async () => getCurrentVersion(await getDb()),
    select: async <T extends Record<string, unknown>>(sql: string) => {
      const database = await getDb()
      return database.select<T>(sql)
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
    if (dependencies.isNative())
      throw problem('browser-only', '本地快照迁移首版仅支持浏览器工作区')
    if (dependencies.isDemoActive())
      throw problem('demo-source-not-allowed', '请先关闭“包含测试数据”，再迁移正式本地数据')
    return buildSource(await dependencies.currentSchemaVersion(), dependencies.select)
  }

  async function createBackup(expectedSourceHash: string): Promise<BrowserDatabaseBackupMetadata> {
    if (dependencies.isNative())
      throw problem('browser-only', '本地快照迁移首版仅支持浏览器工作区')
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
    if (dependencies.isNative())
      throw problem('browser-only', '本地快照迁移首版仅支持浏览器工作区')
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
    await dependencies.closeDatabase()
    await dependencies.prepareMigration(marker)
  }

  async function abortSwitch(): Promise<void> {
    await dependencies.clearMigration()
  }

  async function confirmSwitch(marker: BrowserCoreMigrationMarker): Promise<void> {
    await dependencies.closeDatabase()
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
