export const INVOICE_ORIGINAL_VERIFICATION_TABLES = ['invoice_original_verifications'] as const

export const INVOICE_ORIGINAL_VERIFICATION_SCHEMA = `
CREATE TABLE invoice_original_verifications(
  command_id TEXT PRIMARY KEY REFERENCES invoice_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  invoice_version INTEGER NOT NULL CHECK(invoice_version>0),
  original_id TEXT NOT NULL REFERENCES file_refs(id),
  candidate_id TEXT REFERENCES invoice_original_verifications(command_id),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  UNIQUE(invoice_id,invoice_version)
);
CREATE TRIGGER invoice_original_verifications_no_update BEFORE UPDATE ON invoice_original_verifications BEGIN SELECT RAISE(ABORT,'invoice original verification is immutable'); END;
CREATE TRIGGER invoice_original_verifications_no_delete BEFORE DELETE ON invoice_original_verifications BEGIN SELECT RAISE(ABORT,'invoice original verification is immutable'); END;
ALTER TABLE invoice_print_lines ADD COLUMN verification_id TEXT REFERENCES invoice_original_verifications(command_id);
`
