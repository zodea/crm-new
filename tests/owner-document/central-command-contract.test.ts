import type { CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import type { OwnerCommercialDocumentSource } from '~/lib/owner-document/central-repository'
import { describe, expect, it } from 'vitest'
import {
  OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY,
} from '~/lib/owner-document/central-command-contract'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'

const session = {
  workspaceId: 'workspace-owner-document-323',
  actorId: 'actor-owner-document-323',
  capabilities: ['owner-document:read', OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY],
}

const subcontractSession = {
  workspaceId: 'workspace-subcontract-change-327',
  actorId: 'actor-subcontract-change-327',
  capabilities: ['subcontract-document:read', 'subcontract-document:write'],
}

const change: OwnerCommercialDocumentSource = {
  dataOrigin: 'real',
  kind: 'owner_change',
  id: 'change-command-323',
  no: 'BG-2026-323',
  name: '首层机电管线变更',
  documentType: 'change_negotiation',
  projectId: 'project-command-323',
  projectName: '中央施工项目',
  projectPermission: 'allowed',
  customerId: 'customer-command-323',
  customerName: '中央甲方客户',
  customerPermission: 'allowed',
  contractId: 'contract-command-323',
  contractNo: 'SG-2026-323',
  contractName: '中央施工合同',
  contractPermission: 'allowed',
  sourceType: 'boq_change_order',
  sourceId: 'change-command-323',
  sourceLocked: false,
  periodNo: '',
  applicationDate: '2026-08-08',
  status: 'draft',
  statusNote: '',
  amount: 520,
  auditedAmount: null,
  note: '',
  version: 1,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
  lines: [{
    id: 'change-line-command-323',
    boqLineId: 'boq-line-command-323',
    operation: 'qty',
    itemName: '桥架安装',
    unit: 'm',
    contractQty: 100,
    contractUnitPrice: 52,
    autoQty: null,
    reportedQty: null,
    auditedQty: null,
    deltaQty: 10,
    newUnitPrice: null,
    amount: 520,
    auditedAmount: null,
    note: '',
  }],
  files: [],
}

const acceptance: OwnerCommercialDocumentSource = {
  ...change,
  kind: 'acceptance',
  id: 'acceptance-command-324',
  no: 'YS-2026-324',
  name: '中央施工项目竣工验收',
  documentType: 'acceptance_lifecycle',
  sourceType: 'manual',
  sourceId: 'acceptance-command-324',
  applicationDate: '2026-07-18',
  status: 'submitted',
  statusNote: '验收中',
  amount: 1200000,
  auditedAmount: null,
  acceptanceLifecycle: {
    acceptanceOrganization: '',
    acceptancePerson: '',
    acceptanceDate: null,
    acceptanceConclusion: '',
    warrantyOwner: '',
    warrantyStartDate: null,
    warrantyEndDate: null,
    warrantyConfirmationOrganization: null,
    warrantyConfirmationDate: null,
    warrantyConfirmationNote: '',
    events: [{
      id: 'acceptance-submit-event-324',
      action: 'submit',
      fromStatus: 'draft',
      toStatus: 'submitted',
      actorId: session.actorId,
      actorName: '周经办',
      occurredAt: '2026-07-18T02:00:00.000Z',
      note: '',
    }],
  },
  files: [],
}

function commandEnvelope(commandId: string) {
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    requiredCapability: OWNER_COMMERCIAL_DOCUMENT_WRITE_CAPABILITY,
    commandId,
  } as const
}

function instance(
  createId: (kind: OwnerCommercialDocumentSource['kind']) => string = kind => `${kind}-created-323`,
  now: () => string = () => '2026-08-25T02:00:00.000Z',
  documents: readonly OwnerCommercialDocumentSource[] = [change],
) {
  return createOwnerCommercialDocumentCommandTestInstance({
    now,
    createId,
    createBoqLineId: () => 'boq-line-added-323',
    createAttachmentId: () => 'file-created-323',
    projects: [{ id: 'project-command-323', name: '中央施工项目', customerId: 'customer-command-323' }],
    customers: [{ id: 'customer-command-323', name: '中央甲方客户' }],
    contracts: [{
      id: 'contract-command-323',
      no: 'SG-2026-323',
      name: '中央施工合同',
      projectId: 'project-command-323',
      customerId: 'customer-command-323',
    }],
    boqLines: [{
      id: 'boq-line-command-323',
      projectId: 'project-command-323',
      contractId: 'contract-command-323',
      itemName: '桥架安装',
      unit: 'm',
      qty: 100,
      unitPrice: 52,
      autoQty: 90,
      missingQtyCount: 0,
    }],
    monthlyQuantityFacts: [{
      projectId: 'project-command-323',
      contractId: 'contract-command-323',
      periodNo: '2026-08',
      boqLineId: 'boq-line-command-323',
      autoQty: 90,
      missingQtyCount: 0,
      quantityBasis: 'field',
      sourceVersion: 'monthly-quantity-2026-08-v1',
      sourceUpdatedAt: '2026-08-24T10:00:00.000Z',
    }, {
      projectId: 'project-command-323',
      contractId: 'contract-command-323',
      periodNo: '2026-09',
      boqLineId: 'boq-line-command-323',
      autoQty: 95,
      missingQtyCount: 0,
      quantityBasis: 'field',
      sourceVersion: 'monthly-quantity-2026-09-v1',
      sourceUpdatedAt: '2026-09-24T10:00:00.000Z',
    }],
    documents,
  })
}

