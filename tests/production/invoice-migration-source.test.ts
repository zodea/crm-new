import type { SQLInputValue } from 'node:sqlite'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { previewLegacyInvoiceMappings, validateLegacyCompanyInvoiceMappings, validateLegacyInvoiceMappings } from '../../server/utils/production-invoice-migration-mapping'
import { prepareLegacyInvoicePlan, validateLegacyInvoiceEntry } from '../../server/utils/production-invoice-migration-plan'
import { previewProtectedLegacyInvoices, readLegacyInvoiceSource } from '../../server/utils/production-invoice-migration-source'

const sourceSql = `
    CREATE TABLE invoices(id TEXT PRIMARY KEY,file_name TEXT,file_path TEXT,file_size TEXT,page_count INTEGER,invoice_type TEXT,invoice_number TEXT,invoice_date TEXT,buyer TEXT,buyer_tax_no TEXT,seller TEXT,seller_tax_no TEXT,amount REAL,tax_amount REAL,total_amount REAL,tax_rate TEXT,remark TEXT,project_id TEXT,project_name TEXT,supplier_id TEXT,contract_id TEXT,ocr_status TEXT,review_status TEXT,account_status TEXT,dup_status TEXT,source TEXT,owner_kind TEXT,print_rotation INTEGER,print_count INTEGER,ocr_confidence REAL,confirmed_at TEXT,archived_at TEXT,items TEXT,field_confidence TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE payment_applications(id TEXT PRIMARY KEY,project_id TEXT,supplier_id TEXT,deleted_at TEXT);
    CREATE TABLE payment_application_invoice_allocations(id TEXT PRIMARY KEY,invoice_id TEXT,payment_application_id TEXT,allocated_amount REAL,deleted_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,deleted_at TEXT);
    CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT,deleted_at TEXT);
    CREATE TABLE contracts(id TEXT PRIMARY KEY,name TEXT,kind TEXT,project_id TEXT,supplier_id TEXT,deleted_at TEXT);
    CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,file_path TEXT,file_size INTEGER);
    CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY,encoding TEXT,content TEXT);
    CREATE TABLE operation_logs(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,before_data TEXT,after_data TEXT);
    INSERT INTO projects VALUES('project-one','合成项目',NULL);
    INSERT INTO contracts VALUES('contract-one','合成采购合同','材采','project-one',NULL,NULL);
    INSERT INTO invoices(id,invoice_number,amount,tax_amount,total_amount,source,file_path,project_id) VALUES('invoice-one','000123',0,0,100,'scan','','project-one');
    INSERT INTO payment_applications VALUES('payment-one','project-one',NULL,NULL);
    INSERT INTO payment_application_invoice_allocations VALUES('allocation-one','invoice-one','payment-one',25,'2026-01-01T00:00:00Z');
    INSERT INTO operation_logs VALUES('audit-one','invoices','invoice-one',NULL,'{}');
    INSERT INTO operation_logs VALUES('audit-orphan','invoices','missing-invoice',NULL,'{}');`

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec(sourceSql)
  const tx = {
    async execute() { throw new Error('来源不得写入') },
    async select<T>(statement: string, params: unknown[] = []) { return sql.prepare(statement).all(...params as SQLInputValue[]) as T[] },
  }
  return { sql, tx, evidence: { sha256: 'a'.repeat(64), schemaVersion: 60 } }
}

