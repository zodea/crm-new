/** 统一发票 owner。注册前须接通全部日常动作、财务来源与备份原件核验。 */
export const PRODUCTION_INVOICE_TABLES = ['invoices', 'invoice_revision', 'invoice_command_receipts', 'invoice_command_resolutions', 'invoice_audits', 'invoice_recognitions', 'invoice_archive_evidence', 'invoice_print_receipts', 'invoice_print_lines', 'invoice_import_sources', 'invoice_legacy_batches', 'invoice_legacy_members', 'invoice_legacy_commands', 'invoice_legacy_resolutions', 'invoice_legacy_retirements'] as const

export const PRODUCTION_INVOICE_SCHEMA = `
CREATE TABLE invoice_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO invoice_revision VALUES(1,0);
CREATE TABLE invoices(
 id TEXT PRIMARY KEY, invoice_number TEXT NOT NULL DEFAULT '', invoice_date TEXT NOT NULL DEFAULT '',
 source_kind TEXT NOT NULL CHECK(source_kind IN ('scan','manual','excel','legacy')),
 invoice_type TEXT NOT NULL DEFAULT '', buyer TEXT NOT NULL DEFAULT '', buyer_tax_no TEXT NOT NULL DEFAULT '',
 seller TEXT NOT NULL DEFAULT '', seller_tax_no TEXT NOT NULL DEFAULT '', amount REAL, tax_amount REAL, total_amount REAL,
 tax_rate TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]', unrecognized_pages_json TEXT NOT NULL DEFAULT '[]',
 ocr_status TEXT NOT NULL CHECK(ocr_status IN ('pending','failed','done')),
 completion_method TEXT CHECK(completion_method IS NULL OR completion_method IN ('ocr','manual','legacy')),
 review_status TEXT NOT NULL CHECK(review_status IN ('unreviewed','reviewed')),
 account_status TEXT NOT NULL CHECK(account_status IN ('none','archived')),
 dup_status TEXT NOT NULL DEFAULT 'normal' CHECK(dup_status IN ('normal','duplicate')),
 print_count INTEGER NOT NULL DEFAULT 0 CHECK(print_count>=0), print_rotation INTEGER NOT NULL DEFAULT 0 CHECK(print_rotation IN (0,90,180,270)),
 owner_kind TEXT CHECK(owner_kind IS NULL OR owner_kind IN ('project','personal')),
 project_id TEXT REFERENCES projects(id), supplier_id TEXT REFERENCES suppliers(id), archived_at TEXT,
 contract_domain TEXT CHECK(contract_domain IS NULL OR contract_domain IN ('construction','subcontract','material','auxiliary')),
 contract_id TEXT, contract_version TEXT,
 legacy_source TEXT CHECK(legacy_source IS NULL OR legacy_source IN ('scan','excel')),
 legacy_original_state TEXT CHECK(legacy_original_state IS NULL OR legacy_original_state IN ('recorded','legacy-path-unverified','session-original-unavailable','no-original-recorded')),
 legacy_ambiguous_json TEXT,
 legacy_items_ambiguous INTEGER CHECK(legacy_items_ambiguous IS NULL OR legacy_items_ambiguous IN (0,1)),
 original_file_id TEXT UNIQUE REFERENCES file_refs(id), version INTEGER NOT NULL CHECK(version>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 CHECK((owner_kind IS NULL AND project_id IS NULL) OR (owner_kind='personal' AND project_id IS NULL) OR (owner_kind='project' AND project_id IS NOT NULL)),
 CHECK((contract_domain IS NULL AND contract_id IS NULL AND contract_version IS NULL) OR (contract_domain IS NOT NULL AND contract_id IS NOT NULL AND contract_version IS NOT NULL)),
 CHECK((source_kind='legacy' AND legacy_source IS NOT NULL AND legacy_original_state IS NOT NULL AND legacy_ambiguous_json IS NOT NULL AND legacy_items_ambiguous IS NOT NULL) OR (source_kind<>'legacy' AND legacy_source IS NULL AND legacy_original_state IS NULL AND legacy_ambiguous_json IS NULL AND legacy_items_ambiguous IS NULL))
);
CREATE INDEX invoices_number ON invoices(invoice_number) WHERE invoice_number<>'';
CREATE TABLE invoice_command_receipts(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 invoice_id TEXT NOT NULL REFERENCES invoices(id), action TEXT NOT NULL, fingerprint TEXT NOT NULL,
 result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE invoice_command_resolutions(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, resolved_at TEXT NOT NULL
);
CREATE TABLE invoice_audits(
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
 command_id TEXT NOT NULL REFERENCES invoice_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER invoice_audits_no_update BEFORE UPDATE ON invoice_audits BEGIN SELECT RAISE(ABORT,'invoice audit is immutable'); END;
CREATE TRIGGER invoice_audits_no_delete BEFORE DELETE ON invoice_audits BEGIN SELECT RAISE(ABORT,'invoice audit is immutable'); END;
CREATE INDEX invoice_audits_invoice ON invoice_audits(invoice_id);
CREATE TABLE invoice_recognitions(
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
 command_id TEXT NOT NULL UNIQUE REFERENCES invoice_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
 actor_id TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER invoice_recognitions_no_update BEFORE UPDATE ON invoice_recognitions BEGIN SELECT RAISE(ABORT,'invoice recognition is immutable'); END;
CREATE TRIGGER invoice_recognitions_no_delete BEFORE DELETE ON invoice_recognitions BEGIN SELECT RAISE(ABORT,'invoice recognition is immutable'); END;
CREATE TABLE invoice_archive_evidence(
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
 command_id TEXT NOT NULL UNIQUE REFERENCES invoice_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
 actor_id TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER invoice_archive_evidence_no_update BEFORE UPDATE ON invoice_archive_evidence BEGIN SELECT RAISE(ABORT,'invoice archive evidence is immutable'); END;
CREATE TRIGGER invoice_archive_evidence_no_delete BEFORE DELETE ON invoice_archive_evidence BEGIN SELECT RAISE(ABORT,'invoice archive evidence is immutable'); END;
CREATE TABLE invoice_print_receipts(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE invoice_print_lines(
 command_id TEXT NOT NULL REFERENCES invoice_print_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
 invoice_id TEXT NOT NULL REFERENCES invoices(id), actor_id TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(command_id,invoice_id)
);
CREATE TRIGGER invoice_print_lines_no_update BEFORE UPDATE ON invoice_print_lines BEGIN SELECT RAISE(ABORT,'invoice print history is immutable'); END;
CREATE TRIGGER invoice_print_lines_no_delete BEFORE DELETE ON invoice_print_lines BEGIN SELECT RAISE(ABORT,'invoice print history is immutable'); END;
CREATE INDEX invoice_print_lines_invoice ON invoice_print_lines(invoice_id);
CREATE TABLE invoice_import_sources(
 command_id TEXT PRIMARY KEY REFERENCES invoice_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
 invoice_id TEXT NOT NULL REFERENCES invoices(id), file_digest TEXT NOT NULL,
 sheet_name TEXT NOT NULL, row_number INTEGER NOT NULL CHECK(row_number>0), source_json TEXT NOT NULL,
 UNIQUE(file_digest,sheet_name,row_number)
);
CREATE TRIGGER invoice_import_sources_no_update BEFORE UPDATE ON invoice_import_sources BEGIN SELECT RAISE(ABORT,'invoice import source is immutable'); END;
CREATE TRIGGER invoice_import_sources_no_delete BEFORE DELETE ON invoice_import_sources BEGIN SELECT RAISE(ABORT,'invoice import source is immutable'); END;
CREATE TABLE invoice_legacy_batches(
 id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, evidence_json TEXT NOT NULL, evidence_sha256 TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE invoice_legacy_members(
 batch_id TEXT NOT NULL REFERENCES invoice_legacy_batches(id), invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
 genesis_command_id TEXT NOT NULL UNIQUE REFERENCES invoice_command_receipts(command_id), evidence_json TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,
 PRIMARY KEY(batch_id,invoice_id)
);
CREATE TABLE invoice_legacy_commands(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('publish','retire')),
 fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE invoice_legacy_resolutions(command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, resolved_at TEXT NOT NULL);
CREATE TABLE invoice_legacy_retirements(
 batch_id TEXT PRIMARY KEY REFERENCES invoice_legacy_batches(id), command_id TEXT NOT NULL UNIQUE REFERENCES invoice_legacy_commands(command_id), retired_at TEXT NOT NULL
);
CREATE TRIGGER invoice_legacy_batches_no_update BEFORE UPDATE ON invoice_legacy_batches BEGIN SELECT RAISE(ABORT,'legacy invoice batch is immutable'); END;
CREATE TRIGGER invoice_legacy_batches_no_delete BEFORE DELETE ON invoice_legacy_batches BEGIN SELECT RAISE(ABORT,'legacy invoice batch is immutable'); END;
CREATE TRIGGER invoice_legacy_members_no_update BEFORE UPDATE ON invoice_legacy_members BEGIN SELECT RAISE(ABORT,'legacy invoice evidence is immutable'); END;
CREATE TRIGGER invoice_legacy_members_no_delete BEFORE DELETE ON invoice_legacy_members BEGIN SELECT RAISE(ABORT,'legacy invoice evidence is immutable'); END;
CREATE TRIGGER invoice_legacy_commands_no_update BEFORE UPDATE ON invoice_legacy_commands BEGIN SELECT RAISE(ABORT,'legacy invoice receipt is immutable'); END;
CREATE TRIGGER invoice_legacy_commands_no_delete BEFORE DELETE ON invoice_legacy_commands BEGIN SELECT RAISE(ABORT,'legacy invoice receipt is immutable'); END;
CREATE TRIGGER invoice_legacy_retirements_no_update BEFORE UPDATE ON invoice_legacy_retirements BEGIN SELECT RAISE(ABORT,'legacy invoice retirement is immutable'); END;
CREATE TRIGGER invoice_legacy_retirements_no_delete BEFORE DELETE ON invoice_legacy_retirements BEGIN SELECT RAISE(ABORT,'legacy invoice retirement is immutable'); END;
INSERT INTO production_participants VALUES('invoices',1);
`