describe('甲方商务单据中央命令契约', () => {
  it('分包变洽签经中央命令按稳定分供方合同提交，并保持 commandId 幂等', async () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      now: () => '2026-08-27T02:00:00.000Z',
      createId: () => 'sub-change-created-327',
      createAttachmentId: () => 'sub-change-file-created-327',
      projects: [{ id: 'project-sub-change-327', name: '中央分包项目', customerId: null }],
      suppliers: [
        { id: 'supplier-sub-change-327', name: '中央劳务分供方' },
        { id: 'supplier-other-327', name: '其他分供方' },
      ],
      subcontractContracts: [{
        id: 'subcontract-sub-change-327',
        no: 'FB-CENTRAL-327',
        name: '中央劳务分包合同',
        projectId: 'project-sub-change-327',
        supplierId: 'supplier-sub-change-327',
      }],
      documents: [],
    })
    const request = {
      workspaceId: subcontractSession.workspaceId,
      actorId: subcontractSession.actorId,
      requiredCapability: 'subcontract-document:write' as const,
      commandId: 'submit-sub-change-327',
      action: 'submit' as const,
      kind: 'sub_change' as const,
      id: null,
      baseVersion: null,
      draft: {
        no: 'FB-BG-2026-327',
        projectId: 'project-sub-change-327',
        supplierId: 'supplier-sub-change-327',
        contractId: 'subcontract-sub-change-327',
        changeType: '增项',
        changeDate: '2026-08-27',
        approvedAmount: 38000,
        changedArea: 120,
        actualApprovedPrice: 36000,
        reason: '样板层劳务范围调整',
        note: '按现场确认范围执行',
      },
      attachments: {
        add: [{ fileName: '分包变洽签确认单.pdf', category: '业务附件' }],
        removeIds: [],
        restoreIds: [],
      },
    }

    const saved = await commands.execute(request, subcontractSession)
    await expect(commands.execute(request, subcontractSession)).resolves.toEqual(saved)
    expect(commands.rows().filter(row => row.kind === 'sub_change')).toHaveLength(1)
    expect(commands.form('sub_change', saved.id, subcontractSession)).toMatchObject({
      kind: 'sub_change',
      draft: {
        id: 'sub-change-created-327',
        no: 'FB-BG-2026-327',
        projectId: 'project-sub-change-327',
        supplierId: 'supplier-sub-change-327',
        contractId: 'subcontract-sub-change-327',
        changeType: '增项',
        changeDate: '2026-08-27',
        approvedAmount: 38000,
        changedArea: 120,
        actualApprovedPrice: 36000,
        reason: '样板层劳务范围调整',
        status: 'submitted',
      },
      attachments: [{ ownerType: 'subcontract_change_order', id: 'sub-change-file-created-327' }],
    })

    await expect(commands.execute({
      ...request,
      commandId: 'submit-sub-change-mismatched-supplier-327',
      id: null,
      draft: { ...request.draft, supplierId: 'supplier-other-327' },
    }, subcontractSession)).rejects.toThrow(/分供方|不属于/)
  })

  it('甲方罚扣只经中央命令提交，幂等保存专属事实和联系单附件', async () => {
    const commands = instance(kind => `${kind}-created-326`, () => '2026-08-26T02:00:00.000Z', [])
    const request = {
      ...commandEnvelope('submit-owner-penalty-326'),
      action: 'submit' as const,
      kind: 'owner_penalty' as const,
      id: null,
      baseVersion: null,
      draft: {
        no: 'FK-2026-326',
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        noticeNo: 'LX-2026-326',
        amount: 36000,
        penaltyDate: '2026-08-26',
        reason: '施工进度延误',
        appealNote: '已提交工期顺延说明',
        note: '项目部已核对',
      },
      attachments: {
        add: [{ fileName: '甲方罚扣联系单.pdf', category: 'contact-letter' }],
        removeIds: [],
        restoreIds: [],
      },
    }

    const saved = await commands.execute(request, session)
    await expect(commands.execute(request, session)).resolves.toEqual(saved)
    expect(commands.rows().filter(row => row.kind === 'owner_penalty')).toHaveLength(1)
    expect(commands.form('owner_penalty', saved.id, session)).toMatchObject({
      kind: 'owner_penalty',
      draft: {
        id: 'owner_penalty-created-326',
        no: 'FK-2026-326',
        name: '施工进度延误',
        noticeNo: 'LX-2026-326',
        amount: 36000,
        penaltyDate: '2026-08-26',
        reason: '施工进度延误',
        appealNote: '已提交工期顺延说明',
        status: 'submitted',
      },
      attachments: [{ ownerType: 'owner_penalty', category: 'contact-letter' }],
    })
    await expect(commands.execute({
      ...request,
      commandId: 'overwrite-owner-penalty-326',
      id: saved.id,
      baseVersion: '1',
    }, session)).rejects.toThrow('只有草稿或已退回')
  })

  it('最终结算通过中央命令保存并在提交后锁定正文编辑', async () => {
    const commands = instance(kind => `${kind}-created-325`, () => '2026-08-25T02:00:00.000Z', [])
    const saved = await commands.execute({
      ...commandEnvelope('submit-final-settlement-325'),
      action: 'submit',
      kind: 'final_settlement',
      id: null,
      baseVersion: null,
      draft: {
        name: '中央施工项目甲方最终结算',
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        settlementAmount: 1280000,
        submissionDate: '2026-08-25',
        basis: '施工合同与最终结算书',
        differenceNote: '审定金额尚未回传',
        note: '等待甲方审定',
      },
      attachments: {
        add: [{ fileName: '最终结算书.pdf', category: 'settlement-book' }],
        removeIds: [],
        restoreIds: [],
      },
    }, session)

    expect(saved).toMatchObject({ id: 'final_settlement-created-325', version: '1' })
    expect(commands.form('final_settlement', saved.id, session)).toMatchObject({
      kind: 'final_settlement',
      draft: {
        id: saved.id,
        name: '中央施工项目甲方最终结算',
        settlementAmount: 1280000,
        submissionDate: '2026-08-25',
        basis: '施工合同与最终结算书',
        differenceNote: '审定金额尚未回传',
        status: 'submitted',
      },
      attachments: [{ ownerType: 'owner_final_settlement', category: 'settlement-book' }],
    })
    await expect(commands.execute({
      ...commandEnvelope('overwrite-final-settlement-325'),
      action: 'save',
      kind: 'final_settlement',
      id: saved.id,
      baseVersion: '1',
      draft: {
        ...commands.form('final_settlement', saved.id, session).draft,
        settlementAmount: 1300000,
      },
      attachments: {},
    }, session)).rejects.toThrow('只有草稿或已退回')
  })

  it('最终结算草稿切换合同时实时重算来源，并排除中英文草稿补充协议', async () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      now: () => '2026-08-25T02:00:00.000Z',
      createId: () => 'final-settlement-switch-contract-325',
      projects: [{ id: 'project-switch-325', name: '切换合同项目', customerId: 'customer-switch-325' }],
      customers: [{ id: 'customer-switch-325', name: '切换合同甲方' }],
      contracts: [{
        id: 'contract-switch-a-325',
        no: 'SG-A-325',
        name: '施工合同 A',
        projectId: 'project-switch-325',
        customerId: 'customer-switch-325',
        amount: 1000000,
      }, {
        id: 'contract-switch-b-325',
        no: 'SG-B-325',
        name: '施工合同 B',
        projectId: 'project-switch-325',
        customerId: 'customer-switch-325',
        amount: 2000000,
      }],
      finalSettlementSupplements: [{
        contractId: 'contract-switch-a-325',
        id: 'supplement-switch-a-draft-325',
        no: 'BC-A-DRAFT-325',
        name: '施工合同 A 草稿补充协议',
        status: '草稿',
        amount: 500000,
        date: '2026-08-20',
      }, {
        contractId: 'contract-switch-a-325',
        id: 'supplement-switch-a-approved-325',
        no: 'BC-A-325',
        name: '施工合同 A 正式补充协议',
        status: 'approved',
        amount: 100000,
        date: '2026-08-21',
      }, {
        contractId: 'contract-switch-b-325',
        id: 'supplement-switch-b-approved-325',
        no: 'BC-B-325',
        name: '施工合同 B 正式补充协议',
        status: 'approved',
        amount: 200000,
        date: '2026-08-22',
      }],
      finalSettlementReceipts: [{
        contractId: 'contract-switch-a-325',
        projectId: 'project-switch-325',
        customerId: 'customer-switch-325',
        id: 'receipt-switch-a-325',
        no: 'SK-A-325',
        name: '施工合同 A 收款',
        status: 'submitted',
        amount: 300000,
        date: '2026-08-21',
      }, {
        contractId: 'contract-switch-b-325',
        projectId: 'project-switch-325',
        customerId: 'customer-switch-325',
        id: 'receipt-switch-b-325',
        no: 'SK-B-325',
        name: '施工合同 B 收款',
        status: 'submitted',
        amount: 400000,
        date: '2026-08-22',
      }],
    })
    const saved = await commands.execute({
      ...commandEnvelope('save-final-settlement-contract-a-325'),
      action: 'save',
      kind: 'final_settlement',
      id: null,
      baseVersion: null,
      draft: {
        name: '合同切换最终结算',
        projectId: 'project-switch-325',
        contractId: 'contract-switch-a-325',
        settlementAmount: 1200000,
        submissionDate: '2026-08-25',
      },
      attachments: {},
    }, session)
    expect(commands.form('final_settlement', saved.id, session).draft).toMatchObject({
      changedContractAmount: 1100000,
      receivedAmount: 300000,
    })

    const switched = await commands.execute({
      ...commandEnvelope('save-final-settlement-contract-b-325'),
      action: 'save',
      kind: 'final_settlement',
      id: saved.id,
      baseVersion: saved.version,
      draft: {
        ...commands.form('final_settlement', saved.id, session).draft,
        contractId: 'contract-switch-b-325',
      },
      attachments: {},
    }, session)
    expect(commands.form('final_settlement', switched.id, session).draft).toMatchObject({
      contractId: 'contract-switch-b-325',
      changedContractAmount: 2200000,
      receivedAmount: 400000,
    })
  })

  it('按合同保留来源完整性，不因其他合同已知而伪造空集合', () => {
    const known: OwnerCommercialDocumentSource = {
      ...change,
      kind: 'final_settlement',
      id: 'settlement-known-325',
      no: 'JS-KNOWN-325',
      name: '已读取来源的结算',
      documentType: 'final_settlement',
      contractId: 'contract-known-325',
      contractNo: 'SG-KNOWN-325',
      contractName: '已知合同',
      sourceType: 'owner_final_settlement',
      sourceId: 'settlement-known-325',
      finalSettlementEvidence: { originalContractAmount: 100, supplements: [], receipts: [] },
    }
    const unknown: OwnerCommercialDocumentSource = {
      ...known,
      id: 'settlement-unknown-325',
      no: 'JS-UNKNOWN-325',
      name: '未读取来源的结算',
      contractId: 'contract-unknown-325',
      contractNo: 'SG-UNKNOWN-325',
      contractName: '未知合同',
      sourceId: 'settlement-unknown-325',
      finalSettlementEvidence: undefined,
    }
    const commands = createOwnerCommercialDocumentCommandTestInstance({ documents: [known, unknown] })

    expect(commands.rows().find(row => row.id === known.id)?.finalSettlementEvidence).toMatchObject({
      supplements: [],
      receipts: [],
    })
    expect(commands.rows().find(row => row.id === unknown.id)?.finalSettlementEvidence).toMatchObject({
      supplements: null,
      receipts: null,
    })
  })

  it('合同、项目与客户身份按会话隔离', () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      projects: [{ id: 'project-base-325', name: '基础项目', customerId: 'customer-base-325' }],
      customers: [{ id: 'customer-base-325', name: '基础客户' }],
      contracts: [{
        id: 'contract-base-325',
        no: 'SG-BASE-325',
        name: '基础合同',
        projectId: 'project-base-325',
        customerId: 'customer-base-325',
        amount: 100,
      }],
      finalSettlementSupplements: [],
      finalSettlementReceipts: [],
    })
    const entity = (
      entityType: CoreMigrationSnapshotDTO['entities'][number]['entityType'],
      id: string,
      name: string,
      references: CoreMigrationSnapshotDTO['entities'][number]['references'],
    ): CoreMigrationSnapshotDTO['entities'][number] => ({
      entityType,
      id,
      legacyId: id,
      name,
      references,
      quantity: null,
      amount: entityType === 'construction_contracts' ? '200.00' : null,
      attributes: entityType === 'construction_contracts' ? { no: 'SG-A-325' } : {},
      deletedAt: null,
      batchId: 'batch-session-a-325',
    })
    commands.synchronizeMigrationSnapshot({
      authority: 'central',
      activeBatchId: 'batch-session-a-325',
      entities: [
        entity('customers', 'customer-session-a-325', '会话 A 客户', {}),
        entity('projects', 'project-session-a-325', '会话 A 项目', { customerId: 'customer-session-a-325' }),
        entity('construction_contracts', 'contract-session-a-325', '会话 A 合同', {
          projectId: 'project-session-a-325',
          customerId: 'customer-session-a-325',
        }),
      ],
    }, 'session-a-325')

    expect(commands.context(session, 'session-a-325').contracts.map(row => row.id)).toContain('contract-session-a-325')
    expect(commands.context(session, 'session-b-325').contracts.map(row => row.id)).not.toContain('contract-session-a-325')
    expect(commands.context(session, 'session-b-325').contracts.map(row => row.id)).toContain('contract-base-325')
  })

  it('甲方与分包命令上下文按 capability 隔离且分包权限不能读取 BOQ 上下文', () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      projects: [{ id: 'project-auth-327', name: '权限项目', customerId: 'customer-auth-327' }],
      customers: [{ id: 'customer-auth-327', name: '权限客户' }],
      suppliers: [{ id: 'supplier-auth-327', name: '权限分供方' }],
      contracts: [{
        id: 'contract-auth-327',
        no: 'SG-AUTH-327',
        name: '权限施工合同',
        projectId: 'project-auth-327',
        customerId: 'customer-auth-327',
      }],
      subcontractContracts: [{
        id: 'subcontract-auth-327',
        no: 'FB-AUTH-327',
        name: '权限分包合同',
        projectId: 'project-auth-327',
        supplierId: 'supplier-auth-327',
      }],
    })

    const ownerContext = commands.context(session, undefined, 'owner_change')
    expect(ownerContext.customers.map(row => row.id)).toEqual(['customer-auth-327'])
    expect(ownerContext.suppliers).toEqual([])
    expect(ownerContext.contracts.map(row => row.id)).toEqual(['contract-auth-327'])

    const subcontractContext = commands.context(subcontractSession, undefined, 'sub_change')
    expect(subcontractContext.customers).toEqual([])
    expect(subcontractContext.suppliers.map(row => row.id)).toEqual(['supplier-auth-327'])
    expect(subcontractContext.contracts.map(row => row.id)).toEqual(['subcontract-auth-327'])
    expect(() => commands.context(subcontractSession, undefined, 'owner_change'))
      .toThrowError(/无甲方商务单据写入权限/)
  })

  it('验收、进入保修和到期确认按唯一顺序更新同一记录并留下服务端审计', async () => {
    const commands = instance(() => 'acceptance-event-created-324', () => '2026-08-25T02:00:00.000Z', [acceptance])
    const accepted = await commands.execute({
      ...commandEnvelope('accept-324'),
      action: 'transition-acceptance',
      kind: 'acceptance',
      id: acceptance.id,
      baseVersion: '1',
      target: 'accepted',
      facts: {
        acceptanceOrganization: '建设、监理、施工联合验收组',
        acceptancePerson: '周验收',
        acceptanceDate: '2026-07-18',
        acceptanceConclusion: '验收合格',
        note: '联合验收通过',
      },
      attachments: {
        add: [{ fileName: '竣工验收报告.pdf', category: 'acceptance-report' }],
        removeIds: [],
        restoreIds: [],
      },
    }, session)
    const warranty = await commands.execute({
      ...commandEnvelope('start-warranty-324'),
      action: 'transition-acceptance',
      kind: 'acceptance',
      id: acceptance.id,
      baseVersion: accepted.version,
      target: 'warranty',
      facts: {
        warrantyOwner: '瑞航建设工程有限公司',
        warrantyStartDate: '2026-07-19',
        warrantyEndDate: '2028-07-18',
        note: '进入保修跟踪',
      },
      attachments: {
        add: [{ fileName: '保修跟踪清单.pdf', category: 'warranty-confirmation' }],
        removeIds: [],
        restoreIds: [],
      },
    }, session)
    const expired = await commands.execute({
      ...commandEnvelope('confirm-expiry-324'),
      action: 'transition-acceptance',
      kind: 'acceptance',
      id: acceptance.id,
      baseVersion: warranty.version,
      target: 'expired',
      facts: {
        warrantyConfirmationOrganization: '建设单位保修验收组',
        warrantyConfirmationDate: '2028-07-18',
        warrantyConfirmationNote: '保修责任履行完毕',
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)

    expect(expired).toMatchObject({ id: acceptance.id, version: '4' })
    expect(commands.rows().find(row => row.id === acceptance.id)).toMatchObject({
      id: acceptance.id,
      status: 'expired',
      acceptanceLifecycle: {
        acceptanceOrganization: '建设、监理、施工联合验收组',
        acceptanceConclusion: '验收合格',
        warrantyOwner: '瑞航建设工程有限公司',
        warrantyEndDate: '2028-07-18',
        warrantyConfirmationOrganization: '建设单位保修验收组',
        warrantyConfirmationDate: '2028-07-18',
        warrantyConfirmationNote: '保修责任履行完毕',
        events: [
          { action: 'submit', fromStatus: 'draft', toStatus: 'submitted' },
          { action: 'accept', fromStatus: 'submitted', toStatus: 'accepted', actorId: session.actorId },
          { action: 'start-warranty', fromStatus: 'accepted', toStatus: 'warranty', actorId: session.actorId },
          { action: 'confirm-expiry', fromStatus: 'warranty', toStatus: 'expired', actorId: session.actorId },
        ],
      },
      files: [
        { fileName: '竣工验收报告.pdf', category: 'acceptance-report', deletedAt: null },
        { fileName: '保修跟踪清单.pdf', category: 'warranty-confirmation', deletedAt: null },
      ],
    })
  })

  it('拒绝会从双视图消失的验收附件分类', async () => {
    const commands = instance(() => 'acceptance-event-created-324', () => '2026-08-25T02:00:00.000Z', [acceptance])
    await expect(commands.execute({
      ...commandEnvelope('accept-invalid-category-324'),
      action: 'transition-acceptance',
      kind: 'acceptance',
      id: acceptance.id,
      baseVersion: '1',
      target: 'accepted',
      facts: {
        acceptanceOrganization: '联合验收组',
        acceptancePerson: '周验收',
        acceptanceDate: '2026-07-18',
        acceptanceConclusion: '合格',
      },
      attachments: {
        add: [{ fileName: '验收报告.pdf', category: '自定义分类' }],
        removeIds: [],
        restoreIds: [],
      },
    }, session)).rejects.toThrow('附件分类')
  })

  it('拒绝生命周期命令跨视图删除其他阶段附件', async () => {
    const commands = instance(
      () => 'acceptance-event-created-324',
      () => '2026-08-25T02:00:00.000Z',
      [{
        ...acceptance,
        files: [{
          id: 'warranty-file-before-accepted-324',
          fileName: '保修确认单.pdf',
          fileSize: 324,
          mimeType: 'application/pdf',
          category: 'warranty-confirmation',
          uploader: '周经办',
          uploadedAt: '2026-07-18T02:00:00.000Z',
          deletedAt: null,
        }],
      }],
    )
    await expect(commands.execute({
      ...commandEnvelope('accept-cross-view-remove-324'),
      action: 'transition-acceptance',
      kind: 'acceptance',
      id: acceptance.id,
      baseVersion: '1',
      target: 'accepted',
      facts: {
        acceptanceOrganization: '联合验收组',
        acceptancePerson: '周验收',
        acceptanceDate: '2026-07-18',
        acceptanceConclusion: '合格',
      },
      attachments: {
        add: [],
        removeIds: ['warranty-file-before-accepted-324'],
        restoreIds: [],
      },
    }, session)).rejects.toThrow('不属于当前验收视图')
  })

  it('拒绝跳过验收直接进入保修，并禁止终态再次编辑', async () => {
    const commands = instance(() => 'acceptance-event-created-324', () => '2026-08-25T02:00:00.000Z', [acceptance])
    await expect(commands.execute({
      ...commandEnvelope('skip-acceptance-324'),
      action: 'transition-acceptance',
      kind: 'acceptance',
      id: acceptance.id,
      baseVersion: '1',
      target: 'warranty',
      facts: {
        warrantyOwner: '瑞航建设工程有限公司',
        warrantyStartDate: '2026-07-19',
        warrantyEndDate: '2028-07-18',
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('当前状态不能进入保修')
  })

  it('通过显式版本和 commandId 更新草稿，附件与单据在同一结果中返回', async () => {
    const commands = instance()
    const form = commands.form('owner_change', change.id, session)

    expect(form).toMatchObject({
      draft: {
        id: change.id,
        name: change.name,
        status: 'draft',
        lines: [{ qty: 100, unitPrice: 52, amount: 520 }],
      },
      version: '1',
      attachments: [],
    })

    const request = {
      ...commandEnvelope('save-change-323'),
      action: 'save' as const,
      kind: 'owner_change' as const,
      id: change.id,
      baseVersion: form.version,
      draft: { ...form.draft, status: 'draft', name: '首层机电管线变更（修订）' },
      attachments: {
        add: [{ fileName: '修订依据.pdf', fileSize: 1024, mimeType: 'application/pdf', category: '变更依据' }],
        removeIds: [],
        restoreIds: [],
      },
    }
    const first = await commands.execute(request, session)
    const replay = await commands.execute(request, session)

    expect(replay).toEqual(first)
    expect(first).toMatchObject({ id: change.id, version: '2', attachmentIds: ['file-created-323'] })
    expect(commands.form('owner_change', change.id, session)).toMatchObject({
      draft: { name: '首层机电管线变更（修订）', status: 'draft' },
      attachments: [{ id: 'file-created-323', fileName: '修订依据.pdf', deletedAt: null }],
    })
    await expect(commands.execute({ ...request, commandId: 'stale-change-323' }, session))
      .rejects
      .toThrow('其他操作更新')
  })

  it('含税审定金额与量价变更合计分别往返，不因存在明细而互相覆盖', async () => {
    const commands = instance()
    await commands.execute({
      ...commandEnvelope('save-distinct-change-amounts-323'),
      action: 'save',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        approvedTaxInclusiveAmount: 888,
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)

    expect(commands.form('owner_change', change.id, session).draft).toMatchObject({
      approvedTaxInclusiveAmount: 888,
      totalAmount: 520,
    })
    expect(commands.rows().find(row => row.id === change.id)).toMatchObject({
      amount: 888,
      boqAmount: 520,
    })
  })

  it('纯金额签证可以只填审定不含税金额', async () => {
    const commands = instance()
    const result = await commands.execute({
      ...commandEnvelope('submit-tax-exclusive-only-change-323'),
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: {
        name: '纯金额现场签证',
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        applicationDate: '2026-08-25',
        reason: '仅确认不含税金额',
        approvedTaxExclusiveAmount: 88,
        lines: [],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)

    expect(commands.form('owner_change', result.id, session).draft).toMatchObject({
      approvedTaxInclusiveAmount: 0,
      approvedTaxExclusiveAmount: 88,
      totalAmount: 0,
      status: 'submitted',
    })
    const approved = await commands.execute({
      ...commandEnvelope('approve-tax-exclusive-only-change-323'),
      action: 'approve',
      kind: 'owner_change',
      id: result.id,
      baseVersion: result.version,
      approvedAt: '2026-08-25',
    }, session)
    const report = await commands.execute({
      ...commandEnvelope('report-after-pure-amount-change-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        periodNo: '2026-08',
        applicationDate: '2026-08-25',
        lines: [{ boqLineId: 'boq-line-command-323', reportedQty: 80 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(approved.version).toBe('2')
    expect(commands.form('owner_report', report.id, session).draft).toMatchObject({
      quantitySourceVersion: 'monthly-quantity-2026-08-v1',
      quantitySourceUpdatedAt: '2026-08-24T10:00:00.000Z',
    })
  })

  it('新建月度报量只接受同一项目合同的稳定 BOQ 行，并由服务端重算申报金额', async () => {
    const commands = instance()
    const result = await commands.execute({
      ...commandEnvelope('submit-report-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        periodNo: '2026-08',
        applicationDate: '2026-08-25',
        operatorName: '周经办',
        lines: [{ boqLineId: 'boq-line-command-323', reportedQty: 80, unitPrice: 1 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)

    expect(result).toMatchObject({ id: 'owner_report-created-323', version: '1' })
    expect(commands.form('owner_report', result.id, session).draft).toMatchObject({
      status: 'reported',
      reportedAmount: 4160,
      operatorName: '周经办',
      quantityBasis: 'field',
      quantitySourceVersion: 'monthly-quantity-2026-08-v1',
      quantitySourceUpdatedAt: '2026-08-24T10:00:00.000Z',
      submittedAt: '2026-08-25T02:00:00.000Z',
      lines: [{
        boqLineId: 'boq-line-command-323',
        autoQty: 90,
        reportedQty: 80,
        unitPrice: 52,
        amount: 4160,
      }],
    })

    await expect(commands.execute({
      ...commandEnvelope('invalid-report-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        periodNo: '2026-10',
        applicationDate: '2026-08-25',
        lines: [{ boqLineId: 'unknown-boq-line', reportedQty: 1 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('月度工程量快照')
  })

  it('草稿不固化报量经办审计事实，申报时才冻结', async () => {
    const commands = instance()
    const saved = await commands.execute({
      ...commandEnvelope('save-report-operator-323'),
      action: 'save',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        periodNo: '2026-09',
        applicationDate: '2026-08-25',
        operatorName: '草稿临时经办人',
        lines: [{ boqLineId: 'boq-line-command-323', reportedQty: 95 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)

    expect(commands.form('owner_report', saved.id, session).draft.operatorName).toBe('')
    const submitted = await commands.execute({
      ...commandEnvelope('submit-report-operator-323'),
      action: 'submit',
      kind: 'owner_report',
      id: saved.id,
      baseVersion: saved.version,
      draft: {
        ...commands.form('owner_report', saved.id, session).draft,
        operatorName: '周经办',
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_report', submitted.id, session).draft.operatorName).toBe('周经办')
  })

  it('拒绝非法日历日期与倒序签证日期', async () => {
    const commands = instance(kind => `${kind}-date-323`)
    await expect(commands.execute({
      ...commandEnvelope('save-invalid-calendar-date-323'),
      action: 'save',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: { ...commands.form('owner_change', change.id, session).draft, applicationDate: '2026-02-30' },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('申报日期格式')

    const first = await commands.execute({
      ...commandEnvelope('submit-first-ordered-change-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: { ...commands.form('owner_change', change.id, session).draft, reason: '先签证' },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await expect(commands.execute({
      ...commandEnvelope('approve-invalid-calendar-date-323'),
      action: 'approve',
      kind: 'owner_change',
      id: change.id,
      baseVersion: first.version,
      approvedAt: '2026-02-30',
    }, session)).rejects.toThrow('签证日期格式')
    const approved = await commands.execute({
      ...commandEnvelope('approve-first-ordered-change-323'),
      action: 'approve',
      kind: 'owner_change',
      id: change.id,
      baseVersion: first.version,
      approvedAt: '2026-08-20',
    }, session)
    expect(approved.version).toBe('3')

    const second = await commands.execute({
      ...commandEnvelope('submit-second-ordered-change-323'),
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: {
        name: '后续调价签证',
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        applicationDate: '2026-08-25',
        reason: '后续调价',
        lines: [{ operation: 'price', boqLineId: 'boq-line-command-323', newUnitPrice: 70 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await expect(commands.execute({
      ...commandEnvelope('approve-out-of-order-change-323'),
      action: 'approve',
      kind: 'owner_change',
      id: second.id,
      baseVersion: second.version,
      approvedAt: '2026-08-10',
    }, session)).rejects.toThrow('早于已有签证')
  })

  it('拒绝同合同同月份的重复月报、草稿改期冲突与重复 BOQ 行', async () => {
    let sequence = 0
    const commands = instance(kind => `${kind}-unique-${++sequence}`)
    const draft = (periodNo: string) => ({
      projectId: 'project-command-323',
      contractId: 'contract-command-323',
      periodNo,
      applicationDate: '2026-08-25',
      lines: [{ boqLineId: 'boq-line-command-323', reportedQty: 80 }],
    })
    const august = await commands.execute({
      ...commandEnvelope('unique-report-august-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: draft('2026-08'),
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)

    await expect(commands.execute({
      ...commandEnvelope('duplicate-report-august-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: draft('2026-08'),
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('同一施工合同同一月份')

    const september = await commands.execute({
      ...commandEnvelope('unique-report-september-323'),
      action: 'save',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: draft('2026-09'),
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await expect(commands.execute({
      ...commandEnvelope('move-report-to-august-323'),
      action: 'save',
      kind: 'owner_report',
      id: september.id,
      baseVersion: september.version,
      draft: draft('2026-08'),
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('同一施工合同同一月份')

    await expect(commands.execute({
      ...commandEnvelope('duplicate-report-line-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        ...draft('2026-09'),
        lines: [
          { boqLineId: 'boq-line-command-323', reportedQty: 80 },
          { boqLineId: 'boq-line-command-323', reportedQty: 10 },
        ],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('不能重复选择 BOQ 行')
    expect(commands.form('owner_report', august.id, session).draft.status).toBe('reported')
  })

  it('调减数量可为负数，但服务端拒绝把有效合同量减到负数', async () => {
    const commands = instance()
    const draft = commands.form('owner_change', change.id, session).draft
    await commands.execute({
      ...commandEnvelope('negative-qty-323'),
      action: 'save',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: { ...draft, lines: [{ boqLineId: 'boq-line-command-323', operation: 'qty', deltaQty: -20 }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_change', change.id, session).draft).toMatchObject({
      totalAmount: -1040,
      lines: [{ deltaQty: -20, amount: -1040 }],
    })

    const other = instance()
    await expect(other.execute({
      ...commandEnvelope('over-negative-qty-323'),
      action: 'save',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: { ...draft, lines: [{ boqLineId: 'boq-line-command-323', operation: 'qty', deltaQty: -101 }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('调整后合同工程量不能为负数')
  })

  it('调价金额使用先前已签证调量后的有效工程量', async () => {
    const approved = {
      ...change,
      id: 'approved-qty-323',
      sourceId: 'approved-qty-323',
      status: 'approved',
      sourceLocked: true,
      lines: [{ ...change.lines[0]!, id: 'approved-qty-line-323', deltaQty: -20, amount: -1040 }],
    }
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      now: () => '2026-08-25T02:00:00.000Z',
      projects: [{ id: 'project-command-323', name: '中央施工项目', customerId: 'customer-command-323' }],
      customers: [{ id: 'customer-command-323', name: '中央甲方客户' }],
      contracts: [{ id: 'contract-command-323', no: 'SG-2026-323', name: '中央施工合同', projectId: 'project-command-323', customerId: 'customer-command-323' }],
      boqLines: [{ id: 'boq-line-command-323', projectId: 'project-command-323', contractId: 'contract-command-323', itemName: '桥架安装', unit: 'm', qty: 100, unitPrice: 52, autoQty: 90, missingQtyCount: 0 }],
      documents: [approved, change],
    })
    const result = await commands.execute({
      ...commandEnvelope('effective-price-323'),
      action: 'save',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'price', newUnitPrice: 60 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_change', result.id, session).draft).toMatchObject({
      totalAmount: 640,
      lines: [{ contractQty: 80, contractUnitPrice: 52, newUnitPrice: 60, amount: 640 }],
    })
  })

  it('签证时按当前已签证链重算，拒绝过期调量将合同量减为负数', async () => {
    const commands = instance()
    const stale = await commands.execute({
      ...commandEnvelope('submit-stale-negative-qty-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        reason: '过期大幅调减',
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'qty', deltaQty: -90 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    const intervening = await commands.execute({
      ...commandEnvelope('submit-intervening-negative-qty-323'),
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: {
        name: '先生效调减',
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        applicationDate: '2026-08-25',
        reason: '先调减 20',
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'qty', deltaQty: -20 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await commands.execute({
      ...commandEnvelope('approve-intervening-negative-qty-323'),
      action: 'approve',
      kind: 'owner_change',
      id: intervening.id,
      baseVersion: intervening.version,
      approvedAt: '2026-08-25',
    }, session)

    await expect(commands.execute({
      ...commandEnvelope('approve-stale-negative-qty-323'),
      action: 'approve',
      kind: 'owner_change',
      id: stale.id,
      baseVersion: stale.version,
      approvedAt: '2026-08-25',
    }, session)).rejects.toThrow('调整后合同工程量不能为负数')
  })

  it('签证时用中间已生效调量重算过期调价金额', async () => {
    const commands = instance()
    const stalePrice = await commands.execute({
      ...commandEnvelope('submit-stale-price-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        reason: '调价待签',
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'price', newUnitPrice: 60 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    const quantity = await commands.execute({
      ...commandEnvelope('submit-intervening-positive-qty-323'),
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: {
        name: '中间调量',
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        applicationDate: '2026-08-25',
        reason: '增加 20',
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'qty', deltaQty: 20 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await commands.execute({
      ...commandEnvelope('approve-intervening-positive-qty-323'),
      action: 'approve',
      kind: 'owner_change',
      id: quantity.id,
      baseVersion: quantity.version,
      approvedAt: '2026-08-25',
    }, session)
    await commands.execute({
      ...commandEnvelope('approve-rebased-price-323'),
      action: 'approve',
      kind: 'owner_change',
      id: stalePrice.id,
      baseVersion: stalePrice.version,
      approvedAt: '2026-08-26',
    }, session)

    expect(commands.form('owner_change', stalePrice.id, session).draft).toMatchObject({
      totalAmount: 960,
      lines: [{ contractQty: 120, contractUnitPrice: 52, newUnitPrice: 60, amount: 960 }],
    })
  })

  it('提交新增或调价时显式拒绝缺失单价，不把 null 当作零价', async () => {
    const commands = instance()
    await expect(commands.execute({
      ...commandEnvelope('missing-price-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        reason: '新增工作内容',
        lines: [{ operation: 'add', itemName: '新增桥架', unit: 'm', deltaQty: 2, newUnitPrice: null }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('新增合同单价不能为空')
  })

  it('新增清单项签证后物化稳定 BOQ 行，并可进入后续月度报量', async () => {
    const commands = instance()
    const submitted = await commands.execute({
      ...commandEnvelope('submit-added-line-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        reason: '新增抗震支架',
        lines: [{ operation: 'add', itemName: '抗震支架', unit: '套', deltaQty: 3, newUnitPrice: 80 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await commands.execute({
      ...commandEnvelope('approve-added-line-323'),
      action: 'approve',
      kind: 'owner_change',
      id: change.id,
      baseVersion: submitted.version,
      approvedAt: '2026-08-25',
    }, session)

    expect(commands.form('owner_change', change.id, session).draft).toMatchObject({
      status: 'approved',
      lines: [{ boqLineId: 'boq-line-added-323', operation: 'add' }],
    })
    expect(commands.boqLinesFor('project-command-323', 'contract-command-323', '2026-08'))
      .toContainEqual(expect.objectContaining({
        id: 'boq-line-added-323',
        itemName: '抗震支架',
        qty: 3,
        unitPrice: 80,
      }))

    const report = await commands.execute({
      ...commandEnvelope('report-added-line-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        periodNo: '2026-08',
        applicationDate: '2026-08-25',
        lines: [{ boqLineId: 'boq-line-added-323', reportedQty: 2 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_report', report.id, session).draft).toMatchObject({
      status: 'reported',
      reportedAmount: 160,
      lines: [{ boqLineId: 'boq-line-added-323', unitPrice: 80, reportedQty: 2 }],
    })
  })

  it('已签证调价按签证时序叠加，不受草稿插入顺序影响', async () => {
    const early = {
      ...change,
      id: 'approved-price-early-323',
      sourceId: 'approved-price-early-323',
      status: 'approved',
      sourceLocked: true,
      approvalDate: '2026-08-10',
      lines: [{ ...change.lines[0]!, id: 'price-early-line-323', operation: 'price' as const, deltaQty: null, newUnitPrice: 60, amount: 800 }],
    }
    const late = {
      ...early,
      id: 'approved-price-late-323',
      sourceId: 'approved-price-late-323',
      approvalDate: '2026-08-20',
      lines: [{ ...early.lines[0]!, id: 'price-late-line-323', newUnitPrice: 70, amount: 1000 }],
    }
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      projects: [{ id: 'project-command-323', name: '中央施工项目', customerId: 'customer-command-323' }],
      customers: [{ id: 'customer-command-323', name: '中央甲方客户' }],
      contracts: [{ id: 'contract-command-323', no: 'SG-2026-323', name: '中央施工合同', projectId: 'project-command-323', customerId: 'customer-command-323' }],
      boqLines: [{ id: 'boq-line-command-323', projectId: 'project-command-323', contractId: 'contract-command-323', itemName: '桥架安装', unit: 'm', qty: 100, unitPrice: 52, autoQty: 90, missingQtyCount: 0 }],
      documents: [late, early, change],
    })
    await commands.execute({
      ...commandEnvelope('ordered-price-323'),
      action: 'save',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'price', newUnitPrice: 80 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_change', change.id, session).draft).toMatchObject({
      totalAmount: 1000,
      lines: [{ amount: 1000 }],
    })
  })

  it('同日同一时钟下按签证执行顺序重放，不回退到单据 ID 顺序', async () => {
    let clock = '2026-08-25T02:00:00.000Z'
    const commands = instance(() => 'aaa-second-price-323', () => clock)
    const first = await commands.execute({
      ...commandEnvelope('submit-first-same-day-price-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        reason: '同日先调价',
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'price', newUnitPrice: 60 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    const approvedFirst = await commands.execute({
      ...commandEnvelope('approve-first-same-day-price-323'),
      action: 'approve',
      kind: 'owner_change',
      id: first.id,
      baseVersion: first.version,
      approvedAt: '2026-08-25',
    }, session)
    const second = await commands.execute({
      ...commandEnvelope('submit-second-same-day-price-323'),
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: {
        name: '同日后调价',
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        applicationDate: '2026-08-25',
        reason: '同日后调价',
        lines: [{ boqLineId: 'boq-line-command-323', operation: 'price', newUnitPrice: 70 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await commands.execute({
      ...commandEnvelope('approve-second-same-day-price-323'),
      action: 'approve',
      kind: 'owner_change',
      id: second.id,
      baseVersion: second.version,
      approvedAt: '2026-08-25',
    }, session)

    clock = '2026-08-25T03:00:00.000Z'
    await commands.execute({
      ...commandEnvelope('attach-first-after-both-approved-323'),
      action: 'attachments',
      kind: 'owner_change',
      id: first.id,
      baseVersion: approvedFirst.version,
      attachments: {
        add: [{ fileName: '后补依据.pdf', fileSize: 323, mimeType: 'application/pdf', category: '变更依据' }],
        removeIds: [],
        restoreIds: [],
      },
    }, session)

    expect(commands.boqLinesFor('project-command-323', 'contract-command-323'))
      .toContainEqual(expect.objectContaining({ id: 'boq-line-command-323', unitPrice: 70 }))
  })

  it('迁移签证缺少签证日期时，后补附件不改变不可变签证顺序', async () => {
    const first = {
      ...change,
      id: 'zzz-migrated-first-price-323',
      sourceId: 'zzz-migrated-first-price-323',
      status: 'approved',
      sourceLocked: true,
      approvalDate: null,
      approvalSequenceAt: '2026-08-25T02:00:00.000Z',
      updatedAt: '2026-08-25T02:00:00.000Z',
      lines: [{ ...change.lines[0]!, operation: 'price' as const, deltaQty: null, newUnitPrice: 60, amount: 800 }],
    }
    const second = {
      ...first,
      id: 'aaa-migrated-second-price-323',
      sourceId: 'aaa-migrated-second-price-323',
      approvalSequenceAt: '2026-08-25T02:00:00.001Z',
      updatedAt: '2026-08-25T02:00:00.001Z',
      lines: [{ ...first.lines[0]!, newUnitPrice: 70, amount: 1000 }],
    }
    const commands = instance(undefined, () => '2026-08-25T03:00:00.000Z', [first, second])

    await commands.execute({
      ...commandEnvelope('attach-migrated-first-price-323'),
      action: 'attachments',
      kind: 'owner_change',
      id: first.id,
      baseVersion: '1',
      attachments: {
        add: [{ fileName: '历史补传.pdf', fileSize: 323, mimeType: 'application/pdf', category: '变更依据' }],
        removeIds: [],
        restoreIds: [],
      },
    }, session)

    expect(commands.boqLinesFor('project-command-323', 'contract-command-323'))
      .toContainEqual(expect.objectContaining({ id: 'boq-line-command-323', unitPrice: 70 }))
  })

  it('月报申报与审定冻结此前已签证的有效合同量价', async () => {
    const approvedQty = {
      ...change,
      id: 'approved-report-qty-323',
      sourceId: 'approved-report-qty-323',
      status: 'approved',
      sourceLocked: true,
      approvalDate: '2026-08-10',
      lines: [{ ...change.lines[0]!, id: 'approved-report-qty-line-323', deltaQty: -20, amount: -1040 }],
    }
    const approvedPrice = {
      ...approvedQty,
      id: 'approved-report-price-323',
      sourceId: 'approved-report-price-323',
      approvalDate: '2026-08-20',
      lines: [{ ...change.lines[0]!, id: 'approved-report-price-line-323', operation: 'price' as const, deltaQty: null, newUnitPrice: 60, amount: 640 }],
    }
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      now: () => '2026-08-25T02:00:00.000Z',
      createId: () => 'report-effective-323',
      projects: [{ id: 'project-command-323', name: '中央施工项目', customerId: 'customer-command-323' }],
      customers: [{ id: 'customer-command-323', name: '中央甲方客户' }],
      contracts: [{ id: 'contract-command-323', no: 'SG-2026-323', name: '中央施工合同', projectId: 'project-command-323', customerId: 'customer-command-323' }],
      boqLines: [{ id: 'boq-line-command-323', projectId: 'project-command-323', contractId: 'contract-command-323', itemName: '桥架安装', unit: 'm', qty: 100, unitPrice: 52, autoQty: 90, missingQtyCount: 0 }],
      monthlyQuantityFacts: [{ projectId: 'project-command-323', contractId: 'contract-command-323', periodNo: '2026-08', boqLineId: 'boq-line-command-323', autoQty: 75, missingQtyCount: 0, quantityBasis: 'field', sourceVersion: 'monthly-effective-323', sourceUpdatedAt: '2026-08-24T10:00:00.000Z' }],
      documents: [approvedPrice, approvedQty],
    })
    expect(commands.boqLinesFor('project-command-323', 'contract-command-323', '2026-08'))
      .toContainEqual(expect.objectContaining({
        id: 'boq-line-command-323',
        qty: 80,
        unitPrice: 60,
      }))
    const submitted = await commands.execute({
      ...commandEnvelope('report-effective-submit-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        periodNo: '2026-08',
        applicationDate: '2026-08-25',
        lines: [{ boqLineId: 'boq-line-command-323', reportedQty: 75 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.rows().find(row => row.id === submitted.id)?.lines[0]).toMatchObject({
      contractQty: 80,
      contractUnitPrice: 60,
    })
    expect(commands.form('owner_report', submitted.id, session).draft).toMatchObject({
      reportedAmount: 4500,
      lines: [{ unitPrice: 60, reportedQty: 75, amount: 4500 }],
    })

    await commands.execute({
      ...commandEnvelope('report-effective-audit-323'),
      action: 'audit',
      kind: 'owner_report',
      id: submitted.id,
      baseVersion: submitted.version,
      audit: { lines: [{ boqLineId: 'boq-line-command-323', auditedQty: 70 }] },
    }, session)
    expect(commands.form('owner_report', submitted.id, session).draft).toMatchObject({
      auditedAmount: 4200,
      lines: [{ auditedQty: 70, auditedAmount: 4200 }],
    })
  })

  it('允许保存不完整草稿，并允许已上报单据通过独立命令维护附件', async () => {
    const commands = instance()
    const draftResult = await commands.execute({
      ...commandEnvelope('incomplete-draft-323'),
      action: 'save',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {},
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(commands.form('owner_report', draftResult.id, session).draft).toMatchObject({ status: 'draft', projectId: null, contractId: null })

    const submitted = await commands.execute({
      ...commandEnvelope('submit-for-attachments-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: { ...commands.form('owner_change', change.id, session).draft, reason: '现场调整' },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    const attached = await commands.execute({
      ...commandEnvelope('attachments-after-submit-323'),
      action: 'attachments',
      kind: 'owner_change',
      id: change.id,
      baseVersion: submitted.version,
      attachments: { add: [{ fileName: '甲方回函.pdf', fileSize: 323, mimeType: 'application/pdf', category: '甲方回函' }], removeIds: [], restoreIds: [] },
    }, session)
    expect(attached).toMatchObject({ version: '3', attachmentIds: ['file-created-323'] })
  })

  it('签证与审定均走正式命令并锁定服务端事实', async () => {
    const commands = instance()
    const submittedChange = await commands.execute({
      ...commandEnvelope('submit-change-323'),
      action: 'submit',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      draft: {
        ...commands.form('owner_change', change.id, session).draft,
        reason: '现场条件变化',
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await commands.execute({
      ...commandEnvelope('approve-change-323'),
      action: 'approve',
      kind: 'owner_change',
      id: change.id,
      baseVersion: submittedChange.version,
      approvedAt: '2026-08-25',
    }, session)
    expect(commands.form('owner_change', change.id, session).draft).toMatchObject({
      status: 'approved',
      sourceLocked: true,
      approvalDate: '2026-08-25',
      applicationDate: '2026-08-08',
    })

    const submitted = await commands.execute({
      ...commandEnvelope('create-report-323'),
      action: 'submit',
      kind: 'owner_report',
      id: null,
      baseVersion: null,
      draft: {
        projectId: 'project-command-323',
        contractId: 'contract-command-323',
        periodNo: '2026-08',
        applicationDate: '2026-08-25',
        lines: [{ boqLineId: 'boq-line-command-323', reportedQty: 80 }],
      },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    await commands.execute({
      ...commandEnvelope('audit-report-323'),
      action: 'audit',
      kind: 'owner_report',
      id: submitted.id,
      baseVersion: submitted.version,
      audit: {
        lines: [{ boqLineId: 'boq-line-command-323', auditedQty: 75 }],
      },
    }, session)

    expect(commands.form('owner_report', submitted.id, session).draft).toMatchObject({
      status: 'audited',
      auditedAmount: 3900,
      auditDifference: -260,
      lines: [{ auditedQty: 75, auditedAmount: 3900 }],
    })
  })

  it('没有正式写权限时拒绝读取写态表单和执行命令', async () => {
    const commands = instance()
    const forbidden = { ...session, capabilities: ['owner-document:read'] }

    expect(() => commands.form('owner_change', change.id, forbidden)).toThrow('无甲方商务单据写入权限')
    await expect(commands.execute({
      ...commandEnvelope('forbidden-323'),
      action: 'approve',
      kind: 'owner_change',
      id: change.id,
      baseVersion: '1',
      approvedAt: '2026-08-25',
    }, forbidden)).rejects.toThrow('无甲方商务单据写入权限')
  })
})
