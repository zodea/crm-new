import type { CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import type { SupplierCredentialMigrationGraph } from '~/lib/migration/supplier-credential-source'
import { Buffer } from 'node:buffer'
import { beforeAll, describe, expect, it } from 'vitest'
import { readSupplierCredentialMigrationGraphs } from '~/lib/migration/supplier-credential-source'
import { currentCredentialStatus, emptySupplierCredentialAggregate } from '~/lib/supplier/credential-domain'
import { prepareSupplierCredentialMigration } from '../../server/utils/supplier-credential-migration'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const at = '2026-09-12T08:00:00.000Z'
const now = new Date(at)
const pdf = Buffer.from('%PDF-1.7\nold original').toString('base64')
let original: SupplierCredentialMigrationGraph
beforeAll(async () => {
  const db = await createMigratedMemoryDb()
  try {
    await db.execute('INSERT INTO suppliers (id, name, unique_code, tax_no, credential_status, credential_reviewed_at, credential_review_note) VALUES (\'legacy-supplier\', \'完整旧分供方\', \'INTERNAL-18-DIGITS\', \'ORIGINAL-TAX\', \'qualified\', ?, \'旧人工凭证\')', [at])
    for (const [index, category] of ['营业执照', '法人身份证', '银行账户资料'].entries()) {
      await db.execute('INSERT INTO supplier_credentials (id, supplier_id, category, file_name, ocr_result, ocr_confirmed_result, ocr_review_status, ocr_confirmed_at, added_at) VALUES (?, \'legacy-supplier\', ?, \'原件.pdf\', ?, ?, \'pending\', ?, ?)', [`credential-${index}`, category, '{"rawText":"保留原始结果"}', '{"previous":"保留已确认结果"}', at, at])
      await db.execute('INSERT INTO file_refs (id, owner_type, owner_id, file_name, mime_type, file_size, uploaded_at) VALUES (?, \'supplier_credential\', ?, \'原件.pdf\', \'application/pdf\', ?, ?)', [`file-${index}`, `credential-${index}`, Buffer.from(pdf, 'base64').length, at])
      await db.execute('UPDATE supplier_credentials SET file_ref_id = ? WHERE id = ?', [`file-${index}`, `credential-${index}`])
      await db.execute('INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES (?, \'base64\', ?)', [`file-${index}`, pdf])
    }
    original = JSON.parse(String((await readSupplierCredentialMigrationGraphs(db))[0]!.attributes!.graphJson))
  }
  finally { db.close() }
})

function snapshot(graph = structuredClone(original)): CoreMigrationSnapshotDTO {
  return { authority: 'central', activeBatchId: 'batch-credential', entities: [
    { entityType: 'suppliers', id: 'central-supplier', legacyId: 'legacy-supplier', name: '完整旧分供方', references: {}, attributes: {}, amount: null, quantity: null, deletedAt: graph.supplier.deleted_at as string | null, batchId: 'batch-credential' },
    { entityType: 'supplier_credentials', id: 'credential-scope', legacyId: 'legacy-supplier', name: '完整旧分供方', references: { supplierId: 'central-supplier' }, attributes: { graphJson: JSON.stringify(graph) }, amount: null, quantity: null, deletedAt: graph.supplier.deleted_at as string | null, batchId: 'batch-credential' },
  ] }
}
const rollback: CoreMigrationSnapshotDTO = { authority: 'local', activeBatchId: null, entities: [] }

describe('分供方证照迁移候选与恢复', () => {
  it('v51历史图保全原身份、原文和未知操作者，同批重复接管不重建历史', () => {
    const graph = structuredClone(original)
    graph.schemaVersion = 2
    graph.reviewHistory = [
      { id: 'native-history-1', supplier_id: 'legacy-supplier', decision: 'rejected', reviewed_at: '2026-09-10T08:00:00.000Z', note: '早期真实退回原因', actor_id: null, archived_at: at },
      { id: 'native-history-2', supplier_id: 'legacy-supplier', decision: 'qualified', reviewed_at: at, note: '旧人工凭证', actor_id: null, archived_at: at },
    ]
    const migrated = prepareSupplierCredentialMigration([], snapshot(graph), now).aggregates
    expect(migrated[0]!.reviewHistory).toEqual([
      expect.objectContaining({ note: '早期真实退回原因', actorId: null, historyIdentity: { id: expect.any(String), legacyId: 'native-history-1', archivedAt: at } }),
      expect.objectContaining({ note: '旧人工凭证', actorId: null, historyIdentity: { id: expect.any(String), legacyId: 'native-history-2', archivedAt: at } }),
    ])
    expect(new Set(migrated[0]!.reviewHistory!.map(proof => proof.historyIdentity!.id)).size).toBe(2)
    expect(prepareSupplierCredentialMigration(migrated, snapshot(graph), now)).toEqual({ aggregates: migrated, changed: false })
    expect(prepareSupplierCredentialMigration(migrated, rollback, now)).toEqual({ aggregates: [], changed: true })
    migrated[0]!.changedAfterMigration = true
    expect(() => prepareSupplierCredentialMigration(migrated, rollback, now)).toThrow('已阻止恢复')
  })
  it('完整 SQLite 图映射到唯一中央供应商并保原件字节、OCR 两份事实和未知人工操作者', () => {
    const result = prepareSupplierCredentialMigration([], snapshot(), now)
    expect(result.changed).toBe(true)
    const aggregate = result.aggregates[0]!
    expect(aggregate).toMatchObject({ supplierId: 'central-supplier', migrationBatchId: 'batch-credential', legacySupplierId: 'legacy-supplier', version: 1, changedAfterMigration: false, commands: [] })
    expect(aggregate.credentials).toHaveLength(3)
    expect(aggregate.credentials[0]).toMatchObject({ supplierId: 'central-supplier', legacyId: 'credential-0', ocrResult: { rawText: '保留原始结果' }, ocrConfirmedResult: { previous: '保留已确认结果' }, ocrReviewStatus: 'pending' })
    expect(aggregate.credentials[0]!.id).not.toBe('credential-0')
    expect(aggregate.files[0]).toMatchObject({ ownerId: aggregate.credentials[0]!.id, legacyId: 'file-0', payloadBase64: pdf })
    expect(aggregate.files[0]!.sha256).toHaveLength(64)
    expect(aggregate.review).toEqual({ decision: 'qualified', reviewedAt: at, note: '旧人工凭证', actorId: null })
    expect(currentCredentialStatus(aggregate, now)).toBe('qualified')
  })

  it('同批重复确认保留日常更正和稳定身份，不能用相同批次替换来源', () => {
    const current = prepareSupplierCredentialMigration([], snapshot(), now).aggregates
    current[0]!.changedAfterMigration = true
    current[0]!.version = 3
    current[0]!.credentials[0]!.expiresAt = '2030-01-01'
    const repeated = prepareSupplierCredentialMigration(current, snapshot(), now)
    expect(repeated).toEqual({ aggregates: current, changed: false })
    repeated.aggregates[0]!.credentials[0]!.expiresAt = '2040-01-01'
    expect(current[0]!.credentials[0]!.expiresAt).toBe('2030-01-01')
    const changed = structuredClone(original)
    changed.credentials[0]!.ocr_result = '{"rawText":"被替换的迁移来源"}'
    expect(() => prepareSupplierCredentialMigration(current, snapshot(changed), now)).toThrow(/来源内容/)
  })

  it.each(['no-proof', 'rejected-no-note', 'missing-payload', 'expired'] as const)('旧 %s 状态按当前事实重算，不用单证核验时间冒充供应商人工凭证', (kind) => {
    const graph = structuredClone(original)
    if (kind === 'no-proof') {
      graph.supplier.credential_reviewed_at = null
      graph.credentials[0]!.verified_at = at
    }
    if (kind === 'rejected-no-note') {
      graph.supplier.credential_status = 'rejected'
      graph.supplier.credential_review_note = ''
    }
    if (kind === 'missing-payload')
      graph.payloads = graph.payloads.filter(row => row.file_ref_id !== 'file-0')
    if (kind === 'expired')
      graph.credentials[0]!.expires_at = '2026-09-11'
    const aggregate = prepareSupplierCredentialMigration([], snapshot(graph), now).aggregates[0]!
    if (kind === 'no-proof' || kind === 'rejected-no-note')
      expect(aggregate.review).toBeNull()
    else
      expect(aggregate.review).toMatchObject({ decision: 'qualified', reviewedAt: at, note: '旧人工凭证' })
    expect(currentCredentialStatus(aggregate, now)).toBe(kind === 'no-proof' || kind === 'rejected-no-note' ? 'reviewing' : 'incomplete')
    if (kind === 'missing-payload')
      expect(aggregate.files[0]).toMatchObject({ payloadBase64: null, sha256: null })
  })

  it('有真实退回凭证时保留原因和未知操作者', () => {
    const graph = structuredClone(original)
    graph.supplier.credential_status = 'rejected'
    graph.supplier.credential_review_note = '请重新核对有效期限'
    const aggregate = prepareSupplierCredentialMigration([], snapshot(graph), now).aggregates[0]!
    expect(currentCredentialStatus(aggregate, now)).toBe('rejected')
    expect(aggregate.review).toMatchObject({ note: '请重新核对有效期限', actorId: null })
  })

  it('恢复仅移除本批未更改图，保留独立中央分供方证照', () => {
    const migrated = prepareSupplierCredentialMigration([], snapshot(), now).aggregates
    const independent = emptySupplierCredentialAggregate('independent-central-supplier')
    expect(prepareSupplierCredentialMigration([...migrated, independent], rollback, now)).toEqual({ aggregates: [independent], changed: true })
  })

  it.each(['daily-edit', 'independent-credential', 'independent-file', 'independent-requirement'] as const)('恢复遇到 %s 整体拒绝，不产生半份回滚', (kind) => {
    const current = prepareSupplierCredentialMigration([], snapshot(), now).aggregates
    const aggregate = current[0]!
    if (kind === 'daily-edit')
      aggregate.changedAfterMigration = true
    if (kind === 'independent-credential')
      aggregate.credentials.push({ ...aggregate.credentials[0]!, id: 'central-new', migrationBatchId: null })
    if (kind === 'independent-file')
      aggregate.files.push({ ...aggregate.files[0]!, id: 'central-new-file', migrationBatchId: null })
    if (kind === 'independent-requirement')
      aggregate.requirements.push({ id: 'central-requirement', supplierId: aggregate.supplierId, category: '资质证书', requirement: 'required', reason: '', updatedAt: at, deletedAt: null, migrationBatchId: null, legacyId: null })
    const before = structuredClone(current)
    expect(() => prepareSupplierCredentialMigration(current, rollback, now)).toThrow(/阻止恢复/)
    expect(current).toEqual(before)
  })

  it.each(['parent', 'name', 'delete', 'batch', 'duplicate'] as const)('拒绝 %s 错配且当前中央状态保持原样', (kind) => {
    const source = snapshot()
    if (kind === 'parent')
      source.entities[1]!.references.supplierId = 'missing'
    if (kind === 'name')
      source.entities[1]!.name = '同名不能补身份'
    if (kind === 'delete')
      source.entities[1]!.deletedAt = at
    if (kind === 'batch')
      source.entities[1]!.batchId = 'other-batch'
    if (kind === 'duplicate')
      source.entities.push(structuredClone(source.entities[1]!))
    const current = [emptySupplierCredentialAggregate('independent')]
    const expected = kind === 'batch' || kind === 'duplicate'
      ? '证照批次、供应商或来源身份重复/无效'
      : '供应商稳定身份、来源名称、批次或删除边界错配'
    expect(() => prepareSupplierCredentialMigration(current, source, now)).toThrow(expected)
    expect(current).toEqual([emptySupplierCredentialAggregate('independent')])
  })

  it.each(['current', 'ambiguous', 'restored-later', 'file-still-active', 'file-deleted-earlier'] as const)('旧删除 %s 只在能核对当前删除边界时授予恢复凭证', (kind) => {
    const graph = structuredClone(original)
    graph.credentials[0]!.deleted_at = at
    graph.files[0]!.deleted_at = at
    graph.credentialAudits.push({ id: 'old-delete', supplier_id: 'legacy-supplier', credential_id: 'credential-0', action: 'credential_delete', category_before: '营业执照', category_after: '营业执照', changed_fields: '["deleted_at"]', valid_from_before: '', valid_from_after: '', expires_at_before: '', expires_at_after: '', long_term_before: 0, long_term_after: 0, confidence: null, created_at: at })
    if (kind === 'ambiguous')
      graph.credentialAudits.push({ ...graph.credentialAudits[0]!, id: 'same-time-delete' })
    if (kind === 'restored-later')
      graph.credentialAudits.push({ ...graph.credentialAudits[0]!, id: 'later-restore', action: 'credential_restore', created_at: '2026-09-12T08:00:01.000Z' })
    if (kind === 'file-still-active')
      graph.files[0]!.deleted_at = null
    if (kind === 'file-deleted-earlier')
      graph.files[0]!.deleted_at = '2026-09-12T07:59:59.000Z'
    const aggregate = prepareSupplierCredentialMigration([], snapshot(graph), now).aggregates[0]!
    expect(aggregate.audits.filter(row => row.canRestore)).toHaveLength(kind === 'current' ? 1 : 0)
    expect(Boolean(aggregate.credentials[0]!.deletionToken)).toBe(kind === 'current')
    if (kind === 'current')
      expect(aggregate.audits[0]!.deletionToken).toBe(aggregate.credentials[0]!.deletionToken)
  })
})
