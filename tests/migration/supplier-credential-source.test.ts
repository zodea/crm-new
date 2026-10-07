import type { TestDb } from '../helpers/memory-db'
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSupplierCredentialMigrationGraph, readSupplierCredentialMigrationGraphs, supplierCredentialMasterAttributes, supplierCredentialMasterDraft } from '~/lib/migration/supplier-credential-source'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const at = '2026-09-12 08:00:00'
const pdf = Buffer.from('%PDF-1.7\nlegacy credential').toString('base64')

describe('分供方证照完整物理图来源', () => {
  let db: TestDb | undefined
  afterEach(() => db?.close())

  async function setup() {
    db = await createMigratedMemoryDb()
    await db.execute(`INSERT INTO suppliers (id, name, unique_code, tax_no, credential_status, credential_reviewed_at, credential_review_note,
      taxpayer_verification_status, taxpayer_verification_source, taxpayer_verified_at, taxpayer_verification_note, created_at, updated_at)
      VALUES ('old-supplier', '旧分供方', 'INTERNAL-123456789012345678', 'TAX-ORIGINAL', 'qualified', ?, '原人工备注', 'confirmed_general', '人工官网查询', ?, '历史核验备注', ?, ?)`, [at, at, at, at])
    await db.execute(`INSERT INTO supplier_credentials (id, supplier_id, category, file_name, file_path, file_ref_id,
      ocr_result, ocr_confidence, ocr_confirmed_result, ocr_confirmed_at, ocr_review_status, verified_at, added_at, deleted_at)
      VALUES ('old-credential', 'old-supplier', '营业执照', '原件.pdf', 'C:/old/原件.pdf', NULL, ?, 0.85, ?, ?, 'pending', ?, ?, ?)`, ['{"rawText":"原始候选保留"}', '{"name":"前次已确认值"}', at, at, at, at])
    await db.execute(`INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_path, file_size, mime_type, category, uploader, uploaded_at, deleted_at)
      VALUES ('old-file', 'supplier_credential', 'old-credential', '原件.pdf', 'C:/old/原件.pdf', ?, 'application/pdf', '营业执照', '', ?, ?)`, [Buffer.from(pdf, 'base64').length, at, at])
    await db.execute('UPDATE supplier_credentials SET file_ref_id = \'old-file\' WHERE id = \'old-credential\'')
    await db.execute(`INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES ('old-file', 'base64', ?)`, [pdf])
    await db.execute(`INSERT INTO supplier_credential_requirements (id, supplier_id, category, requirement, reason, updated_at, deleted_at)
      VALUES ('old-required', 'old-supplier', '品牌授权书', 'required', '旧明确要求', ?, ?)`, [at, at])
    await db.execute(`INSERT INTO supplier_credential_audits (id, supplier_id, credential_id, action, category_before, category_after, changed_fields, created_at)
      VALUES ('old-credential-audit', 'old-supplier', 'old-credential', 'credential_delete', '营业执照', '营业执照', '["deleted_at"]', ?)`, [at])
    await db.execute(`INSERT INTO supplier_audits (id, supplier_id, action, outcome, changed_fields, note_present, created_at)
      VALUES ('old-supplier-audit', 'old-supplier', 'credential_review', 'qualified', '["credentialStatus"]', 1, ?)`, [at])
    return db
  }

  it('从真实 SQLite 保留 7 类事实、软删、原始及确认 OCR 和供应商级凭证，不迁移内部码到税号', async () => {
    const source = await setup()
    const entities = await readSupplierCredentialMigrationGraphs(source)
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ legacyId: 'old-supplier', name: '旧分供方', references: { supplierId: 'old-supplier' } })
    const graph = JSON.parse(String(entities[0]!.attributes!.graphJson))
    expect(graph.supplier).toMatchObject({ unique_code: 'INTERNAL-123456789012345678', tax_no: 'TAX-ORIGINAL', credential_status: 'qualified', credential_reviewed_at: '2026-09-12T08:00:00.000Z', credential_review_note: '原人工备注', taxpayer_verification_note: '历史核验备注' })
    expect(graph.credentials[0]).toMatchObject({ id: 'old-credential', supplier_id: 'old-supplier', ocr_result: '{"rawText":"原始候选保留"}', ocr_confirmed_result: '{"name":"前次已确认值"}', ocr_review_status: 'pending', deleted_at: '2026-09-12T08:00:00.000Z' })
    expect(graph.requirements).toHaveLength(1)
    expect(graph.files[0]).toMatchObject({ id: 'old-file', owner_id: 'old-credential', file_path: 'C:/old/原件.pdf', deleted_at: '2026-09-12T08:00:00.000Z' })
    expect(graph.payloads).toEqual([{ file_ref_id: 'old-file', encoding: 'base64', content: pdf }])
    expect(graph.credentialAudits).toHaveLength(1)
    expect(graph.supplierAudits).toHaveLength(1)
  })

  it('没有正文的旧路径仅保留线索，空分供方也导出可核对的空图', async () => {
    const source = await setup()
    await source.execute('DELETE FROM file_payloads WHERE file_ref_id = \'old-file\'')
    await source.execute('INSERT INTO suppliers (id, name) VALUES (\'empty-supplier\', \'尚无证照\')')
    const entities = await readSupplierCredentialMigrationGraphs(source)
    const graph = JSON.parse(String(entities.find(row => row.legacyId === 'old-supplier')!.attributes!.graphJson))
    expect(graph.files[0].file_path).toBe('C:/old/原件.pdf')
    expect(graph.payloads).toEqual([])
    expect(JSON.parse(String(entities.find(row => row.legacyId === 'empty-supplier')!.attributes!.graphJson)).credentials).toEqual([])
  })

  it('主档投影保留独立内部码、税号、工商银行字段和税务凭证，不允许投影人工资料结论', async () => {
    const source = await setup()
    await source.execute('UPDATE suppliers SET aliases = \'["旧称甲","旧称乙"]\', bank_account = \'old-bank-account\', labor_scope = \'旧劳务范围\', registered_capital = 100 WHERE id = \'old-supplier\'')
    const graph = JSON.parse(String((await readSupplierCredentialMigrationGraphs(source))[0]!.attributes!.graphJson))
    const draft = supplierCredentialMasterDraft(graph.supplier)
    expect(draft).toMatchObject({ aliases: ['旧称甲', '旧称乙'], uniqueCode: 'INTERNAL-123456789012345678', taxNo: 'TAX-ORIGINAL', bankAccount: 'old-bank-account', laborScope: '旧劳务范围', registeredCapital: 100, taxpayerVerifiedAt: '2026-09-12T08:00:00.000Z', taxpayerVerificationNote: '历史核验备注' })
    expect(draft).not.toHaveProperty('credentialStatus')
    expect(draft).not.toHaveProperty('credentialReviewNote')
    expect(supplierCredentialMasterAttributes(graph.supplier)).toMatchObject({ aliases: '["旧称甲","旧称乙"]', uniqueCode: 'INTERNAL-123456789012345678', taxNo: 'TAX-ORIGINAL', createdAt: '2026-09-12T08:00:00.000Z', updatedAt: '2026-09-12T08:00:00.000Z' })
  })

  it('明确读取 v47 无劳务范围列的旧快照，其他工商事实不丢失', async () => {
    const source = await setup()
    await source.execute('ALTER TABLE suppliers DROP COLUMN labor_scope')
    const graph = JSON.parse(String((await readSupplierCredentialMigrationGraphs(source, 47))[0]!.attributes!.graphJson))
    expect(graph.supplier).toMatchObject({ labor_scope: '', tax_no: 'TAX-ORIGINAL', unique_code: 'INTERNAL-123456789012345678' })
  })

  it('v50 仅新增材采归属表，证照完整物理图与 v49 相同，未知未来版本仍拒绝', async () => {
    const source = await setup()
    const legacy = await readSupplierCredentialMigrationGraphs(source, 49)
    expect(await readSupplierCredentialMigrationGraphs(source, 50)).toEqual(legacy)
    await expect(readSupplierCredentialMigrationGraphs(source, 999)).rejects.toThrow(/不支持/)
  })

  it('v51/v52/v53/v54/v55/v56 原样带出真实核验历史，旧 v49/v50 图不反造新记录，归属/结构损坏阻断', async () => {
    const source = await setup()
    await source.execute('UPDATE suppliers SET name=? WHERE id=?', ['更正后分供方', 'old-supplier'])
    const proof = (await source.select<Record<string, unknown>>('SELECT * FROM supplier_credential_review_history'))[0]!
    expect(proof).toMatchObject({ supplier_id: 'old-supplier', decision: 'qualified', reviewed_at: at, note: '原人工备注', actor_id: null })
    const v51 = await readSupplierCredentialMigrationGraphs(source, 51)
    expect(await readSupplierCredentialMigrationGraphs(source, 52)).toEqual(v51)
    expect(await readSupplierCredentialMigrationGraphs(source, 53)).toEqual(v51)
    expect(await readSupplierCredentialMigrationGraphs(source, 54)).toEqual(v51)
    expect(await readSupplierCredentialMigrationGraphs(source, 55)).toEqual(v51)
    expect(await readSupplierCredentialMigrationGraphs(source, 56)).toEqual(v51)
    const graph = JSON.parse(String(v51[0]!.attributes!.graphJson))
    expect(graph).toMatchObject({ schemaVersion: 2, reviewHistory: [{ id: proof.id, note: '原人工备注', actor_id: null, reviewed_at: '2026-09-12T08:00:00.000Z' }] })
    expect(JSON.parse(String((await readSupplierCredentialMigrationGraphs(source, 50))[0]!.attributes!.graphJson))).not.toHaveProperty('reviewHistory')
    const foreign = structuredClone(graph)
    foreign.reviewHistory[0].supplier_id = 'other-supplier'
    expect(() => parseSupplierCredentialMigrationGraph(foreign)).toThrow(/归属/)
    const missing = structuredClone(graph)
    delete missing.reviewHistory
    expect(() => parseSupplierCredentialMigrationGraph(missing)).toThrow(/完整/)
  })

  it('供应商已软删仍保留其证照和凭证，断裂物理祖先则阻断', async () => {
    const source = await setup()
    await source.execute('UPDATE suppliers SET deleted_at = ? WHERE id = \'old-supplier\'', [at])
    expect((await readSupplierCredentialMigrationGraphs(source))[0]!.deletedAt).toBe('2026-09-12T08:00:00.000Z')
    await source.execute('PRAGMA foreign_keys = OFF')
    await source.execute('UPDATE supplier_credentials SET supplier_id = \'missing\' WHERE id = \'old-credential\'')
    await expect(readSupplierCredentialMigrationGraphs(source)).rejects.toThrow(/祖先/)
  })

  it.each(['foreign-file', 'duplicate-file', 'duplicate-requirement', 'audit-parent', 'payload-size', 'payload-type', 'payload-noncanonical', 'ocr-json'] as const)('拒绝 %s 损坏图，不丢弃证据或补造关系', async (kind) => {
    const source = await setup()
    const graph = JSON.parse(String((await readSupplierCredentialMigrationGraphs(source))[0]!.attributes!.graphJson))
    if (kind === 'foreign-file')
      graph.files[0].owner_id = 'other-credential'
    if (kind === 'duplicate-file')
      graph.files.push({ ...graph.files[0] })
    if (kind === 'duplicate-requirement') {
      graph.requirements[0].deleted_at = null
      graph.requirements.push({ ...graph.requirements[0], id: 'other-required' })
    }
    if (kind === 'audit-parent')
      graph.credentialAudits[0].credential_id = 'missing'
    if (kind === 'payload-size')
      graph.files[0].file_size += 1
    if (kind === 'payload-type')
      graph.files[0].mime_type = 'image/png'
    if (kind === 'payload-noncanonical') {
      graph.files[0].file_size = 4
      graph.payloads[0].content = 'JVBERh=='
    }
    if (kind === 'ocr-json')
      graph.credentials[0].ocr_result = '{broken'
    expect(() => parseSupplierCredentialMigrationGraph(graph)).toThrow()
  })

  it.each(['invalid-date', 'invalid-flag', 'sensitive-audit', 'sensitive-outcome', 'sensitive-source'] as const)('拒绝 %s 非法事实，不向审计复制正文', async (kind) => {
    const source = await setup()
    const graph = JSON.parse(String((await readSupplierCredentialMigrationGraphs(source))[0]!.attributes!.graphJson))
    if (kind === 'invalid-date')
      graph.credentials[0].expires_at = '2026-02-30'
    if (kind === 'invalid-flag')
      graph.credentials[0].long_term = null
    if (kind === 'sensitive-audit')
      graph.supplierAudits[0].changed_fields = '["taxNo=SECRET-123"]'
    if (kind === 'sensitive-outcome')
      graph.supplierAudits[0].outcome = '退回备注正文'
    if (kind === 'sensitive-source')
      graph.supplierAudits[0].source_category = 'https://example.test/?taxNo=PRIVATE'
    expect(() => parseSupplierCredentialMigrationGraph(graph)).toThrow()
  })
})
