/** 原工作簿及成功导入行的不可变绑定；历史仅有摘要的来源不会补造正文。 */
export const PRODUCTION_INVOICE_WORKBOOK_TABLES = ['invoice_import_workbooks', 'invoice_import_workbook_rows'] as const

export const PRODUCTION_INVOICE_WORKBOOK_SCHEMA = `
CREATE TABLE invoice_import_workbooks(
 id TEXT PRIMARY KEY, file_ref_id TEXT NOT NULL UNIQUE REFERENCES file_refs(id),
 sha256 TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE invoice_import_workbook_rows(
 command_id TEXT PRIMARY KEY, workbook_id TEXT NOT NULL REFERENCES invoice_import_workbooks(id),
 invoice_id TEXT NOT NULL REFERENCES invoices(id), command_kind TEXT NOT NULL CHECK(command_kind IN ('import','correction')),
 sheet_name TEXT NOT NULL, row_number INTEGER NOT NULL CHECK(row_number>0), source_json TEXT NOT NULL,
 mapping_json TEXT NOT NULL CHECK(json_valid(mapping_json))
);
CREATE INDEX invoice_import_workbook_rows_source ON invoice_import_workbook_rows(workbook_id,sheet_name,row_number);
CREATE TRIGGER invoice_import_workbooks_no_update BEFORE UPDATE ON invoice_import_workbooks BEGIN SELECT RAISE(ABORT,'invoice workbook is immutable'); END;
CREATE TRIGGER invoice_import_workbooks_no_delete BEFORE DELETE ON invoice_import_workbooks BEGIN SELECT RAISE(ABORT,'invoice workbook is immutable'); END;
CREATE TRIGGER invoice_import_workbooks_no_replace BEFORE INSERT ON invoice_import_workbooks WHEN EXISTS(SELECT 1 FROM invoice_import_workbooks WHERE id=NEW.id OR file_ref_id=NEW.file_ref_id OR sha256=NEW.sha256) BEGIN SELECT RAISE(ABORT,'invoice workbook is immutable'); END;
CREATE TRIGGER invoice_import_workbook_rows_no_update BEFORE UPDATE ON invoice_import_workbook_rows BEGIN SELECT RAISE(ABORT,'invoice workbook row is immutable'); END;
CREATE TRIGGER invoice_import_workbook_rows_no_delete BEFORE DELETE ON invoice_import_workbook_rows BEGIN SELECT RAISE(ABORT,'invoice workbook row is immutable'); END;
CREATE TRIGGER invoice_import_workbook_rows_no_replace BEFORE INSERT ON invoice_import_workbook_rows WHEN EXISTS(SELECT 1 FROM invoice_import_workbook_rows WHERE command_id=NEW.command_id) BEGIN SELECT RAISE(ABORT,'invoice workbook row is immutable'); END;
CREATE TRIGGER invoice_import_sources_no_replace BEFORE INSERT ON invoice_import_sources WHEN EXISTS(SELECT 1 FROM invoice_import_sources WHERE command_id=NEW.command_id OR (file_digest=NEW.file_digest AND sheet_name=NEW.sheet_name AND row_number=NEW.row_number)) BEGIN SELECT RAISE(ABORT,'invoice import source is immutable'); END;
CREATE TRIGGER invoice_workbook_file_no_update BEFORE UPDATE ON file_refs WHEN EXISTS(SELECT 1 FROM invoice_import_workbooks WHERE file_ref_id=OLD.id) BEGIN SELECT RAISE(ABORT,'invoice workbook metadata is immutable'); END;
CREATE TRIGGER invoice_workbook_file_no_delete BEFORE DELETE ON file_refs WHEN EXISTS(SELECT 1 FROM invoice_import_workbooks WHERE file_ref_id=OLD.id) BEGIN SELECT RAISE(ABORT,'invoice workbook metadata is immutable'); END;
CREATE TRIGGER invoice_workbook_file_no_replace BEFORE INSERT ON file_refs WHEN EXISTS(SELECT 1 FROM invoice_import_workbooks WHERE file_ref_id=NEW.id) BEGIN SELECT RAISE(ABORT,'invoice workbook metadata is immutable'); END;
CREATE TRIGGER invoice_workbook_payload_no_update BEFORE UPDATE ON file_payloads WHEN EXISTS(SELECT 1 FROM invoice_import_workbooks WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'invoice workbook bytes are immutable'); END;
CREATE TRIGGER invoice_workbook_payload_no_delete BEFORE DELETE ON file_payloads WHEN EXISTS(SELECT 1 FROM invoice_import_workbooks WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'invoice workbook bytes are immutable'); END;
CREATE TRIGGER invoice_workbook_payload_no_replace BEFORE INSERT ON file_payloads WHEN EXISTS(SELECT 1 FROM invoice_import_workbooks WHERE file_ref_id=NEW.file_ref_id) BEGIN SELECT RAISE(ABORT,'invoice workbook bytes are immutable'); END;
`
