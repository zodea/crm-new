import { CONTRACT_NUMBER_SCHEMA, CONTRACT_NUMBER_TABLES, OUR_SIGNATORY_SCHEMA, OUR_SIGNATORY_TABLES } from '../../app/lib/our-signatory/schema'
import { PRODUCTION_AUXILIARY_CONTRACT_SCHEMA, PRODUCTION_AUXILIARY_CONTRACT_TABLES } from './production-auxiliary-contract-schema'
import { PRODUCTION_BACKUP_SCHEMA, PRODUCTION_BACKUP_TABLES } from './production-backup-schema'
import { PRODUCTION_BOQ_IMPORT_SCHEMA, PRODUCTION_BOQ_IMPORT_TABLES, PRODUCTION_BOQ_SCHEMA, PRODUCTION_BOQ_TABLES } from './production-boq-schema'
import { PRODUCTION_CONSTRUCTION_CONTRACT_SCHEMA, PRODUCTION_CONSTRUCTION_CONTRACT_TABLES, PRODUCTION_CONSTRUCTION_IMPORT_SCHEMA, PRODUCTION_CONSTRUCTION_IMPORT_TABLES } from './production-construction-contract-schema'
import { PRODUCTION_CONSTRUCTION_SCOPE_CONTRACT_UPGRADE, PRODUCTION_CONSTRUCTION_SCOPE_SCHEMA, PRODUCTION_CONSTRUCTION_SCOPE_TABLES } from './production-construction-scope-schema'
import { PRODUCTION_CREW_WORKER_SCHEMA, PRODUCTION_CREW_WORKER_TABLES } from './production-crew-worker-schema'
import { PRODUCTION_FINANCE_CLEARANCE_SCHEMA, PRODUCTION_FINANCE_CLEARANCE_TABLES, PRODUCTION_OTHER_CLEARANCE_SCHEMA, PRODUCTION_OTHER_CLEARANCE_TABLES } from './production-finance-clearance-schema'
import { PRODUCTION_FINANCE_CONTRACT_TABLES, PRODUCTION_FINANCE_CONTRACT_UPGRADE } from './production-finance-contract-upgrade'
import { PRODUCTION_FINANCE_SCHEMA, PRODUCTION_FINANCE_TABLES } from './production-finance-schema'
import { PRODUCTION_FINANCE_VERIFICATION_SCHEMA, PRODUCTION_FINANCE_VERIFICATION_TABLES } from './production-finance-verification-schema'
import { PRODUCTION_INVOICE_COMPANY_UPGRADE } from './production-invoice-company-upgrade'
import { PRODUCTION_INVOICE_CORRECTION_SCHEMA, PRODUCTION_INVOICE_CORRECTION_TABLES } from './production-invoice-correction-schema'
import { INVOICE_ORIGINAL_VERIFICATION_SCHEMA, INVOICE_ORIGINAL_VERIFICATION_TABLES } from './production-invoice-original-verification-schema'
import { PRODUCTION_INVOICE_SCHEMA, PRODUCTION_INVOICE_TABLES } from './production-invoice-schema'
import { PRODUCTION_MASTER_READ_SCHEMA } from './production-master-read-schema'
import { PRODUCTION_MATERIAL_CONTRACT_SCHEMA, PRODUCTION_MATERIAL_CONTRACT_TABLES } from './production-material-contract-schema'
import { PRODUCTION_MATERIAL_QUOTATION_SCHEMA, PRODUCTION_MATERIAL_QUOTATION_TABLES } from './production-material-quotation-schema'
import { PRODUCTION_NOTIFICATION_SCHEMA, PRODUCTION_NOTIFICATION_TABLES } from './production-notification-schema'
import { PRODUCTION_OTHER_SETTLEMENT_SCHEMA, PRODUCTION_OTHER_SETTLEMENT_TABLES } from './production-other-settlement-schema'
import { PRODUCTION_OWNER_DOCUMENT_SCHEMA, PRODUCTION_OWNER_DOCUMENT_TABLES } from './production-owner-document-schema'
import { PRODUCTION_OWNER_SETTLEMENT_RESTORE_UPGRADE, PRODUCTION_OWNER_SETTLEMENT_UPGRADE } from './production-owner-settlement-schema'
import { PRODUCTION_PAYROLL_SCHEMA, PRODUCTION_PAYROLL_TABLES } from './production-payroll-schema'
import { PRODUCTION_PROCESS_LIBRARY_SCHEMA, PRODUCTION_PROCESS_LIBRARY_TABLES } from './production-process-library-schema'
import { PRODUCTION_PROJECT_SCHEMA, PRODUCTION_PROJECT_TABLES } from './production-project-schema'
import { PRODUCTION_QUANTITY_INTENT_SCHEMA, PRODUCTION_QUANTITY_INTENT_TABLES } from './production-quantity-intent-schema'
import { PRODUCTION_QUANTITY_SCHEMA, PRODUCTION_QUANTITY_TABLES } from './production-quantity-schema'
import { PRODUCTION_SUBCONTRACT_CONTRACT_SCHEMA, PRODUCTION_SUBCONTRACT_CONTRACT_TABLES } from './production-subcontract-contract-schema'
import { PRODUCTION_SUPPLIER_SCHEMA, PRODUCTION_SUPPLIER_TABLES } from './production-supplier-schema'
import { PRODUCTION_TARGET_COST_SCHEMA, PRODUCTION_TARGET_COST_TABLES } from './production-target-cost-schema'
import { PRODUCTION_WBS_SCHEMA, PRODUCTION_WBS_TABLES } from './production-wbs-schema'

