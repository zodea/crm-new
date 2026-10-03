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
import { createConstructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import {
  createCoreMigrationTestInstance,
  synchronizeCoreMigrationCommandSources,
} from '../../server/utils/core-migration-test-instance'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { createSubcontractContractCommandTestInstance } from '../../server/utils/subcontract-contract-command-test-instance'

const session = {
  workspaceId: 'workspace-migration-323',
  actorId: 'actor-migration-323',
  capabilities: [
    CORE_MIGRATION_CAPABILITY,
    'construction-contract:write',
    'subcontract-contract:write',
    'owner-document:read',
    'owner-document:write',
    'subcontract-document:read',
    'subcontract-document:write',
  ],
}

function source(): CoreMigrationSourceDTO {
  const withoutHash = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: CORE_MIGRATION_SOURCE_VERSION,
    entities: {
      customers: [{ legacyId: 'customer-legacy-323', name: '既有甲方', deletedAt: null }],
      suppliers: [{ legacyId: 'supplier-legacy-327', name: '既有劳务分供方', deletedAt: null }],
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
      subcontract_contracts: [{
        legacyId: 'subcontract-legacy-327',
        name: '既有劳务分包合同',
        references: { projectId: 'project-legacy-323', supplierId: 'supplier-legacy-327' },
        amount: '680000.00' as const,
        deletedAt: null,
        attributes: {
          no: 'FB-LEGACY-327',
          status: '履约中',
          subKind: '劳务',
          content: '样板层劳务分包',
          signDate: '2026-08-01',
        },
      }],
      contract_supplements: [{
        legacyId: 'supplement-legacy-325',
        name: '既有正式补充协议',
        references: { contractId: 'contract-legacy-323' },
        amount: '80000.00' as const,
        deletedAt: null,
        attributes: {
          no: 'BC-LEGACY-325',
          signDate: '2026-08-12',
          status: 'approved',
        },
      }],
      receipt_registrations: [{
        legacyId: 'receipt-legacy-325',
        name: 'SK-LEGACY-325',
        references: {
          projectId: 'project-legacy-323',
          contractId: 'contract-legacy-323',
          customerId: 'customer-legacy-323',
        },
        amount: '900000.00' as const,
        deletedAt: null,
        attributes: {
          no: 'SK-LEGACY-325',
          receiptDate: '2026-08-15',
          status: 'submitted',
        },
      }],
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
        {
          legacyId: 'acceptance-legacy-324',
          name: '既有竣工验收记录',
          references: { projectId: 'project-legacy-323', contractId: 'contract-legacy-323' },
          amount: '960000.00' as const,
          deletedAt: null,
          attributes: {
            kind: 'acceptance',
            no: 'YS-LEGACY-324',
            documentType: 'acceptance_lifecycle',
            sourceType: 'manual',
            sourceLocked: 1,
            periodNo: '',
            applicationDate: '2026-07-18',
            status: 'warranty',
            statusNote: '保修中',
            note: '同一验收记录进入保修',
            acceptanceLifecycleJson: JSON.stringify({
              acceptanceOrganization: '建设、监理、施工联合验收组',
              acceptancePerson: '周验收',
              acceptanceDate: '2026-07-18',
              acceptanceConclusion: '验收合格',
              warrantyOwner: '瑞航建设工程有限公司',
              warrantyStartDate: '2026-07-19',
              warrantyEndDate: '2028-07-18',
              warrantyConfirmationOrganization: null,
              warrantyConfirmationDate: null,
              warrantyConfirmationNote: '',
            }),
            lifecycleEventsJson: JSON.stringify([{
              id: 'event-warranty-legacy-324',
              action: 'start-warranty',
              fromStatus: 'accepted',
              toStatus: 'warranty',
              actorId: 'actor-legacy-324',
              actorName: '周经办',
              occurredAt: '2026-07-19T09:00:00.000Z',
              note: '',
            }]),
            linesJson: '[]',
            filesJson: JSON.stringify([{
              id: 'file-acceptance-legacy-324',
              fileName: '验收报告.pdf',
              fileSize: 324,
              mimeType: 'application/pdf',
              category: 'warranty-confirmation',
              uploader: '周经办',
              uploadedAt: '2026-07-18T10:00:00.000Z',
              deletedAt: null,
            }]),
            createdAt: '2026-07-17T00:00:00.000Z',
            updatedAt: '2026-07-19T09:00:00.000Z',
          },
        },
        {
          legacyId: 'final-settlement-legacy-325',
          name: '既有甲方最终结算',
          references: { projectId: 'project-legacy-323', contractId: 'contract-legacy-323' },
          amount: '1020000.00' as const,
          deletedAt: null,
          attributes: {
            kind: 'final_settlement',
            no: 'JS-LEGACY-325',
            documentType: 'final_settlement',
            sourceType: 'owner_final_settlement',
            sourceLocked: 1,
            periodNo: '',
            applicationDate: '2026-08-23',
            auditedAmount: null,
            status: 'submitted',
            statusNote: '已提交甲方结算资料',
            settlementBasis: '施工合同、补充协议与最终结算书',
            settlementDifferenceNote: '审定金额尚未回传',
            note: '等待甲方审定',
            linesJson: '[]',
            filesJson: '[]',
            createdAt: '2026-08-23T00:00:00.000Z',
            updatedAt: '2026-08-23T00:00:00.000Z',
          },
        },
        {
          legacyId: 'owner-penalty-legacy-326',
          name: '施工进度延误',
          references: { projectId: 'project-legacy-323', contractId: 'contract-legacy-323' },
          amount: '36000.00' as const,
          deletedAt: null,
          attributes: {
            kind: 'owner_penalty',
            no: 'FK-LEGACY-326',
            documentType: 'owner_penalty',
            sourceType: 'owner_penalty',
            sourceLocked: 1,
            periodNo: '',
            applicationDate: '2026-08-24',
            status: 'submitted',
            statusNote: '已提交甲方罚扣事实',
            noticeNo: 'LX-LEGACY-326',
            penaltyReason: '施工进度延误',
            appealNote: '已提交工期顺延说明',
            note: '项目部已核对',
            linesJson: '[]',
            filesJson: JSON.stringify([{
              id: 'file-owner-penalty-legacy-326',
              fileName: '甲方联系单.pdf',
              fileSize: 326,
              mimeType: 'application/pdf',
              category: 'contact-letter',
              uploader: '周经办',
              uploadedAt: '2026-08-24T10:00:00.000Z',
              deletedAt: null,
            }]),
            createdAt: '2026-08-24T00:00:00.000Z',
            updatedAt: '2026-08-24T10:00:00.000Z',
          },
        },
        {
          legacyId: 'sub-change-legacy-327',
          name: '样板层劳务范围调整',
          references: {
            projectId: 'project-legacy-323',
            supplierId: 'supplier-legacy-327',
            contractId: 'subcontract-legacy-327',
          },
          amount: '38000.00' as const,
          deletedAt: null,
          attributes: {
            kind: 'sub_change',
            no: 'FB-BG-LEGACY-327',
            documentType: '增项',
            sourceType: 'subcontract_change_order',
            sourceLocked: 1,
            periodNo: '',
            applicationDate: '2026-08-27',
            status: 'submitted',
            statusNote: '已提交分包变洽签',
            changedArea: 120,
            actualApprovedPrice: 36000,
            note: '按现场确认范围执行',
            linesJson: '[]',
            filesJson: '[]',
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T10:00:00.000Z',
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
  it('aX03 迁移罚扣、班组及独立抵扣事实并映射真实结算身份', async () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-09-05T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const migrationSource = source()
    const template = migrationSource.entities.owner_documents.find(row => row.attributes?.kind === 'sub_change')!
    migrationSource.entities.owner_documents = [{
      ...structuredClone(template),
      legacyId: 'settlement-legacy-328',
      name: '八月劳务结算',
      amount: '28000.00',
      attributes: { ...template.attributes, kind: 'sub_settlement', no: 'FBJS-328', documentType: '过程结算', sourceType: 'expenditure_settlement', status: 'confirmed', settlementDifferenceNote: '按合同扣款', filesJson: JSON.stringify([{ id: 'file-328', fileName: '结算单.pdf', fileSize: 328, mimeType: 'application/pdf', category: '结算单', uploader: '经办', uploadedAt: null, deletedAt: null }]) },
    }]
    migrationSource.entities.crews = [{ legacyId: 'crew329', name: '责任班组', deletedAt: null }]
    migrationSource.entities.owner_documents.push({
      ...structuredClone(template),
      legacyId: 'penalty329',
      name: '历史罚扣',
      amount: '1000.00',
      references: { ...template.references, crewId: 'crew329' },
      attributes: { ...template.attributes, kind: 'project_penalty', sourceType: 'penalty_record', status: 'pending', deadline: '2026-09-10', rectificationNote: '历史整改', filesJson: '[]', penaltyDeductionsJson: JSON.stringify([{ id: 'deduction329', settlementId: 'settlement-legacy-328', amount: 400, actorId: 'legacy-actor', occurredAt: '2026-09-01T00:00:00.000Z', commandId: 'legacy-command', note: '历史抵扣' }]) },
    })
    migrationSource.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(migrationSource)).digest('hex')
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await core.preflight({ ...envelope('preflight-328'), source: migrationSource, backup: null }, session)
    const snapshotSha256 = 'a'.repeat(64)
    const dryRun = await core.dryRun({ ...envelope('dry-328'), source: migrationSource, backup: {
      backupId: `core-migration-${migrationSource.sourceHash}-${snapshotSha256}`,
      sourceHash: migrationSource.sourceHash,
      sourceVersion: migrationSource.sourceVersion,
      snapshotSha256,
      byteLength: 328,
      createdAt: '2026-09-05T00:00:00.000Z',
      immutable: true,
    } }, session)
    await core.importBatch({ ...envelope('import-328'), batchId: dryRun.batchId }, session)
    await core.confirm({ ...envelope('confirm-328'), batchId: dryRun.batchId }, session)
    const form = commands.form('project_penalty', 'central-owner_documents-penalty329', session)
    expect(form.draft).toMatchObject({ amount: 1000, status: 'pending', crewId: 'central-crews-crew329', rectificationNote: '历史整改' })
    const row = commands.rows().find(row => row.id === form.id)!
    expect(row.penaltyDeductions).toEqual([expect.objectContaining({ settlementId: 'central-owner_documents-settlement-legacy-328', amount: 400, actorId: 'legacy-actor' })])
  })
  it('aX02 将统一支出结算按分包合同外键迁入，保留确认、金额和附件身份', async () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-09-05T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const migrationSource = source()
    const template = migrationSource.entities.owner_documents.find(row => row.attributes?.kind === 'sub_change')!
    migrationSource.entities.owner_documents = [{
      ...structuredClone(template),
      legacyId: 'settlement-legacy-328',
      name: '八月劳务结算',
      amount: '28000.00',
      attributes: { ...template.attributes, kind: 'sub_settlement', no: 'FBJS-328', documentType: '过程结算', sourceType: 'expenditure_settlement', status: 'confirmed', settlementDifferenceNote: '按合同扣款', filesJson: JSON.stringify([{ id: 'file-328', fileName: '结算单.pdf', fileSize: 328, mimeType: 'application/pdf', category: '结算单', uploader: '经办', uploadedAt: null, deletedAt: null }]) },
    }]
    migrationSource.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(migrationSource)).digest('hex')
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await core.preflight({ ...envelope('preflight-328'), source: migrationSource, backup: null }, session)
    const snapshotSha256 = 'a'.repeat(64)
    const dryRun = await core.dryRun({ ...envelope('dry-328'), source: migrationSource, backup: {
      backupId: `core-migration-${migrationSource.sourceHash}-${snapshotSha256}`,
      sourceHash: migrationSource.sourceHash,
      sourceVersion: migrationSource.sourceVersion,
      snapshotSha256,
      byteLength: 328,
      createdAt: '2026-09-05T00:00:00.000Z',
      immutable: true,
    } }, session)
    await core.importBatch({ ...envelope('import-328'), batchId: dryRun.batchId }, session)
    await core.confirm({ ...envelope('confirm-328'), batchId: dryRun.batchId }, session)
    const form = commands.form('sub_settlement', 'central-owner_documents-settlement-legacy-328', session)
    expect(form.draft).toMatchObject({ totalAmount: 28000, status: 'confirmed', deductionNote: '按合同扣款', contractId: 'central-subcontract_contracts-subcontract-legacy-327', supplierId: 'central-suppliers-supplier-legacy-327' })
    expect(form.attachments[0]).toMatchObject({ ownerType: 'expenditure_settlement', fileName: '结算单.pdf' })
  })
  it.each(Array.from([
    {
      suffix: 'missing-supplier',
      documentLegacyId: 'sub-change-legacy-327',
      field: 'supplierId',
      metricKey: 'orphan',
      mutate: (invalidSource: CoreMigrationSourceDTO) => {
        const document = invalidSource.entities.owner_documents
          .find(row => row.legacyId === 'sub-change-legacy-327')!
        document.references!.supplierId = null
      },
    },
    {
      suffix: 'construction-contract',
      documentLegacyId: 'sub-change-legacy-327',
      field: 'contractId',
      metricKey: 'orphan',
      mutate: (invalidSource: CoreMigrationSourceDTO) => {
        const document = invalidSource.entities.owner_documents
          .find(row => row.legacyId === 'sub-change-legacy-327')!
        document.references!.contractId = 'contract-legacy-323'
      },
    },
    {
      suffix: 'supplier-mismatch',
      documentLegacyId: 'sub-change-legacy-327',
      field: 'contractId',
      metricKey: 'missing-relation',
      mutate: (invalidSource: CoreMigrationSourceDTO) => {
        invalidSource.entities.suppliers.push({
          legacyId: 'supplier-other-327',
          name: '另一劳务分供方',
          deletedAt: null,
        })
        const document = invalidSource.entities.owner_documents
          .find(row => row.legacyId === 'sub-change-legacy-327')!
        document.references!.supplierId = 'supplier-other-327'
      },
    },
    {
      suffix: 'owner-to-subcontract',
      documentLegacyId: 'change-legacy-323',
      field: 'contractId',
      metricKey: 'orphan',
      mutate: (invalidSource: CoreMigrationSourceDTO) => {
        const document = invalidSource.entities.owner_documents
          .find(row => row.legacyId === 'change-legacy-323')!
        document.references!.contractId = 'subcontract-legacy-327'
      },
    },
  ] as const).map(input => ({ input })))('dry-run 阻断甲方与分包商务单据缺失或错配的专属关系：输入案例 %#', async ({ input: scenario }) => {
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-27T10:00:00.000Z',
    })
    const invalidSource = structuredClone(source())
    scenario.mutate(invalidSource)
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
    await core.preflight({
      ...envelope(`preflight-sub-change-${scenario.suffix}-327`),
      source: invalidSource,
      backup: null,
    }, session)
    const snapshotSha256 = createHash('sha256').update(scenario.suffix).digest('hex')
    const dryRun = await core.dryRun({
      ...envelope(`dry-run-sub-change-${scenario.suffix}-327`),
      source: invalidSource,
      backup: {
        backupId: `core-migration-${invalidSource.sourceHash}-${snapshotSha256}`,
        sourceHash: invalidSource.sourceHash,
        sourceVersion: invalidSource.sourceVersion,
        snapshotSha256,
        byteLength: 327,
        createdAt: '2026-08-27T10:00:00.000Z',
        immutable: true,
      },
    }, session)

    expect(dryRun.steps.find(step => step.entityType === 'owner_documents')).toMatchObject({
      sourceCount: invalidSource.entities.owner_documents.length,
      importableCount: invalidSource.entities.owner_documents.length - 1,
      skippedCount: 1,
    })
    expect(dryRun.mappings).not.toContainEqual(expect.objectContaining({
      entityType: 'owner_documents',
      legacyId: scenario.documentLegacyId,
    }))
    expect(dryRun.issues).toContainEqual(expect.objectContaining({
      entityType: 'owner_documents',
      legacyId: scenario.documentLegacyId,
      field: scenario.field,
      metricKey: scenario.metricKey,
      attribution: 'missing-source',
    }))
    await expect(core.importBatch({
      ...envelope(`import-sub-change-${scenario.suffix}-327`),
      batchId: dryRun.batchId,
    }, session)).rejects.toThrow('dry-run 存在阻断问题')
  })

  it.each([
    [0, 'approvalSequenceAt', 'invalid-time', '签证执行时间无效'],
    [0, 'applicationDate', '2026-02-30', '申报日期无效'],
    [0, 'approvalDate', '2026-02-30', '签证日期无效'],
    [1, 'quantitySourceUpdatedAt', 'invalid-time', '报量来源更新时间无效'],
    [1, 'submittedAt', 'invalid-time', '报量提交时间无效'],
    [0, 'filesJson', JSON.stringify([{ id: 'file-invalid-uploaded', uploadedAt: 'invalid-time' }]), '附件上传时间无效'],
    [0, 'filesJson', JSON.stringify([{ id: 'file-invalid-deleted', deletedAt: 'invalid-time' }]), '附件删除时间无效'],
    [2, 'status', 'anything', '验收状态无效'],
    [2, 'lifecycleEventsJson', JSON.stringify([{
      id: 'event-invalid-transition-324',
      action: 'submit',
      fromStatus: 'warranty',
      toStatus: 'expired',
      actorId: 'actor-invalid-324',
      actorName: '伪造经办',
      occurredAt: '2026-07-19T09:00:00.000Z',
      note: '',
    }]), '验收生命周期审计转换无效'],
    [2, 'lifecycleEventsJson', JSON.stringify([{
      id: 'event-submit-first-324',
      action: 'submit',
      fromStatus: 'draft',
      toStatus: 'submitted',
      actorId: 'actor-324',
      actorName: '经办人',
      occurredAt: '2026-07-18T09:00:00.000Z',
      note: '',
    }, {
      id: 'event-submit-second-324',
      action: 'submit',
      fromStatus: 'draft',
      toStatus: 'submitted',
      actorId: 'actor-324',
      actorName: '经办人',
      occurredAt: '2026-07-18T09:01:00.000Z',
      note: '',
    }]), '验收生命周期审计重复'],
    [4, 'amount', '0.00', '罚扣金额必须大于 0'],
    [4, 'applicationDate', '', '迁移甲方罚扣日期必填'],
    [4, 'penaltyReason', '', '迁移甲方罚扣事由必填'],
    [4, 'sourceType', 'manual', '迁移甲方罚扣来源类型无效'],
  ] as const)('拒绝非法的迁移审计字段 #%s.%s', async (documentIndex, field, invalidValue, expectedMessage) => {
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-25T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const invalidSource = structuredClone(source())
    const invalidDocument = invalidSource.entities.owner_documents[documentIndex]!
    if (field === 'amount')
      invalidDocument.amount = invalidValue
    else
      invalidDocument.attributes![field] = invalidValue
    if (field === 'penaltyReason')
      invalidDocument.name = ''
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

  it('拒绝将合同收款关联到另一客户', async () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-25T00:00:00.000Z',
      afterConfirm: snapshot => commands.synchronizeMigrationSnapshot(snapshot),
    })
    const invalidSource = structuredClone(source())
    invalidSource.entities.customers.push({
      legacyId: 'customer-other-325',
      name: '另一甲方',
      deletedAt: null,
    })
    invalidSource.entities.receipt_registrations[0]!.references.customerId = 'customer-other-325'
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
    await core.preflight({ ...envelope('preflight-receipt-mismatch-325'), source: invalidSource, backup: null }, session)
    const snapshotSha256 = 'e'.repeat(64)
    const dryRun = await core.dryRun({
      ...envelope('dry-run-receipt-mismatch-325'),
      source: invalidSource,
      backup: {
        backupId: `core-migration-${invalidSource.sourceHash}-${snapshotSha256}`,
        sourceHash: invalidSource.sourceHash,
        sourceVersion: invalidSource.sourceVersion,
        snapshotSha256,
        byteLength: 325,
        createdAt: '2026-08-25T00:00:00.000Z',
        immutable: true,
      },
    }, session)
    await core.importBatch({ ...envelope('import-receipt-mismatch-325'), batchId: dryRun.batchId }, session)

    await expect(core.confirm({
      ...envelope('confirm-receipt-mismatch-325'),
      batchId: dryRun.batchId,
    }, session)).rejects.toThrow('迁移收款登记的项目、施工合同与客户关系无效')
  })

  it.each([
    ['contract_supplements', '迁移补充协议金额缺失'],
    ['receipt_registrations', '迁移收款登记金额缺失'],
  ] as const)('拒绝缺少金额的最终结算来源事实：输入案例 %#', async (entityType, expectedMessage) => {
    const constructionCommands = createConstructionContractCommandTestInstance()
    const subcontractCommands = createSubcontractContractCommandTestInstance()
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-25T00:00:00.000Z',
      afterConfirm: snapshot => synchronizeCoreMigrationCommandSources(snapshot, [
        constructionCommands,
        subcontractCommands,
        commands,
      ]),
    })
    const invalidSource = structuredClone(source())
    Object.assign(invalidSource.entities.construction_contracts[0]!.attributes!, {
      content: '既有施工合同内容',
      signDate: '2026-01-01',
    })
    invalidSource.entities[entityType][0]!.amount = null
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
    await core.preflight({ ...envelope(`preflight-null-${entityType}-325`), source: invalidSource, backup: null }, session)
    const snapshotSha256 = entityType === 'contract_supplements' ? 'f'.repeat(64) : 'a'.repeat(64)
    const dryRun = await core.dryRun({
      ...envelope(`dry-run-null-${entityType}-325`),
      source: invalidSource,
      backup: {
        backupId: `core-migration-${invalidSource.sourceHash}-${snapshotSha256}`,
        sourceHash: invalidSource.sourceHash,
        sourceVersion: invalidSource.sourceVersion,
        snapshotSha256,
        byteLength: 325,
        createdAt: '2026-08-25T00:00:00.000Z',
        immutable: true,
      },
    }, session)
    await core.importBatch({ ...envelope(`import-null-${entityType}-325`), batchId: dryRun.batchId }, session)
    const beforeFailure = {
      core: core.snapshot(session),
      construction: {
        rows: constructionCommands.rows(),
        facts: constructionCommands.facts(),
        sourceVersion: constructionCommands.sourceVersion(),
      },
      subcontract: {
        rows: subcontractCommands.rows(),
        context: subcontractCommands.context(session),
        facts: subcontractCommands.facts(),
        sourceVersion: subcontractCommands.sourceVersion(),
      },
      owner: {
        rows: commands.rows(),
        context: commands.context(session),
        sourceVersion: commands.sourceVersion(),
      },
    }

    await expect(core.confirm({
      ...envelope(`confirm-null-${entityType}-325`),
      batchId: dryRun.batchId,
    }, session)).rejects.toThrow(expectedMessage)
    expect({
      core: core.snapshot(session),
      construction: {
        rows: constructionCommands.rows(),
        facts: constructionCommands.facts(),
        sourceVersion: constructionCommands.sourceVersion(),
      },
      subcontract: {
        rows: subcontractCommands.rows(),
        context: subcontractCommands.context(session),
        facts: subcontractCommands.facts(),
        sourceVersion: subcontractCommands.sourceVersion(),
      },
      owner: {
        rows: commands.rows(),
        context: commands.context(session),
        sourceVersion: commands.sourceVersion(),
      },
    }).toEqual(beforeFailure)
  })

  it('按父合同类型分流施工与分包补充协议后原子确认', async () => {
    const constructionCommands = createConstructionContractCommandTestInstance()
    const subcontractCommands = createSubcontractContractCommandTestInstance()
    const commands = createOwnerCommercialDocumentCommandTestInstance()
    const core = createCoreMigrationTestInstance({
      createServerId: input => `central-${input.entityType}-${input.legacyId}`,
      now: () => '2026-08-25T00:00:00.000Z',
      afterConfirm: snapshot => synchronizeCoreMigrationCommandSources(snapshot, [
        constructionCommands,
        subcontractCommands,
        commands,
      ]),
    })
    const migrationSource = structuredClone(source())
    Object.assign(migrationSource.entities.construction_contracts[0]!.attributes!, {
      content: '既有施工合同内容',
      signDate: '2026-01-01',
    })
    migrationSource.entities.suppliers.push({
      legacyId: 'supplier-legacy-325',
      name: '既有分供方',
      deletedAt: null,
    })
    migrationSource.entities.subcontract_contracts.push({
      legacyId: 'subcontract-legacy-325',
      name: '既有劳务分包合同',
      references: {
        projectId: 'project-legacy-323',
        supplierId: 'supplier-legacy-325',
      },
      amount: '120000.00',
      deletedAt: null,
      attributes: {
        no: 'FB-LEGACY-325',
        subKind: '劳务',
        content: '既有劳务分包内容',
        signDate: '2026-01-02',
        status: '履约中',
      },
    })
    migrationSource.entities.contract_supplements.push({
      legacyId: 'subcontract-supplement-legacy-325',
      name: '既有分包补充协议',
      references: { contractId: 'subcontract-legacy-325' },
      amount: '10000.00',
      deletedAt: null,
      attributes: {
        no: 'FB-BC-LEGACY-325',
        signDate: '2026-08-13',
        status: 'approved',
      },
    })
    const { sourceHash: _sourceHash, ...withoutHash } = migrationSource
    migrationSource.sourceHash = createHash('sha256')
      .update(coreMigrationSourceHashInput(withoutHash as CoreMigrationSourceDTO))
      .digest('hex')
    const envelope = (commandId: string) => ({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CORE_MIGRATION_CAPABILITY,
      commandId,
    })
    await core.preflight({ ...envelope('preflight-contract-supplements-325'), source: migrationSource, backup: null }, session)
    const snapshotSha256 = 'f'.repeat(64)
    const dryRun = await core.dryRun({
      ...envelope('dry-run-contract-supplements-325'),
      source: migrationSource,
      backup: {
        backupId: `core-migration-${migrationSource.sourceHash}-${snapshotSha256}`,
        sourceHash: migrationSource.sourceHash,
        sourceVersion: migrationSource.sourceVersion,
        snapshotSha256,
        byteLength: 325,
        createdAt: '2026-08-25T00:00:00.000Z',
        immutable: true,
      },
    }, session)
    await core.importBatch({ ...envelope('import-contract-supplements-325'), batchId: dryRun.batchId }, session)
    await core.confirm({ ...envelope('confirm-contract-supplements-325'), batchId: dryRun.batchId }, session)

    expect(constructionCommands.facts().supplements.map(row => row.id)).toEqual([
      'central-contract_supplements-supplement-legacy-325',
    ])
    expect(subcontractCommands.facts().supplements.map(row => row.id)).toEqual([
      'central-contract_supplements-subcontract-supplement-legacy-325',
    ])
    const migratedSettlement = commands.rows().find(row => row.kind === 'final_settlement')
    expect(migratedSettlement?.finalSettlementEvidence?.supplements?.map(row => row.id))
      .toEqual(['central-contract_supplements-supplement-legacy-325'])
  })

  it('确认后将既有甲方单据同步到同一正式命令源，回滚后撤销切换', async () => {
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
      sourceCount: 6,
      importableCount: 6,
      skippedCount: 0,
    })
    await core.importBatch({ ...envelope('import-323'), batchId: dryRun.batchId }, session)
    await core.confirm({ ...envelope('confirm-323'), batchId: dryRun.batchId }, session)

    const rows = commands.rows()
    expect(rows.map(row => row.kind)).toEqual([
      'owner_change',
      'owner_report',
      'acceptance',
      'final_settlement',
      'owner_penalty',
      'sub_change',
    ])
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
    const acceptanceId = 'central-owner_documents-acceptance-legacy-324'
    const acceptanceDetail = buildOwnerCommercialDocumentDetail({
      documents: rows,
      query: parseOwnerCommercialDocumentDetailQuery('acceptance', acceptanceId, {
        origin: 'real',
        variant: 'warranty',
      }),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: commands.sourceVersion(),
      capabilities: session.capabilities,
    })
    expect(acceptanceDetail).toMatchObject({
      document: { id: acceptanceId, kind: 'acceptance', status: 'warranty' },
      acceptanceView: {
        variant: 'warranty',
        owner: '瑞航建设工程有限公司',
        startDate: '2026-07-19',
        endDate: '2028-07-18',
      },
      lifecycleEvents: [{ action: 'start-warranty', toStatus: 'warranty' }],
      files: [{ id: 'file-acceptance-legacy-324', category: 'warranty-confirmation' }],
    })
    const finalSettlementId = 'central-owner_documents-final-settlement-legacy-325'
    const finalSettlementDetail = buildOwnerCommercialDocumentDetail({
      documents: rows,
      query: parseOwnerCommercialDocumentDetailQuery('final_settlement', finalSettlementId, { origin: 'real' }),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: commands.sourceVersion(),
      capabilities: session.capabilities,
    })
    expect(finalSettlementDetail).toMatchObject({
      document: {
        id: finalSettlementId,
        kind: 'final_settlement',
        amounts: {
          declared: '1020000.00',
          audited: null,
          changedContract: '1040000.00',
          cumulativeReceipts: '900000.00',
          receiptDifference: '120000.00',
        },
      },
      finalSettlementEvidence: {
        basis: '施工合同、补充协议与最终结算书',
        differenceNote: '审定金额尚未回传',
        sources: [
          { kind: 'contract-supplement', id: 'central-contract_supplements-supplement-legacy-325' },
          { kind: 'receipt', id: 'central-receipt_registrations-receipt-legacy-325' },
        ],
      },
    })
    const ownerPenaltyId = 'central-owner_documents-owner-penalty-legacy-326'
    const ownerPenaltyDetail = buildOwnerCommercialDocumentDetail({
      documents: rows,
      query: parseOwnerCommercialDocumentDetailQuery('owner_penalty', ownerPenaltyId, { origin: 'real' }),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: commands.sourceVersion(),
      capabilities: session.capabilities,
    })
    expect(ownerPenaltyDetail).toMatchObject({
      document: {
        id: ownerPenaltyId,
        kind: 'owner_penalty',
        amounts: { kind: 'owner_penalty', amount: '36000.00' },
      },
      ownerPenaltyFacts: {
        noticeNo: 'LX-LEGACY-326',
        penaltyDate: '2026-08-24',
        reason: '施工进度延误',
        appealNote: '已提交工期顺延说明',
      },
      files: [{ id: 'file-owner-penalty-legacy-326', category: 'contact-letter' }],
    })
    const subcontractChangeId = 'central-owner_documents-sub-change-legacy-327'
    const subcontractChangeDetail = buildOwnerCommercialDocumentDetail({
      documents: rows,
      query: parseOwnerCommercialDocumentDetailQuery('sub_change', subcontractChangeId, { origin: 'real' }),
      asOf: '2026-08-27T10:00:00.000Z',
      sourceVersion: commands.sourceVersion(),
      capabilities: session.capabilities,
    })
    expect(subcontractChangeDetail).toMatchObject({
      document: {
        id: subcontractChangeId,
        kind: 'sub_change',
        project: { state: 'resolved', id: 'central-projects-project-legacy-323' },
        supplier: { state: 'resolved', id: 'central-suppliers-supplier-legacy-327' },
        contract: { state: 'resolved', id: 'central-subcontract_contracts-subcontract-legacy-327' },
        amounts: { kind: 'sub_change', approved: '38000.00', changedArea: '120', actualApproved: '36000.00' },
      },
    })
    expect(rows.find(row => row.id === subcontractChangeId)?.auditedAmount).toBeNull()
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
    expect(commands.rows().some(row => [changeId, reportId, acceptanceId, ownerPenaltyId].includes(row.id))).toBe(false)
  })
})
