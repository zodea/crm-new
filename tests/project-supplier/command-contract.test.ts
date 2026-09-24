import type { SupplierListSourceRow } from '~/lib/supplier/repository'
import { describe, expect, it } from 'vitest'
import {
  PROJECT_SUPPLIER_WRITE_CAPABILITY,
  ProjectSupplierRepositoryProblem,
} from '~/lib/project-supplier/repository'
import { assertProjectSupplierWriteCapability } from '../../server/utils/project-supplier-command-request'
import { createProjectSupplierCommandTestInstance } from '../../server/utils/project-supplier-command-test-instance'
import { createSupplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'

const session = {
  workspaceId: 'workspace-281',
  actorId: 'actor-281',
  capabilities: [PROJECT_SUPPLIER_WRITE_CAPABILITY],
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-281',
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    requiredCapability: PROJECT_SUPPLIER_WRITE_CAPABILITY,
    commandId: 'command-281',
    baseVersion: '0',
    groups: [{
      supplierId: null,
      supplierName: '中央新分供方',
      files: [{
        fileName: '中央新分供方-合同.pdf',
        fileSize: 3,
        mimeType: 'application/pdf',
        category: '合同',
        payloadBase64: 'QUJD',
      }],
    }],
    ...overrides,
  }
}

const context = {
  project: { id: 'project-281', name: '中央正式项目' },
  suppliers: [],
  existingRelationships: [],
}