describe('旧发票来源预检', () => {
  it('隔离核查区分同 ID 的原公司合同与普通合同，缺表、断链及交叉归属不猜测', async () => {
    const f = fixture()
    try {
      f.sql.exec(`ALTER TABLE invoices ADD COLUMN company_expense_contract_id TEXT;
        CREATE TABLE company_expense_contracts(id TEXT PRIMARY KEY,name TEXT,deleted_at TEXT);
        INSERT INTO company_expense_contracts VALUES('contract-one','合成公司合同',NULL);
        UPDATE invoices SET company_expense_contract_id='contract-one',project_id=NULL,owner_kind='personal' WHERE id='invoice-one';
        UPDATE payment_applications SET project_id=NULL;
        INSERT INTO invoices(id,contract_id,project_id) VALUES('invoice-two','contract-one','project-one');`)
      const inspected = await readLegacyInvoiceSource(f.tx, f.evidence, { inspectCompany: true })
      expect(inspected.schema).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'table', name: 'company_expense_contracts' })]))
      expect(inspected.references).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'contracts', id: 'contract-one', row: expect.objectContaining({ name: '合成采购合同' }) }),
        expect.objectContaining({ table: 'company_expense_contracts', id: 'contract-one', row: expect.objectContaining({ name: '合成公司合同' }) }),
      ]))
      await expect(readLegacyInvoiceSource(f.tx, f.evidence)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('公司支出合同关联尚未接通') } })
      f.sql.exec('UPDATE invoices SET contract_id=\'contract-one\' WHERE id=\'invoice-one\'')
      await expect(readLegacyInvoiceSource(f.tx, f.evidence, { inspectCompany: true })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      f.sql.exec('UPDATE invoices SET contract_id=NULL,company_expense_contract_id=\'missing-company\' WHERE id=\'invoice-one\'')
      await expect(readLegacyInvoiceSource(f.tx, f.evidence, { inspectCompany: true })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    }
    finally { f.sql.close() }
  })

  it('公司票逐条显式核对合同、分供方及我方主体，缺项和权限变化整批拒绝', async () => {
    const f = fixture()
    try {
      f.sql.exec(`ALTER TABLE invoices ADD COLUMN company_expense_contract_id TEXT;
        CREATE TABLE company_expense_contracts(id TEXT PRIMARY KEY,name TEXT,deleted_at TEXT);
        INSERT INTO company_expense_contracts VALUES('company-one','合成公司合同',NULL);
        UPDATE invoices SET company_expense_contract_id='company-one',project_id=NULL,owner_kind='personal',ocr_status='pending',review_status='unreviewed',account_status='none',dup_status='normal',print_count=0,print_rotation=0,items='[]' WHERE id='invoice-one';
        UPDATE payment_applications SET project_id=NULL;`)
      const source = await readLegacyInvoiceSource(f.tx, f.evidence, { inspectCompany: true })
      const actor = { workspaceId: 'workspace-one', actorId: 'owner-one', capabilities: ['our-signatory:read', 'supplier:list:read'] }
      const row = { invoiceId: 'invoice-one', legacyContractId: 'company-one', target: { domain: 'company' as const, id: 'company-target', version: '2' }, supplierId: 'supplier-target', supplierVersion: '3', supplierSourceVersion: 'suppliers:8', buyerId: 'buyer-target', buyerVersion: '1' }
      const dependencies = {
        readReference: (async () => ({ serverId: row.supplierId, version: row.supplierVersion, sourceVersion: row.supplierSourceVersion })) as never,
        readBuyer: (async () => ({ id: row.buyerId, version: row.buyerVersion })) as never,
        verifyCompany: (async (_tx: unknown, _actor: unknown, _target: unknown, _supplier: unknown, _buyer: unknown, sha: string, legacyId: string) => {
          expect(sha).toBe(source.sha256)
          expect(legacyId).toBe('company-one')
          return {}
        }) as never,
      }
      const result = await validateLegacyCompanyInvoiceMappings(f.tx, actor, source, [row], new Map(), dependencies)
      expect(result.get('invoice-one')).toEqual(row)
      const mapping = { mapped: new Map<string, string>(), contractByLegacy: new Map(), dependenciesMissing: [], orphanLogCount: 0 }
      expect(() => prepareLegacyInvoicePlan(source, mapping)).toThrow('旧公司发票缺少明确')
      const plan = prepareLegacyInvoicePlan(source, { ...mapping, companyByInvoice: result })
      expect(plan.entries[0]).toMatchObject({ projectId: null, supplierId: 'supplier-target', contract: row.target, sourceHead: { owner_kind: 'personal', company_expense_contract_id: 'company-one' }, companyAdoption: row })
      expect(validateLegacyInvoiceEntry(plan.entries[0]!).ownerKind).toBe('company')
      const central = { select: async () => [] } as never
      const validated = await validateLegacyInvoiceMappings(central, actor, source, { projects: [], suppliers: [], contracts: [], companyInvoices: [row] }, dependencies)
      expect(validated.dependenciesMissing).toEqual(['allocation-one'])
      expect(() => prepareLegacyInvoicePlan(source, validated)).toThrow('旧付款分摊尚未完整迁入')
      expect(prepareLegacyInvoicePlan(source, validated, { allowIncompleteHistory: true }).entries[0]).toMatchObject({ companyAdoption: row, sourceHead: { owner_kind: 'personal' } })
      await expect(validateLegacyCompanyInvoiceMappings(f.tx, actor, source, [], new Map(), dependencies)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      await expect(validateLegacyCompanyInvoiceMappings(f.tx, actor, source, [{ ...row, legacyContractId: 'other-one' }], new Map(), dependencies)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      await expect(validateLegacyCompanyInvoiceMappings(f.tx, { ...actor, capabilities: [] }, source, [row], new Map(), dependencies)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      await expect(validateLegacyCompanyInvoiceMappings(f.tx, actor, source, [row], new Map(), { ...dependencies, readReference: (async () => ({ serverId: row.supplierId, version: '4', sourceVersion: row.supplierSourceVersion })) as never })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    }
    finally { f.sql.close() }
  })

  it('公司合同引用尚不能迁入时整批拒绝，缺列或空值仍可按旧流程读取', async () => {
    const f = fixture()
    try {
      // 旧版来源可能没有公司合同列，也可能已经具备该列但尚无关系。
      expect((await readLegacyInvoiceSource(f.tx, f.evidence)).graph).toHaveLength(1)
      f.sql.exec('ALTER TABLE invoices ADD COLUMN company_expense_contract_id TEXT')
      expect((await readLegacyInvoiceSource(f.tx, f.evidence)).graph).toHaveLength(1)
      f.sql.exec('UPDATE invoices SET company_expense_contract_id=\'\'')
      expect((await readLegacyInvoiceSource(f.tx, f.evidence)).graph).toHaveLength(1)

      f.sql.exec('INSERT INTO invoices(id) VALUES(\'invoice-other\'); UPDATE invoices SET company_expense_contract_id=\'company-one\', project_id=NULL, owner_kind=\'personal\' WHERE id=\'invoice-one\'; UPDATE payment_applications SET project_id=NULL')
      await expect(readLegacyInvoiceSource(f.tx, f.evidence)).rejects.toMatchObject({
        problem: { code: 'validation-failed', message: expect.stringContaining('公司支出合同关联尚未接通') },
      })
      expect(f.sql.prepare('SELECT company_expense_contract_id FROM invoices WHERE id=?').get('invoice-one')).toEqual({ company_expense_contract_id: 'company-one' })
      expect(f.sql.prepare('SELECT id FROM invoices ORDER BY id').all()).toEqual([{ id: 'invoice-one' }, { id: 'invoice-other' }])
    }
    finally { f.sql.close() }
  })

  it('受保护快照只读校验摘要、权限和会话变化，不返回原路径及日志正文', async () => {
    const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') })
    const database = new SQL.Database()
    database.run(sourceSql)
    database.run('ALTER TABLE invoices ADD COLUMN extension_blob BLOB; ALTER TABLE invoices ADD COLUMN extension_integer INTEGER; UPDATE invoices SET extension_blob=x\'00FF\',extension_integer=CAST(\'9223372036854775807\' AS INTEGER)')
    database.run('CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(60)')
    const bytes = database.export()
    database.run('ALTER TABLE invoices ADD COLUMN company_expense_contract_id TEXT; CREATE TABLE company_expense_contracts(id TEXT PRIMARY KEY,name TEXT,deleted_at TEXT); INSERT INTO company_expense_contracts VALUES(\'company-one\',\'合成公司合同\',NULL); UPDATE invoices SET company_expense_contract_id=\'company-one\',project_id=NULL,owner_kind=\'personal\'; UPDATE payment_applications SET project_id=NULL')
    const companyBytes = database.export()
    database.close()
    const source = { payloadBase64: Buffer.from(bytes).toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
    const identity = { workspaceId: 'workspace-one', actorId: 'owner-one' }
    const actor = { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:import'] }
    const preview = await previewProtectedLegacyInvoices(source, identity, () => actor)
    expect(preview).toMatchObject({ invoices: [{ legacyId: 'invoice-one', invoiceNumber: '000123', sourceState: 'session-original-unavailable', ambiguousZeroFields: ['amount', 'tax_amount'], historicalAllocationCount: 1 }], orphanLogCount: 1 })
    expect(JSON.stringify(preview)).not.toContain('audit-orphan')
    const companySource = { payloadBase64: Buffer.from(companyBytes).toString('base64'), sha256: createHash('sha256').update(companyBytes).digest('hex') }
    await expect(previewProtectedLegacyInvoices(companySource, identity, () => actor)).resolves.toMatchObject({ invoices: [{ legacyId: 'invoice-one', companyContractId: 'company-one' }], references: [{ table: 'company_expense_contracts', legacyId: 'company-one' }] })
    await expect(previewProtectedLegacyInvoices({ ...source, sha256: '0'.repeat(64) }, identity, () => actor)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(previewProtectedLegacyInvoices(source, identity, () => ({ ...actor, capabilities: [] }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    let calls = 0
    await expect(previewProtectedLegacyInvoices(source, identity, () => ++calls === 1 ? actor : { ...actor, capabilities: [] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })

  it('保留原 ID、已删除分摊、孤立审计和金额歧义，缺件不能当作空原件', async () => {
    const f = fixture()
    try {
      const source = await readLegacyInvoiceSource(f.tx, f.evidence)
      expect(source.graph).toMatchObject([{ head: { id: 'invoice-one', invoice_number: '000123', amount: 0, tax_amount: 0, total_amount: 100 }, originalState: 'session-original-unavailable', ambiguousZeroFields: ['amount', 'tax_amount'], allocations: [{ id: 'allocation-one', deleted_at: '2026-01-01T00:00:00Z' }], logs: [{ id: 'audit-one' }] }])
      expect(source.references).toMatchObject([{ table: 'projects', id: 'project-one' }])
      expect(source.orphanLogs).toMatchObject([{ id: 'audit-orphan' }])
    }
    finally { f.sql.close() }
  })

  it('断裂关系阻断预检，未知扩展列的 BLOB 和大整数保留精确原值', async () => {
    const f = fixture()
    try {
      f.sql.exec('UPDATE invoices SET project_id=\'missing-project\'')
      await expect(readLegacyInvoiceSource(f.tx, f.evidence)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      f.sql.exec('UPDATE invoices SET project_id=\'project-one\'; ALTER TABLE invoices ADD COLUMN extra BLOB; ALTER TABLE invoices ADD COLUMN extra_integer INTEGER; UPDATE invoices SET extra=x\'00FF\',extra_integer=CAST(\'9223372036854775807\' AS INTEGER); ALTER TABLE payment_application_invoice_allocations ADD COLUMN extra BLOB; UPDATE payment_application_invoice_allocations SET extra=x\'12AB\'; ALTER TABLE operation_logs ADD COLUMN extra_integer INTEGER; UPDATE operation_logs SET extra_integer=CAST(\'9223372036854775807\' AS INTEGER)')
      const source = await readLegacyInvoiceSource(f.tx, f.evidence)
      expect(source.graph[0]!.head).toMatchObject({ extra: { sqliteType: 'blob', exactValue: '00FF' }, extra_integer: { sqliteType: 'integer', exactValue: '9223372036854775807' } })
      expect(source.graph[0]!.allocations[0]).toMatchObject({ extra: { sqliteType: 'blob', exactValue: '12AB' } })
      expect(source.orphanLogs[0]).toMatchObject({ extra_integer: { sqliteType: 'integer', exactValue: '9223372036854775807' } })
      f.sql.exec('UPDATE invoices SET amount=CAST(\'9223372036854775807\' AS INTEGER)')
      await expect(readLegacyInvoiceSource(f.tx, f.evidence)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    }
    finally { f.sql.close() }
  })

  it('旧合同关系保留种类和原项目身份，不能按名称猜新合同', async () => {
    const f = fixture()
    try {
      f.sql.exec('UPDATE invoices SET contract_id=\'contract-one\'')
      const source = await readLegacyInvoiceSource(f.tx, f.evidence)
      expect(source.references).toContainEqual({ table: 'contracts', id: 'contract-one', row: { id: 'contract-one', name: '合成采购合同', kind: '材采', project_id: 'project-one', supplier_id: null, deleted_at: null } })
      f.sql.exec('UPDATE contracts SET project_id=\'different-project\'')
      await expect(readLegacyInvoiceSource(f.tx, f.evidence)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      f.sql.exec('DELETE FROM contracts')
      await expect(readLegacyInvoiceSource(f.tx, f.evidence)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    }
    finally { f.sql.close() }
  })

  it('完整来源与显式映射只读预检，付款历史缺口和期间撤权均如实返回', async () => {
    const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') })
    const sourceDb = new SQL.Database()
    sourceDb.run(sourceSql)
    sourceDb.run('CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(60)')
    sourceDb.run('UPDATE invoices SET ocr_status=\'pending\',review_status=\'unreviewed\',account_status=\'none\',dup_status=\'normal\',owner_kind=\'project\',print_count=0,print_rotation=0,items=\'[]\'')
    const bytes = sourceDb.export()
    sourceDb.run('UPDATE invoices SET owner_kind=NULL')
    const invalidOwnerBytes = sourceDb.export()
    sourceDb.run('UPDATE invoices SET owner_kind=\'project\'; ALTER TABLE file_refs ADD COLUMN file_name TEXT; INSERT INTO file_refs(id,owner_type,owner_id,file_path,file_size,file_name) VALUES(\'original-one\',\'invoice\',\'invoice-one\',\'\',3,\'original.png\'); INSERT INTO file_payloads VALUES(\'original-one\',\'base64\',\'YWJj\')')
    const invalidOriginalBytes = sourceDb.export()
    sourceDb.close()
    const central = new DatabaseSync(':memory:')
    central.exec('CREATE TABLE invoices(id TEXT PRIMARY KEY); CREATE TABLE file_refs(id TEXT PRIMARY KEY); CREATE TABLE payment_application_invoice_allocations(id TEXT PRIMARY KEY,invoice_id TEXT,payment_application_id TEXT,allocated_amount REAL,deleted_at TEXT)')
    const tx = {
      async execute() { throw new Error('映射预检不得写入') },
      async select<T>(statement: string, params: unknown[] = []) { return central.prepare(statement).all(...params as SQLInputValue[]) as T[] },
    }
    const identity = { workspaceId: 'workspace-one', actorId: 'owner-one' }
    const actor = { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:import', 'project:list:read'] }
    const storage = { identity, withTransaction: async (work: (target: typeof tx) => unknown) => work(tx) } as unknown as ProductionStorage
    const source = { payloadBase64: Buffer.from(bytes).toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
    const mappings = { projects: [{ legacyId: 'project-one', targetId: 'project-new', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [] }
    let permitted = true
    const session = () => permitted ? actor : { ...actor, capabilities: [] }
    const readReference = async () => ({ entityType: 'projects' as const, serverId: 'project-new', label: '合成项目', version: '1', sourceVersion: 'projects:1' })
    const envelope = (data: Uint8Array) => ({ payloadBase64: Buffer.from(data).toString('base64'), sha256: createHash('sha256').update(data).digest('hex') })
    try {
      expect(await previewLegacyInvoiceMappings(storage, { source, mappings }, session, { readReference })).toMatchObject({ sourceSha256: source.sha256, invoiceCount: 1, missingAllocationIds: ['allocation-one'], orphanLogCount: 1 })
      await expect(previewLegacyInvoiceMappings(storage, { source: envelope(invalidOwnerBytes), mappings }, session, { readReference })).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('旧归属与项目关系不一致') } })
      await expect(previewLegacyInvoiceMappings(storage, { source: envelope(invalidOriginalBytes), mappings }, session, { readReference })).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('旧原件格式') } })
      await expect(previewLegacyInvoiceMappings(storage, { source, mappings }, session, { readReference: async () => {
        permitted = false
        return readReference()
      } })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    }
    finally { central.close() }
  })

  it('迁入映射逐项核验项目和合同版本，付款历史不一致或 ID 冲突时整批阻断', async () => {
    const old = fixture()
    const central = new DatabaseSync(':memory:')
    try {
      old.sql.exec('UPDATE invoices SET contract_id=\'contract-one\'')
      const source = await readLegacyInvoiceSource(old.tx, old.evidence)
      central.exec('CREATE TABLE invoices(id TEXT PRIMARY KEY); CREATE TABLE payment_application_invoice_allocations(id TEXT PRIMARY KEY,invoice_id TEXT,payment_application_id TEXT,allocated_amount REAL,deleted_at TEXT)')
      const tx = {
        async execute() { throw new Error('预检不得写入') },
        async select<T>(statement: string, params: unknown[] = []) { return central.prepare(statement).all(...params as SQLInputValue[]) as T[] },
      }
      const actor = { workspaceId: 'workspace-one', actorId: 'owner-one', capabilities: ['project:list:read', 'material-contract:read'] }
      const mappings = { projects: [{ legacyId: 'project-one', targetId: 'project-new', version: '1', sourceVersion: 'projects:1' }], suppliers: [], contracts: [{ legacyId: 'contract-one', target: { domain: 'material' as const, id: 'contract-new', version: '2' } }] }
      const dependencies = {
        readReference: async () => ({ entityType: 'projects' as const, serverId: 'project-new', label: '合成项目', version: '1', sourceVersion: 'projects:1' }),
        verifyContract: async (_tx: unknown, _actor: unknown, target: { id: string, version: string }, projectId: string | null, supplierId: string | null) => ({ id: target.id, version: target.version, projectId, supplierId }),
      }
      const preview = await validateLegacyInvoiceMappings(tx, actor, source, mappings, dependencies)
      expect(preview.mapped.get('projects:project-one')).toBe('project-new')
      expect(preview.contractByLegacy.get('contract-one')).toMatchObject({ domain: 'material', id: 'contract-new', version: '2' })
      expect(preview.dependenciesMissing).toEqual(['allocation-one'])
      expect(() => prepareLegacyInvoicePlan(source, preview)).toThrow('旧付款分摊尚未完整迁入')
      await expect(validateLegacyInvoiceMappings(tx, actor, source, { ...mappings, projects: [{ ...mappings.projects[0]!, version: '2' }] }, dependencies)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      await expect(validateLegacyInvoiceMappings(tx, actor, source, { ...mappings, contracts: [{ ...mappings.contracts[0]!, target: { ...mappings.contracts[0]!.target, domain: 'construction' } }] }, dependencies)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      central.exec('INSERT INTO payment_application_invoice_allocations VALUES(\'allocation-one\',\'wrong-invoice\',\'payment-one\',25,\'2026-01-01T00:00:00Z\')')
      await expect(validateLegacyInvoiceMappings(tx, actor, source, mappings, dependencies)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      central.exec('DELETE FROM payment_application_invoice_allocations; ALTER TABLE payment_application_invoice_allocations ADD COLUMN note TEXT; INSERT INTO payment_application_invoice_allocations VALUES(\'allocation-one\',\'invoice-one\',\'payment-one\',25,\'2026-01-01T00:00:00Z\',\'新备注\')')
      old.sql.exec('ALTER TABLE payment_application_invoice_allocations ADD COLUMN note TEXT; UPDATE payment_application_invoice_allocations SET note=\'旧备注\'')
      const withNotes = await readLegacyInvoiceSource(old.tx, old.evidence)
      await expect(validateLegacyInvoiceMappings(tx, actor, withNotes, mappings, dependencies)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      central.exec('UPDATE payment_application_invoice_allocations SET note=\'旧备注\'; INSERT INTO payment_application_invoice_allocations VALUES(\'other-allocation\',\'invoice-one\',\'payment-other\',1,NULL,\'无来源\')')
      await expect(validateLegacyInvoiceMappings(tx, actor, withNotes, mappings, dependencies)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      central.exec('DELETE FROM payment_application_invoice_allocations WHERE id=\'other-allocation\'')
      const verified = await validateLegacyInvoiceMappings(tx, actor, withNotes, mappings, dependencies)
      const plan = prepareLegacyInvoicePlan(withNotes, verified)
      expect(plan.entries[0]).toMatchObject({ id: 'invoice-one', projectId: 'project-new', contract: { id: 'contract-new', domain: 'material' }, amounts: { amount: null, tax_amount: null, total_amount: 100 }, originalState: 'session-original-unavailable', sourceHead: { amount: 0, tax_amount: 0 }, sourceAllocations: [{ id: 'allocation-one', note: '旧备注' }] })
      expect(plan.orphanLogs).toMatchObject([{ id: 'audit-orphan' }])
      central.exec('DELETE FROM payment_application_invoice_allocations; INSERT INTO invoices VALUES(\'invoice-one\')')
      await expect(validateLegacyInvoiceMappings(tx, actor, source, mappings, dependencies)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    }
    finally {
      central.close()
      old.sql.close()
    }
  })
})
