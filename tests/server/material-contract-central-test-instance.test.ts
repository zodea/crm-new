import { describe, expect, it } from 'vitest'
import { f2FormDefaults } from '~/lib/contract/page'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '~/lib/material-contract/command-contract'
import { prepareMaterialContractChainIdentityFixtures } from '../../server/utils/material-contract-chain-test-fixture'
import {
  createMaterialContractCommandTestInstance,
  MATERIAL_CONTRACT_EXISTING_RECORD,
  materialContractCommandTestInstance,
} from '../../server/utils/material-contract-command-test-instance'
import { createMaterialContractReadTestInstance } from '../../server/utils/material-contract-read-test-instance'
import { projectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { supplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'
import { supplierReadTestInstance } from '../../server/utils/supplier-read-test-instance'

describe('材料采购合同中央测试实例', () => {
  it('正式命令写入后可经中央列表和详情刷新读取', async () => {
    const command = createMaterialContractCommandTestInstance({
      createId: () => 'contract-real-test',
      createLineId: () => 'line-real-test',
      now: () => '2026-08-24T01:00:00.000Z',
      projects: [{ id: 'project-real-test', name: '正式项目' }],
      suppliers: [{ id: 'supplier-real-test', name: '正式供应商' }],
    })
    const session = {
      workspaceId: 'workspace-test',
      actorId: 'actor-test',
      capabilities: ['material-contract:read', MATERIAL_CONTRACT_WRITE_CAPABILITY],
    }
    const draft = {
      ...f2FormDefaults('material'),
      name: '中央写入材料合同',
      projectId: 'project-real-test',
      supplierId: 'supplier-real-test',
      content: '瓷砖采购',
      signDate: '2026-08-24',
      amount: 120,
      lineItems: [{ materialName: '瓷砖', spec: '', brand: '', unit: '㎡', qty: 1, taxInclusiveUnitPrice: 120, plannedArrivalDate: '', note: '', sortOrder: 0 }],
    }
    await command.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: MATERIAL_CONTRACT_WRITE_CAPABILITY,
      commandId: 'command-test',
      baseVersion: null,
      action: 'submit',
      draft,
      attachments: {},
    }, session)

    const rows = command.rows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.projectName).toBe('正式项目')
    expect(command.facts().lineItems[0]?.contractId).toBe('contract-real-test')
  })

  it('演示来源必须显式授权且来源不匹配不会回退', () => {
    const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
    expect(read.list({ includeDemo: 'true' }).items.some(row => row.dataOrigin === 'demo')).toBe(true)
    expect(() => read.detail('con_demo_cg01', { origin: 'real', includeDemo: 'true' }))
      .toThrowError(/来源与地址不匹配/)
  })

  it('合同迁入只接受已存在的中央身份，并向分供方事实回流正式合同与项目', async () => {
    const sessionId = 'issue-277-central-chain'
    projectCommandTestInstance.reset(sessionId)
    supplierCommandTestInstance.reset(sessionId)
    materialContractCommandTestInstance.reset(sessionId)
    supplierReadTestInstance.reset('ready', sessionId)

    try {
      expect(materialContractCommandTestInstance.formContext(sessionId)).toEqual({ projects: [], suppliers: [], originalContracts: [] })
      expect(() => materialContractCommandTestInstance.importExisting([MATERIAL_CONTRACT_EXISTING_RECORD], sessionId))
        .toThrowError(/项目不存在/)
      expect(projectCommandTestInstance.rows(sessionId)).toEqual([])
      expect(supplierCommandTestInstance.rows(sessionId)).toEqual([])

      prepareMaterialContractChainIdentityFixtures(sessionId)
      materialContractCommandTestInstance.importExisting([MATERIAL_CONTRACT_EXISTING_RECORD], sessionId)

      expect(projectCommandTestInstance.rows(sessionId)).toEqual([
        expect.objectContaining({ id: 'project-real-318', name: '中央正式材料项目', dataOrigin: 'real' }),
      ])
      expect(supplierCommandTestInstance.rows(sessionId)).toEqual([
        expect.objectContaining({ id: 'supplier-real-318', name: '中央正式材料供应商', dataOrigin: 'real' }),
      ])
      expect(materialContractCommandTestInstance.formContext(sessionId)).toEqual({
        projects: [{ id: 'project-real-318', name: '中央正式材料项目' }],
        suppliers: [{ id: 'supplier-real-318', name: '中央正式材料供应商', contact: '', contactPhone: '' }],
        originalContracts: [{ id: 'contract-existing-318', no: 'CG-EXISTING-318', label: 'CG-EXISTING-318 · 既有中央材料采购合同', projectId: 'project-real-318', supplierId: 'supplier-real-318', lineItems: [{ id: 'line-existing-318', materialName: '既有瓷砖', spec: '', materialGrade: '', brand: '', unit: '㎡', qty: 400, taxInclusiveUnitPrice: 24, applicableTaxRate: null, plannedArrivalDate: '', note: '', sortOrder: 0, originalLineId: null, changeAmount: null, changeBasis: '', source: null }], ourSignatorySnapshot: null }],
      })

      const supplier = await supplierReadTestInstance.detail('supplier-real-318', { origin: 'real' }, sessionId)
      expect(supplier).toMatchObject({
        supplier: { id: 'supplier-real-318', name: '中央正式材料供应商' },
        contracts: [{
          contract: { id: 'contract-existing-318', label: '既有中央材料采购合同' },
          project: { state: 'resolved', id: 'project-real-318', label: '中央正式材料项目' },
        }],
        summary: {
          contractAmount: { value: '9600.00', drilldown: { kind: 'entity-subview', subject: { entity: 'supplier', id: 'supplier-real-318' }, variant: 'contracts', filters: { dataOrigin: 'real' } } },
          settlementAmount: { value: '0.00', drilldown: { kind: 'entity-subview', subject: { entity: 'supplier', id: 'supplier-real-318' }, variant: 'settlements', filters: { dataOrigin: 'real' } } },
        },
      })

      projectCommandTestInstance.reset(sessionId)
      supplierCommandTestInstance.reset(sessionId)
      expect(materialContractCommandTestInstance.rows(sessionId)).toEqual([
        expect.objectContaining({
          projectId: 'project-real-318',
          projectName: '',
          projectReferenceState: 'missing-target',
          supplierId: 'supplier-real-318',
          supplierName: '',
          supplierReferenceState: 'missing-target',
        }),
      ])
    }
    finally {
      materialContractCommandTestInstance.reset(sessionId)
      supplierCommandTestInstance.reset(sessionId)
      projectCommandTestInstance.reset(sessionId)
    }
  })
})