export const PRODUCTION_STORAGE_VERSION = 36
/** Append a new numbered upgrade when a domain lands; never rewrite an applied step. */
export const PRODUCTION_STORAGE_UPGRADES = [
  { from: 1, to: 2, sql: PRODUCTION_PROCESS_LIBRARY_SCHEMA, participants: { 'process-library': { schemaVersion: 1, tables: PRODUCTION_PROCESS_LIBRARY_TABLES } } },
  { from: 2, to: 3, sql: PRODUCTION_PROJECT_SCHEMA, participants: { project: { schemaVersion: 1, tables: PRODUCTION_PROJECT_TABLES } } },
  { from: 3, to: 4, sql: PRODUCTION_SUPPLIER_SCHEMA, participants: { supplier: { schemaVersion: 1, tables: PRODUCTION_SUPPLIER_TABLES } } },
  { from: 4, to: 5, sql: PRODUCTION_BACKUP_SCHEMA, participants: { backup: { schemaVersion: 1, tables: PRODUCTION_BACKUP_TABLES } } },
  { from: 5, to: 6, sql: PRODUCTION_MATERIAL_CONTRACT_SCHEMA, participants: { 'material-contracts': { schemaVersion: 1, tables: PRODUCTION_MATERIAL_CONTRACT_TABLES } } },
  { from: 6, to: 7, sql: PRODUCTION_NOTIFICATION_SCHEMA, participants: { notifications: { schemaVersion: 1, tables: PRODUCTION_NOTIFICATION_TABLES } } },
  { from: 7, to: 8, sql: `${OUR_SIGNATORY_SCHEMA}\n${CONTRACT_NUMBER_SCHEMA}
    INSERT INTO production_participants VALUES('our-signatories',1);
    INSERT INTO production_participants VALUES('contract-number-registry',1);
    INSERT INTO contract_number_claims(owner_domain,contract_id,number,version,claimed_at)
      WITH versions AS (
        SELECT id,record_json AS evidence FROM material_contract_records WHERE parent_id IS NULL
        UNION ALL
        SELECT m.id,h.value FROM material_contract_records m,json_each(m.record_json,'$.history') h WHERE m.parent_id IS NULL
      ), formal AS (
        SELECT *,ROW_NUMBER() OVER(PARTITION BY id ORDER BY CAST(json_extract(evidence,'$.version') AS INTEGER) DESC) AS priority
        FROM versions WHERE COALESCE(json_extract(evidence,'$.draft.status'),'') NOT IN ('draft','草稿')
      )
      SELECT 'material-contracts',id,trim(json_extract(evidence,'$.draft.no')),CAST(json_extract(evidence,'$.version') AS TEXT),json_extract(evidence,'$.updatedAt')
      FROM formal WHERE priority=1 AND trim(COALESCE(json_extract(evidence,'$.draft.no'),''))<>'';
    INSERT INTO contract_number_history(id,owner_domain,contract_id,number,version,occurred_at,reason)
      SELECT 'material-'||id||'-v'||json_extract(record_json,'$.version'),'material-contracts',id,trim(json_extract(record_json,'$.draft.no')),CAST(json_extract(record_json,'$.version') AS TEXT),json_extract(record_json,'$.updatedAt'),'upgrade-evidence'
      FROM material_contract_records WHERE parent_id IS NULL AND trim(COALESCE(json_extract(record_json,'$.draft.no'),''))<>'';
    INSERT INTO contract_number_history(id,owner_domain,contract_id,number,version,occurred_at,reason)
      SELECT 'material-'||m.id||'-v'||json_extract(h.value,'$.version'),'material-contracts',m.id,trim(json_extract(h.value,'$.draft.no')),CAST(json_extract(h.value,'$.version') AS TEXT),json_extract(h.value,'$.updatedAt'),'upgrade-history'
      FROM material_contract_records m,json_each(m.record_json,'$.history') h
      WHERE m.parent_id IS NULL AND trim(COALESCE(json_extract(h.value,'$.draft.no'),''))<>'';`, participants: { 'our-signatories': { schemaVersion: 1, tables: OUR_SIGNATORY_TABLES }, 'contract-number-registry': { schemaVersion: 1, tables: CONTRACT_NUMBER_TABLES } } },
  { from: 8, to: 9, sql: PRODUCTION_MATERIAL_QUOTATION_SCHEMA, participants: { 'material-quotations': { schemaVersion: 1, tables: PRODUCTION_MATERIAL_QUOTATION_TABLES } } },
  { from: 9, to: 10, sql: PRODUCTION_FINANCE_SCHEMA, participants: { finance: { schemaVersion: 1, tables: PRODUCTION_FINANCE_TABLES } } },
  { from: 10, to: 11, sql: PRODUCTION_CREW_WORKER_SCHEMA, participants: { 'crew-worker': { schemaVersion: 1, tables: PRODUCTION_CREW_WORKER_TABLES } } },
  { from: 11, to: 12, sql: PRODUCTION_OTHER_SETTLEMENT_SCHEMA, participants: { 'other-settlements': { schemaVersion: 1, tables: PRODUCTION_OTHER_SETTLEMENT_TABLES } } },
  { from: 12, to: 13, sql: PRODUCTION_FINANCE_VERIFICATION_SCHEMA, participants: { finance: { schemaVersion: 1, tables: [...PRODUCTION_FINANCE_TABLES, ...PRODUCTION_FINANCE_VERIFICATION_TABLES] } } },
  { from: 13, to: 14, sql: `${PRODUCTION_FINANCE_CLEARANCE_SCHEMA}\n${PRODUCTION_OTHER_CLEARANCE_SCHEMA}`, participants: {
    'finance': { schemaVersion: 1, tables: [...PRODUCTION_FINANCE_TABLES, ...PRODUCTION_FINANCE_VERIFICATION_TABLES, ...PRODUCTION_FINANCE_CLEARANCE_TABLES] },
    'other-settlements': { schemaVersion: 1, tables: [...PRODUCTION_OTHER_SETTLEMENT_TABLES, ...PRODUCTION_OTHER_CLEARANCE_TABLES] },
  } },
  { from: 14, to: 15, sql: PRODUCTION_MASTER_READ_SCHEMA, participants: {} },
  { from: 15, to: 16, sql: PRODUCTION_TARGET_COST_SCHEMA, participants: { 'target-cost': { schemaVersion: 1, tables: PRODUCTION_TARGET_COST_TABLES } } },
  { from: 16, to: 17, sql: PRODUCTION_QUANTITY_SCHEMA, participants: { quantity: { schemaVersion: 1, tables: PRODUCTION_QUANTITY_TABLES } } },
  { from: 17, to: 18, sql: PRODUCTION_PAYROLL_SCHEMA, participants: { payroll: { schemaVersion: 1, tables: PRODUCTION_PAYROLL_TABLES } } },
  { from: 18, to: 19, sql: PRODUCTION_QUANTITY_INTENT_SCHEMA, participants: { quantity: { schemaVersion: 1, tables: [...PRODUCTION_QUANTITY_TABLES, ...PRODUCTION_QUANTITY_INTENT_TABLES] } } },
  { from: 19, to: 20, sql: PRODUCTION_WBS_SCHEMA, participants: { wbs: { schemaVersion: 1, tables: PRODUCTION_WBS_TABLES } } },
  { from: 20, to: 21, sql: PRODUCTION_CONSTRUCTION_CONTRACT_SCHEMA, participants: { 'construction-contracts': { schemaVersion: 1, tables: PRODUCTION_CONSTRUCTION_CONTRACT_TABLES } } },
  { from: 21, to: 22, sql: PRODUCTION_BOQ_SCHEMA, participants: { boq: { schemaVersion: 1, tables: PRODUCTION_BOQ_TABLES } } },
  { from: 22, to: 23, sql: PRODUCTION_CONSTRUCTION_IMPORT_SCHEMA, participants: { 'construction-contracts': { schemaVersion: 1, tables: [...PRODUCTION_CONSTRUCTION_CONTRACT_TABLES, ...PRODUCTION_CONSTRUCTION_IMPORT_TABLES] } } },
  { from: 23, to: 24, sql: PRODUCTION_CONSTRUCTION_SCOPE_SCHEMA, participants: { 'construction-scope': { schemaVersion: 1, tables: PRODUCTION_CONSTRUCTION_SCOPE_TABLES } } },
  { from: 24, to: 25, sql: PRODUCTION_BOQ_IMPORT_SCHEMA, participants: { boq: { schemaVersion: 1, tables: [...PRODUCTION_BOQ_TABLES, ...PRODUCTION_BOQ_IMPORT_TABLES] } } },
  { from: 25, to: 26, sql: PRODUCTION_SUBCONTRACT_CONTRACT_SCHEMA, participants: { 'subcontract-contracts': { schemaVersion: 1, tables: PRODUCTION_SUBCONTRACT_CONTRACT_TABLES } } },
  { from: 26, to: 27, sql: PRODUCTION_CONSTRUCTION_SCOPE_CONTRACT_UPGRADE, participants: { 'construction-scope': { schemaVersion: 2, tables: PRODUCTION_CONSTRUCTION_SCOPE_TABLES } } },
  { from: 27, to: 28, sql: PRODUCTION_AUXILIARY_CONTRACT_SCHEMA, participants: { 'auxiliary-contract': { schemaVersion: 1, tables: PRODUCTION_AUXILIARY_CONTRACT_TABLES } } },
  { from: 28, to: 29, sql: PRODUCTION_INVOICE_SCHEMA, participants: { invoices: { schemaVersion: 1, tables: PRODUCTION_INVOICE_TABLES } } },
  { from: 29, to: 30, sql: PRODUCTION_INVOICE_COMPANY_UPGRADE, participants: { invoices: { schemaVersion: 2, tables: PRODUCTION_INVOICE_TABLES } } },
  { from: 30, to: 31, sql: PRODUCTION_FINANCE_CONTRACT_UPGRADE, participants: { finance: { schemaVersion: 2, tables: [...PRODUCTION_FINANCE_TABLES, ...PRODUCTION_FINANCE_VERIFICATION_TABLES, ...PRODUCTION_FINANCE_CLEARANCE_TABLES, ...PRODUCTION_FINANCE_CONTRACT_TABLES] } } },
  { from: 31, to: 32, sql: `${PRODUCTION_INVOICE_CORRECTION_SCHEMA}\nUPDATE production_participants SET schema_version=3 WHERE domain='invoices' AND schema_version=2;`, participants: { invoices: { schemaVersion: 3, tables: [...PRODUCTION_INVOICE_TABLES, ...PRODUCTION_INVOICE_CORRECTION_TABLES] } } },
  { from: 32, to: 33, sql: `${INVOICE_ORIGINAL_VERIFICATION_SCHEMA}\nUPDATE production_participants SET schema_version=4 WHERE domain='invoices' AND schema_version=3;`, participants: { invoices: { schemaVersion: 4, tables: [...PRODUCTION_INVOICE_TABLES, ...PRODUCTION_INVOICE_CORRECTION_TABLES, ...INVOICE_ORIGINAL_VERIFICATION_TABLES] } } },
  { from: 33, to: 34, sql: PRODUCTION_OWNER_DOCUMENT_SCHEMA, participants: { 'owner-documents': { schemaVersion: 1, tables: PRODUCTION_OWNER_DOCUMENT_TABLES } } },
  { from: 34, to: 35, sql: `${PRODUCTION_OWNER_SETTLEMENT_UPGRADE}\nUPDATE production_participants SET schema_version=2 WHERE domain IN ('owner-documents','other-settlements');`, participants: { 'owner-documents': { schemaVersion: 2, tables: [...PRODUCTION_OWNER_DOCUMENT_TABLES, 'expenditure_settlements'] }, 'other-settlements': { schemaVersion: 2, tables: [...PRODUCTION_OTHER_SETTLEMENT_TABLES, ...PRODUCTION_OTHER_CLEARANCE_TABLES] } } },
  { from: 35, to: 36, sql: `${PRODUCTION_OWNER_SETTLEMENT_RESTORE_UPGRADE}\nUPDATE production_participants SET schema_version=3 WHERE domain='owner-documents';`, participants: { 'owner-documents': { schemaVersion: 3, tables: [...PRODUCTION_OWNER_DOCUMENT_TABLES, 'expenditure_settlements'] } } },
] as const

