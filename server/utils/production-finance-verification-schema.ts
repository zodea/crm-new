export const PRODUCTION_FINANCE_VERIFICATION_STORAGE_VERSION = 13
export const PRODUCTION_FINANCE_VERIFICATION_TABLES = ['finance_payment_verifications'] as const
/** Additive upgrade: original application text, cash, allocations and old frozen history remain untouched. */
export const PRODUCTION_FINANCE_VERIFICATION_SCHEMA = `
CREATE TABLE finance_payment_verifications (
 id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES payment_applications(id),
 application_version INTEGER NOT NULL CHECK(application_version>0), command_id TEXT NOT NULL REFERENCES finance_commands(command_id),
 workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, verified_at TEXT NOT NULL, proof_json TEXT NOT NULL,
 UNIQUE(application_id,application_version)
);
CREATE TRIGGER finance_payment_verifications_no_update BEFORE UPDATE ON finance_payment_verifications
 BEGIN SELECT RAISE(ABORT,'payment verification evidence is immutable'); END;
CREATE TRIGGER finance_payment_verifications_no_delete BEFORE DELETE ON finance_payment_verifications
 BEGIN SELECT RAISE(ABORT,'payment verification evidence is immutable'); END;
`
