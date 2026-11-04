import { PRODUCTION_INVOICE_SCHEMA } from './production-invoice-schema'

// The v29 definition remains the authority for every unchanged column and guard.
const tables = {
  invoices: 'id,invoice_number,invoice_date,source_kind,invoice_type,buyer,buyer_tax_no,seller,seller_tax_no,amount,tax_amount,total_amount,tax_rate,remark,items_json,unrecognized_pages_json,ocr_status,completion_method,review_status,account_status,dup_status,print_count,print_rotation,owner_kind,project_id,supplier_id,archived_at,contract_domain,contract_id,contract_version,legacy_source,legacy_original_state,legacy_ambiguous_json,legacy_items_ambiguous,original_file_id,version,created_at,updated_at,deleted_at',
  invoice_command_receipts: 'command_id,workspace_id,actor_id,invoice_id,action,fingerprint,result_json,created_at',
  invoice_audits: 'id,invoice_id,command_id,actor_id,action,before_json,after_json,created_at',
  invoice_recognitions: 'id,invoice_id,command_id,actor_id,result_json,created_at',
  invoice_archive_evidence: 'id,invoice_id,command_id,actor_id,evidence_json,created_at',
  invoice_print_lines: 'command_id,invoice_id,actor_id,before_json,after_json,created_at',
  invoice_import_sources: 'command_id,invoice_id,file_digest,sheet_name,row_number,source_json',
  invoice_legacy_members: 'batch_id,invoice_id,genesis_command_id,evidence_json,evidence_sha256',
} as const

const names = Object.keys(tables)
const quoted = names.map(name => `'${name}'`).join(',')
function definition(name: string) {
  for (const [prefix, suffix] of [[`CREATE TABLE ${name}(`, ');'], [`CREATE INDEX ${name} `, ';'], [`CREATE TRIGGER ${name} `, 'END;']] as const) {
    const start = PRODUCTION_INVOICE_SCHEMA.indexOf(prefix)
    if (start < 0)
      continue
    const end = PRODUCTION_INVOICE_SCHEMA.indexOf(suffix, start + prefix.length)
    if (end >= 0)
      return PRODUCTION_INVOICE_SCHEMA.slice(start, end + suffix.length)
  }
  throw new Error(`发票 v29 结构缺少 ${name}`)
}
const guards = ['invoices_number', 'invoice_audits_invoice', 'invoice_print_lines_invoice', ...['invoice_audits', 'invoice_recognitions', 'invoice_archive_evidence', 'invoice_print_lines', 'invoice_import_sources', 'invoice_legacy_members'].flatMap(name => [`${name}_no_update`, `${name}_no_delete`])]
const allowedGuards = guards.map(name => `'${name}'`).join(',')
const mentions = names.map(name => `lower(coalesce(s.sql,'')) LIKE '%${name}%'`).join(' OR ')
const changedColumns = Object.entries(tables).map(([name, columns]) => `(SELECT group_concat(name,',') FROM pragma_table_xinfo('${name}')) IS NOT '${columns}'`).join(' OR ')

const companyInvoices = definition('invoices')
  .replace('owner_kind IN (\'project\',\'personal\')', 'owner_kind IN (\'project\',\'personal\',\'company\')')
  .replace('contract_domain IN (\'construction\',\'subcontract\',\'material\',\'auxiliary\')', 'contract_domain IN (\'construction\',\'subcontract\',\'material\',\'auxiliary\',\'company\')')
  .replace('(owner_kind=\'personal\' AND project_id IS NULL)', '(owner_kind IN (\'personal\',\'company\') AND project_id IS NULL)')
  .replace(/\n\);$/, `,
 CHECK(owner_kind IS NOT 'company' OR (project_id IS NULL AND (contract_domain IS NULL OR contract_domain='company') AND (account_status<>'archived' OR (contract_domain IS 'company' AND supplier_id IS NOT NULL)))),
 CHECK(contract_domain IS NOT 'company' OR owner_kind IS 'company')
);`)

/** Execute only inside the caller's numbered upgrade transaction. */
export const PRODUCTION_INVOICE_COMPANY_UPGRADE = `
CREATE TEMP TABLE invoice_company_upgrade_guard(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO invoice_company_upgrade_guard
SELECT CASE WHEN EXISTS (
 SELECT 1 FROM sqlite_schema s JOIN pragma_foreign_key_list(s.name) fk
 WHERE s.type='table' AND lower(fk."table") IN (${quoted}) AND lower(s.name) NOT IN (${quoted})
) OR EXISTS (
 SELECT 1 FROM sqlite_schema s
 WHERE s.sql IS NOT NULL AND (
   (s.type IN ('index','trigger') AND s.tbl_name IN (${quoted}) AND s.name NOT IN (${allowedGuards}))
   OR (s.type IN ('trigger','view') AND (${mentions}) AND s.name NOT IN (${allowedGuards}))
 )
) OR ${changedColumns}
  OR (SELECT COUNT(*) FROM sqlite_schema WHERE type IN ('index','trigger') AND name IN (${allowedGuards})) <> ${guards.length}
  OR NOT EXISTS (SELECT 1 FROM production_participants WHERE domain='invoices' AND schema_version=1)
THEN 0 ELSE 1 END;
DROP TABLE invoice_company_upgrade_guard;
${names.map(name => `CREATE TEMP TABLE invoice_company_copy_${name} AS SELECT rowid AS original_rowid,* FROM ${name};`).join('\n')}
${[...names].reverse().map(name => `DROP TABLE ${name};`).join('\n')}
${Object.entries(tables).map(([name, columns]) => `${name === 'invoices' ? companyInvoices : definition(name)}\nINSERT INTO ${name}(rowid,${columns}) SELECT original_rowid,${columns} FROM invoice_company_copy_${name};`).join('\n')}
${guards.map(definition).join('\n')}
${names.map(name => `DROP TABLE invoice_company_copy_${name};`).join('\n')}
UPDATE production_participants SET schema_version=2 WHERE domain='invoices' AND schema_version=1;
`