export function productionStorageManifest(version = PRODUCTION_STORAGE_VERSION) {
  if (!Number.isSafeInteger(version) || version < 1 || version > PRODUCTION_STORAGE_VERSION)
    throw new Error('此发布物不能验证该正式存储版本的完整清单。')
  const participants: Record<string, { schemaVersion: number, tables: readonly string[] }> = {
    customer: { schemaVersion: 1, tables: ['customer_revision', 'customers', 'file_refs', 'file_payloads', 'customer_command_receipts', 'customer_command_resolutions', 'customer_audits'] },
  }
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES) {
    if (upgrade.to <= version)
      Object.assign(participants, upgrade.participants)
  }
  return structuredClone({ schemaVersion: version, coreTables: ['production_metadata', 'production_participants'], participants })
}
export function productionParticipantVersions(version: number): Record<string, number> {
  return Object.fromEntries(Object.entries(productionStorageManifest(version).participants).map(([domain, value]) => [domain, value.schemaVersion]))
}
export const PRODUCTION_PARTICIPANTS = Object.keys(productionParticipantVersions(PRODUCTION_STORAGE_VERSION))

/** Frozen v1 bootstrap. Existing databases reach later domains through the numbered upgrades. */
export const PRODUCTION_STORAGE_SCHEMA = `
CREATE TABLE production_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL,
  workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('verification','production')), created_at TEXT NOT NULL
);
CREATE TABLE production_participants (domain TEXT PRIMARY KEY, schema_version INTEGER NOT NULL);
INSERT INTO production_participants VALUES ('customer',1);
CREATE TABLE customer_revision (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL);
INSERT INTO customer_revision VALUES(1,0);
CREATE TABLE customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
  tax_no TEXT NOT NULL DEFAULT '', legal_rep TEXT NOT NULL DEFAULT '', registered_address TEXT NOT NULL DEFAULT '',
  invoice_name TEXT NOT NULL DEFAULT '', bank TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL CHECK(version>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX customer_tax_number ON customers(tax_no) WHERE tax_no<>'';
CREATE TABLE file_refs (
  id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
  file_name TEXT NOT NULL, file_path TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL CHECK(file_size>=0),
  mime_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', uploader TEXT NOT NULL,
  uploaded_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX file_refs_owner ON file_refs(owner_type,owner_id);
CREATE TABLE file_payloads (
  file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id), content BLOB NOT NULL, sha256 TEXT NOT NULL
);
CREATE TABLE customer_command_receipts (
  command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id), fingerprint TEXT NOT NULL,
  action TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE customer_command_resolutions (
  command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, resolved_at TEXT NOT NULL
);
CREATE TABLE customer_audits (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
  command_id TEXT NOT NULL REFERENCES customer_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  actor_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
`
