import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CORE_MIGRATION_CAPABILITY,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_SOURCE_VERSION,
  coreMigrationSourceHashInput,
} from '~/lib/migration/core-contract'
import { buildOwnerCommercialDocumentDetail, parseOwnerCommercialDocumentDetailQuery } from '~/lib/owner-document/central-repository'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'

const session = {
  workspaceId: 'workspace-migration-323',
  actorId: 'actor-migration-323',
  capabilities: [CORE_MIGRATION_CAPABILITY, 'owner-document:read', 'owner-document:write'],
}

function source(): CoreMigrationSourceDTO {
  const withoutHash = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
    entities: {
      customers: [{ legacyId: 'customer-legacy-323', name: '既有甲方', deletedAt: null }],
      suppliers: [],
      crews: [],
      projects: [{
        legacyId: 'project-legacy-323',
        name: '既有施工项目',
        references: { customerId: 'customer-legacy-323', secondaryCustomerId: null },
        deletedAt: null,
      }],
      construction_contracts: [{
        legacyId: 'contract-legacy-323',
        name: '既有施工合同',
        references: { projectId: 'project-legacy-323', customerId: 'customer-legacy-323' },
        amount: '960000.00' as const,
        deletedAt: null,
        attributes: {
          no: 'SG-LEGACY-323',
          status: '履约中',
          boqCatalogJson: JSON.stringify([{
            id: 'boq-line-without-history-323',
            itemName: '未发生变更的管线',
            unit: 'm',
            qty: 40,
            unitPrice: 30,
          }, {
            id: 'boq-line-legacy-323',
            itemName: '桥架安装（现行目录）',
            unit: 'm',
            qty: 120,
            unitPrice: 65,
          }]),
          monthlyQuantityFactsJson: JSON.stringify([{
            periodNo: '2026-09',
            boqLineId: 'boq-line-without-history-323',
            autoQty: 12,
            missingQtyCount: 0,
            quantityBasis: 'field',
            sourceVersion: 'migration-field-2026-09-v1',
            sourceUpdatedAt: '2026-09-20T08:00:00.000Z',
          }]),
        },
      }],
      subcontract_contracts: [],
      contract_supplements: [],
      owner_documents: [
        {
          legacyId: 'change-legacy-323',
          name: '既有甲方变更',
          references: { projectId: 'project-legacy-323', contractId: 'contract-legacy-323' },
          amount: '520.00' as const,
          deletedAt: null,
          attributes: {
            kind: 'owner_change',
            no: 'BG-LEGACY-323',
            documentType: 'change_negotiation',
            sourceType: 'boq_change_order',
            sourceLocked: 1,
            periodNo: '',
            applicationDate: '2026-08-08',
            taxExclusiveAmount: 480,
            appliedTaxExclusiveAmount: 500,
            status: 'approved',
            statusNote: '甲方已签证',
            note: '由 BOQ 变更单导入，锁定台账不重复迁入',
            linesJson: JSON.stringify([{
              id: 'change-line-legacy-323',
              boqLineId: 'boq-line-legacy-323',
              operation: 'qty',
              itemName: '桥架安装',
              unit: 'm',
              contractQty: 100,
              contractUnitPrice: 52,
              deltaQty: 10,
              amount: 520,
            }, {
              id: 'change-line-added-legacy-323',
              boqLineId: 'boq-line-result-legacy-323',
              operation: 'add',
              itemName: '抗震支架',
              unit: '套',
              contractQty: 3,
              contractUnitPrice: 80,
              deltaQty: 3,
              newUnitPrice: 80,
              amount: 240,
            }]),
            filesJson: JSON.stringify([]),
            createdAt: '2026-08-08T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:00.000Z',
          },
        },
        {
          legacyId: 'report-legacy-323',
          name: '2026 年 8 月月度报量',
          references: { projectId: 'project-legacy-323', contractId: 'contract-legacy-323' },
          amount: '5200.00' as const,
          deletedAt: null,
          attributes: {
            kind: 'owner_report',
            no: 'BL-LEGACY-323',
            documentType: 'monthly_statement',
            sourceType: 'monthly_statement',
            sourceLocked: 0,
            periodNo: '2026-08',
            applicationDate: '2026-08-20',
            quantityBasis: 'field',
            quantitySourceVersion: 'legacy-monthly-323-v1',
            quantitySourceUpdatedAt: '2026-08-19T08:00:00.000Z',
            status: 'draft',
            statusNote: '',
            note: '',
            linesJson: JSON.stringify([{
              id: 'report-line-legacy-323',
              boqLineId: 'boq-line-legacy-323',
              itemName: '桥架安装',
              unit: 'm',
              contractQty: 100,
              contractUnitPrice: 52,
              autoQty: 100,
              reportedQty: 100,
              auditedQty: 90,
              amount: 5200,
              auditedAmount: 4680,
            }]),
            filesJson: JSON.stringify([]),
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-22T00:00:00.000Z',
          },
        },
      ],
      workers: [],
      project_suppliers: [],
    },
  }
  return {
    ...withoutHash,
    sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(withoutHash as CoreMigrationSourceDTO)).digest('hex'),
  } as CoreMigrationSourceDTO
}

