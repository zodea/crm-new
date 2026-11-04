/** Existing applications keep an unknown domain until explicitly reselected. */
export const PRODUCTION_FINANCE_CONTRACT_TABLES = ['finance_contract_upgrade_anchor', 'finance_contract_legacy_history', 'finance_payment_invoice_coverage'] as const

export const PRODUCTION_FINANCE_CONTRACT_UPGRADE = `
CREATE TABLE finance_contract_upgrade_anchor(
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), legacy_history_count INTEGER NOT NULL CHECK(legacy_history_count>=0)
);
CREATE TABLE finance_contract_legacy_history(
  kind TEXT NOT NULL CHECK(kind IN ('payment_application','payment_record')), id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  command_id TEXT NOT NULL, actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)
    AND json_type(snapshot_json,'$.head')='object' AND json_type(snapshot_json,'$.head.id')='text'
    AND json_extract(snapshot_json,'$.head.id')=id
    AND (kind<>'payment_application' OR (json_type(snapshot_json,'$.head.contract_domain') IS NULL AND json_type(snapshot_json,'$.head.contract_version') IS NULL))),
  PRIMARY KEY(kind,id,version), FOREIGN KEY(kind,id,version) REFERENCES finance_history(kind,id,version)
);
INSERT INTO finance_contract_legacy_history(kind,id,version,command_id,actor_id,occurred_at,snapshot_json)
  SELECT kind,id,version,command_id,actor_id,occurred_at,snapshot_json FROM finance_history WHERE kind IN ('payment_application','payment_record');
INSERT INTO finance_contract_upgrade_anchor SELECT 1,COUNT(*) FROM finance_contract_legacy_history;
CREATE TRIGGER finance_contract_upgrade_anchor_no_insert BEFORE INSERT ON finance_contract_upgrade_anchor BEGIN SELECT RAISE(ABORT,'finance upgrade evidence is immutable'); END;
CREATE TRIGGER finance_contract_upgrade_anchor_no_update BEFORE UPDATE ON finance_contract_upgrade_anchor BEGIN SELECT RAISE(ABORT,'finance upgrade evidence is immutable'); END;
CREATE TRIGGER finance_contract_upgrade_anchor_no_delete BEFORE DELETE ON finance_contract_upgrade_anchor BEGIN SELECT RAISE(ABORT,'finance upgrade evidence is immutable'); END;
CREATE TRIGGER finance_contract_legacy_history_no_insert BEFORE INSERT ON finance_contract_legacy_history BEGIN SELECT RAISE(ABORT,'finance upgrade evidence is immutable'); END;
CREATE TRIGGER finance_contract_legacy_history_no_update BEFORE UPDATE ON finance_contract_legacy_history BEGIN SELECT RAISE(ABORT,'finance upgrade evidence is immutable'); END;
CREATE TRIGGER finance_contract_legacy_history_no_delete BEFORE DELETE ON finance_contract_legacy_history BEGIN SELECT RAISE(ABORT,'finance upgrade evidence is immutable'); END;
CREATE TABLE finance_payment_invoice_coverage(
  kind TEXT NOT NULL DEFAULT 'payment_record' CHECK(kind='payment_record'), record_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  command_id TEXT NOT NULL UNIQUE, coverage_json TEXT NOT NULL CHECK(json_valid(coverage_json) AND json_type(coverage_json)='array'),
  invoice_evidence_sha256 TEXT NOT NULL CHECK(length(invoice_evidence_sha256)=64 AND invoice_evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY(record_id,version), FOREIGN KEY(kind,record_id,version) REFERENCES finance_history(kind,id,version),
  FOREIGN KEY(command_id) REFERENCES finance_commands(command_id)
);
CREATE TRIGGER finance_payment_invoice_coverage_no_update BEFORE UPDATE ON finance_payment_invoice_coverage BEGIN SELECT RAISE(ABORT,'payment invoice coverage is immutable'); END;
CREATE TRIGGER finance_payment_invoice_coverage_no_delete BEFORE DELETE ON finance_payment_invoice_coverage BEGIN SELECT RAISE(ABORT,'payment invoice coverage is immutable'); END;
ALTER TABLE payment_applications ADD COLUMN contract_domain TEXT
  CHECK(contract_domain IS NULL OR contract_domain IN ('construction','subcontract','material','auxiliary','company'));
ALTER TABLE payment_applications ADD COLUMN contract_version TEXT CHECK(
  (contract_domain IS NULL AND contract_version IS NULL)
  OR (contract_domain IS NOT NULL AND contract_version IS NOT NULL
    AND length(contract_version)>0 AND contract_version NOT GLOB '*[^0-9]*' AND contract_version NOT LIKE '0%'
    AND ((contract_domain='company' AND company_expense_contract_id IS NOT NULL AND contract_id IS NULL)
      OR (contract_domain<>'company' AND contract_id IS NOT NULL AND company_expense_contract_id IS NULL)))
);
UPDATE production_participants SET schema_version=2 WHERE domain='finance' AND schema_version=1;
`