describe('项目分供方中央导入命令', () => {
  it('原子创建正式分供方、合作关系与文件元数据，重复 commandId 不重复写入', async () => {
    let sequence = 0
    const suppliers = createSupplierCommandTestInstance()
    const removed: Array<{ ids: string[], sessionId?: string | null }> = []
    const instance = createProjectSupplierCommandTestInstance({
      createId: prefix => `${prefix}-${++sequence}`,
      now: () => '2026-08-27T00:00:00.000Z',
      prepareSupplierAdoption: (rows, sessionId) => suppliers.prepareImportedSuppliers(rows, sessionId),
      resolveSupplierRows: sessionId => suppliers.rows(sessionId),
      removeSuppliers: (ids, sessionId) => {
        removed.push({ ids: [...ids], sessionId })
        suppliers.removeImportedSuppliers(ids, sessionId)
      },
    })

    const first = await instance.execute(request(), session, context, 'session-281')
    const duplicate = await instance.execute(request(), session, context, 'session-281')

    expect(duplicate).toEqual(first)
    expect(first).toMatchObject({
      commandId: 'command-281',
      version: '1',
      relationshipCount: 1,
      fileCount: 1,
      createdSupplierCount: 1,
      reusedRelationshipCount: 0,
    })
    expect(instance.rows('session-281')).toMatchObject({
      suppliers: [{ dataOrigin: 'real', id: 'supplier-1', name: '中央新分供方' }],
      relations: [{ dataOrigin: 'real', id: 'project-supplier-2', projectId: 'project-281', supplierId: 'supplier-1' }],
      files: [{ dataOrigin: 'real', id: 'file-3', relationId: 'project-supplier-2', fileName: '中央新分供方-合同.pdf', uploader: 'actor-281' }],
    })
    expect(suppliers.rows('session-281')).toEqual([
      expect.objectContaining({ id: 'supplier-1', name: '中央新分供方' }),
    ])

    instance.reset('session-281')
    expect(removed).toEqual([{ ids: ['supplier-1'], sessionId: 'session-281' }])
  })

  it('版本冲突、正文缺失或文件长度错配时不留半成品', async () => {
    const instance = createProjectSupplierCommandTestInstance()

    await expect(instance.execute(request({ baseVersion: '9' }), session, context, 'session-281'))
      .rejects
      .toMatchObject<ProjectSupplierRepositoryProblem>({ problem: { code: 'conflict' } })
    await expect(instance.execute(request({
      commandId: 'command-invalid',
      groups: [{ supplierId: null, supplierName: '不应落库', files: [{ fileName: '   ' }] }],
    }), session, context, 'session-281')).rejects.toMatchObject<ProjectSupplierRepositoryProblem>({
      problem: { code: 'validation-failed' },
    })
    await expect(instance.execute(request({
      commandId: 'command-empty-payload',
      groups: [{ supplierId: null, supplierName: '无正文', files: [{ fileName: 'missing.pdf', fileSize: 3, mimeType: 'application/pdf', category: '合同', payloadBase64: '' }] }],
    }), session, context, 'session-281')).rejects.toMatchObject<ProjectSupplierRepositoryProblem>({
      problem: { code: 'validation-failed' },
    })
    await expect(instance.execute(request({
      commandId: 'command-size-mismatch',
      groups: [{ supplierId: null, supplierName: '长度错配', files: [{ fileName: 'mismatch.pdf', fileSize: 3, mimeType: 'application/pdf', category: '合同', payloadBase64: 'QQ==' }] }],
    }), session, context, 'session-281')).rejects.toMatchObject<ProjectSupplierRepositoryProblem>({
      problem: { code: 'validation-failed' },
    })
    await expect(instance.execute(request({
      commandId: 'command-invalid-category',
      groups: [{ supplierId: null, supplierName: '非法分类', files: [{ fileName: 'invalid.pdf', fileSize: 3, mimeType: 'application/pdf', category: '任意分类', payloadBase64: 'QUJD' }] }],
    }), session, context, 'session-281')).rejects.toMatchObject<ProjectSupplierRepositoryProblem>({
      problem: { code: 'validation-failed' },
    })

    expect(instance.rows('session-281')).toEqual({ projects: [], suppliers: [], relations: [], files: [] })
    expect(instance.sourceVersion('session-281')).toBe('0')
  })

  it('分供方中央接管失败时回滚全部事实，原 baseVersion 可直接重试', async () => {
    let attempt = 0
    let centralVersion = 7
    let sequence = 0
    const baseline: SupplierListSourceRow = {
      dataOrigin: 'real',
      id: 'supplier-existing',
      name: '既有中央分供方',
      aliases: [],
      externalRef: '',
      uniqueCode: '',
      taxNo: '',
      businessType: '',
      supplierCategory: '其他',
      rating: '',
      legalRep: '',
      registeredCapital: null,
      registeredDate: null,
      address: '',
      taxpayerType: '',
      mainBusiness: '',
      invoiceName: '',
      invoiceAddress: '',
      bank: '',
      bankAccount: '',
      phone: '',
      contact: '',
      contactPhone: '',
      contactTitle: '',
      credentialStatus: 'incomplete',
      note: '',
      updatedAt: '2026-08-27T00:00:00.000Z',
    }
    const centralRows = new Map<string, SupplierListSourceRow>([[baseline.id, baseline]])
    const instance = createProjectSupplierCommandTestInstance({
      createId: prefix => `${prefix}-atomic-${++sequence}`,
      prepareSupplierAdoption: rows => ({
        commit() {
          attempt += 1
          centralRows.set(rows[0]!.id, rows[0]!)
          centralVersion += 1
          if (attempt === 1)
            throw new Error('第二家分供方中央写入失败')
          for (const row of rows.slice(1))
            centralRows.set(row.id, row)
        },
        rollback() {
          centralRows.clear()
          centralRows.set(baseline.id, baseline)
          centralVersion = 7
        },
      }),
      resolveSupplierRows: () => [...centralRows.values()],
    })
    const atomicRequest = request({
      groups: [
        ...request().groups,
        {
          supplierId: null,
          supplierName: '中央新分供方二',
          files: [{ fileName: 'second.pdf', fileSize: 3, mimeType: 'application/pdf', category: '其他', payloadBase64: 'QUJD' }],
        },
      ],
    })

    await expect(instance.execute(atomicRequest, session, context, 'session-atomic')).rejects.toThrow('第二家分供方中央写入失败')
    expect(instance.rows('session-atomic')).toEqual({ projects: [], suppliers: [], relations: [], files: [] })
    expect(instance.sourceVersion('session-atomic')).toBe('0')
    expect([...centralRows.values()]).toEqual([baseline])
    expect(centralVersion).toBe(7)

    const retried = await instance.execute(atomicRequest, session, context, 'session-atomic')
    expect(retried.version).toBe('1')
    expect(instance.rows('session-atomic').relations).toHaveLength(2)
    expect(centralRows.size).toBe(3)
    expect(centralVersion).toBe(8)

    expect(await instance.execute(atomicRequest, session, context, 'session-atomic')).toEqual(retried)
    expect(centralRows.size).toBe(3)
    expect(centralVersion).toBe(8)
  })

  it('允许通过稳定 ID 复用超过 100 家候选集合尾部的正式分供方', async () => {
    const suppliers = Array.from({ length: 101 }, (_, index) => ({
      id: `supplier-${index + 1}`,
      name: `正式分供方 ${index + 1}`,
      aliases: [],
    }))
    const instance = createProjectSupplierCommandTestInstance()
    const result = await instance.execute(request({
      groups: [{
        supplierId: 'supplier-101',
        supplierName: '正式分供方 101',
        files: [{ fileName: 'tail.pdf', fileSize: 3, mimeType: 'application/pdf', category: '合同', payloadBase64: 'QUJD' }],
      }],
    }), session, { ...context, suppliers }, 'session-tail')

    expect(result.createdSupplierCount).toBe(0)
    expect(instance.rows('session-tail').relations[0]?.supplierId).toBe('supplier-101')
  })

  it('服务端导入上下文要求项目分供方写权限', () => {
    expect(() => assertProjectSupplierWriteCapability({ ...session, capabilities: [] }))
      .toThrowError(ProjectSupplierRepositoryProblem)
  })
})