describe('甲方商务单据受控中央迁移', () => {
  it.each([
    [0, 'approvalSequenceAt', 'invalid-time', '签证执行时间无效'],
    [0, 'applicationDate', '2026-02-30', '申报日期无效'],
    [0, 'approvalDate', '2026-02-30', '签证日期无效'],
    [1, 'quantitySourceUpdatedAt', 'invalid-time', '报量来源更新时间无效'],
    [1, 'submittedAt', 'invalid-time', '报量提交时间无效'],
    [0, 'filesJson', JSON.stringify([{ id: 'file-invalid-uploaded', uploadedAt: 'invalid-time' }]), '附件上传时间无效'],
    [0, 'filesJson', JSON.stringify([{ id: 'file-invalid-deleted', deletedAt: 'invalid-time' }]), '附件删除时间无效'],
  ] as const)('拒绝非法的迁移审计字段 #%s.%s', async (documentIndex, field, invalidValue, expectedMessage) => {
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-25T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const invalidSource = structuredClone(source())
    invalidSource.entities.owner_documents[documentIndex]!.attributes![field] = invalidValue
    const { sourceHash: _sourceHash, ...withoutHash } = invalidSource
    invalidSource.sourceHash = createHash('sha256')
      .update(coreMigrationSourceHashInput(withoutHash as CoreMigrationSourceDTO))
      .digest('hex')
    const envelope = (commandId: string) => ({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CORE_MIGRATION_CAPABILITY,
      commandId,
    })
    await core.preflight({ ...envelope(`preflight-invalid-${field}-323`), source: invalidSource, backup: null }, session)
    const snapshotSha256 = 'd'.repeat(64)
    const dryRun = await core.dryRun({
      ...envelope(`dry-run-invalid-${field}-323`),
      source: invalidSource,
      backup: {
        backupId: `core-migration-${invalidSource.sourceHash}-${snapshotSha256}`,
        sourceHash: invalidSource.sourceHash,
        sourceVersion: invalidSource.sourceVersion,
        snapshotSha256,
        byteLength: 323,
        createdAt: '2026-08-25T00:00:00.000Z',
        immutable: true,
      },
    }, session)
    await core.importBatch({ ...envelope(`import-invalid-${field}-323`), batchId: dryRun.batchId }, session)

    await expect(core.confirm({
      ...envelope(`confirm-invalid-${field}-323`),
      batchId: dryRun.batchId,
    }, session)).rejects.toThrow(expectedMessage)
  })

  it('确认后将两类既有单据同步到同一正式命令源，回滚后撤销切换', async () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-25T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
      afterRollback: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
      afterReset: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const migrationSource = source()
    const envelope = (commandId: string) => ({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CORE_MIGRATION_CAPABILITY,
      commandId,
    })
    await core.preflight({ ...envelope('preflight-323'), source: migrationSource, backup: null }, session)
    const snapshotSha256 = 'c'.repeat(64)
    const dryRun = await core.dryRun({
      ...envelope('dry-run-323'),
      source: migrationSource,
      backup: {
        backupId: `core-migration-${migrationSource.sourceHash}-${snapshotSha256}`,
        sourceHash: migrationSource.sourceHash,
        sourceVersion: migrationSource.sourceVersion,
        snapshotSha256,
        byteLength: 323,
        createdAt: '2026-08-25T00:00:00.000Z',
        immutable: true,
      },
    }, session)

    expect(dryRun.steps).toContainEqual({
      entityType: 'owner_documents',
      sourceCount: 2,
      importableCount: 2,
      skippedCount: 0,
    })
    await core.importBatch({ ...envelope('import-323'), batchId: dryRun.batchId }, session)
    await core.confirm({ ...envelope('confirm-323'), batchId: dryRun.batchId }, session)

    const rows = commands.rows()
    expect(rows.map(row => row.kind)).toEqual(['owner_change', 'owner_report'])
    expect(rows.filter(row => row.kind === 'owner_change')).toHaveLength(1)
    const changeId = 'central-owner_documents-change-legacy-323'
    const detail = buildOwnerCommercialDocumentDetail({
      documents: rows,
      query: parseOwnerCommercialDocumentDetailQuery('owner_change', changeId, { origin: 'real' }),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: commands.sourceVersion(),
      capabilities: session.capabilities,
    })
    expect(detail.document).toMatchObject({
      id: changeId,
      source: { id: changeId, type: 'boq_change_order', locked: true },
      project: { state: 'resolved', id: 'central-projects-project-legacy-323' },
      contract: { state: 'resolved', id: 'central-construction_contracts-contract-legacy-323' },
      amounts: { kind: 'owner_change', boqChange: '760.00', taxInclusive: '520.00', taxExclusive: '480.00', appliedTaxExclusive: '500.00' },
    })
    expect(detail.lines[0]).toMatchObject({
      boqLineId: 'boq-line-legacy-323',
      contractQty: '100',
      contractUnitPrice: '52.00',
    })
    expect(commands.boqLinesFor(
      'central-projects-project-legacy-323',
      'central-construction_contracts-contract-legacy-323',
    )).toContainEqual(expect.objectContaining({
      id: 'boq-line-legacy-323',
      itemName: '桥架安装（现行目录）',
      qty: 130,
      unitPrice: 65,
    }))
    expect(commands.boqLinesFor(
      'central-projects-project-legacy-323',
      'central-construction_contracts-contract-legacy-323',
    )).toContainEqual(expect.objectContaining({
      id: 'boq-line-result-legacy-323',
      itemName: '抗震支架',
      qty: 3,
      unitPrice: 80,
    }))
    expect(commands.boqLinesFor(
      'central-projects-project-legacy-323',
      'central-construction_contracts-contract-legacy-323',
    )).toContainEqual(expect.objectContaining({
      id: 'boq-line-without-history-323',
      itemName: '未发生变更的管线',
      qty: 40,
      unitPrice: 30,
    }))
    expect(commands.boqLinesFor(
      'central-projects-project-legacy-323',
      'central-construction_contracts-contract-legacy-323',
      '2026-09',
    )).toContainEqual(expect.objectContaining({
      id: 'boq-line-without-history-323',
      autoQty: 12,
    }))

    const firstChange = await commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'owner-document:write',
      commandId: 'submit-first-change-after-migration-323',
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: {
        name: '迁移后首张量价变更',
        projectId: 'central-projects-project-legacy-323',
        contractId: 'central-construction_contracts-contract-legacy-323',
        applicationDate: '2026-09-21',
        reason: '未历史变更 BOQ 行增量',
        lines: [{ operation: 'qty', boqLineId: 'boq-line-without-history-323', deltaQty: 2 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_change', firstChange.id, session).draft.lines).toEqual([
      expect.objectContaining({ boqLineId: 'boq-line-without-history-323', contractQty: 40, amount: 60 }),
    ])

    const nextPeriodReport = await commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'owner-document:write',
      commandId: 'submit-next-period-after-migration-323',
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'central-projects-project-legacy-323',
        contractId: 'central-construction_contracts-contract-legacy-323',
        periodNo: '2026-09',
        applicationDate: '2026-09-21',
        operatorName: '迁移经办',
        lines: [{ boqLineId: 'boq-line-without-history-323', reportedQty: 12 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_report', nextPeriodReport.id, session).draft).toMatchObject({
      status: 'reported',
      quantitySourceVersion: 'migration-field-2026-09-v1',
      operatorName: '迁移经办',
      reportedAmount: 360,
    })

    const reportId = 'central-owner_documents-report-legacy-323'
    const reportForm = commands.form('owner_report', reportId, session)
    expect(commands.boqLinesFor(
      'central-projects-project-legacy-323',
      'central-construction_contracts-contract-legacy-323',
      '2026-08',
    )).toMatchObject([{ id: 'boq-line-legacy-323', autoQty: 100 }])
    await expect(commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'owner-document:write',
      commandId: 'save-migrated-report-323',
      action: 'save',
      kind: 'owner_report',
      id: reportId,
      baseVersion: reportForm.version,
      draft: reportForm.draft,
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).resolves.toMatchObject({ id: reportId, version: '2' })

    await core.rollback({ ...envelope('rollback-323'), batchId: dryRun.batchId }, session)
    expect(commands.rows().map(row => row.id)).toEqual(expect.arrayContaining([
      firstChange.id,
      nextPeriodReport.id,
    ]))
    expect(commands.rows().some(row => row.id === changeId || row.id === reportId)).toBe(false)
  })
})
