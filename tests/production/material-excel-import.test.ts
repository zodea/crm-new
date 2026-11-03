import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionMaterialContractService } from '../../server/utils/production-material-contract-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { testTempRoot } from '../helpers/test-temp-root'

it('整文件合同、明细、原件及施工关联同事务提交，失败不留半成品并可冷重放', async () => {
  const base = testTempRoot('material-excel-import')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'material-excel-workspace', ownerId: 'synthetic-owner', purpose: 'verification' })
  const actor = { workspaceId: 'material-excel-workspace', actorId: 'synthetic-owner', capabilities: ['material-contract:read', 'material-contract:write', 'material-contract:sensitive:read', 'construction-contract:read', 'construction-contract:write', 'construction-scope:read', 'construction-scope:write', 'project:list:read', 'project:write', 'customer:list:read', 'customer:write', 'supplier:list:read', 'supplier:write', 'our-signatory:read', 'our-signatory:write'] }
  const session = () => actor
  const envelope = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'save', attachments: {} }
  try {
    const customer = await createProductionCustomerService(storage).execute({ ...envelope, requiredCapability: 'customer:write', commandId: 'excel-customer', draft: { name: '合成客户', contact: '合成人' } }, session)
    const project = await createProductionProjectService(storage).execute({ ...envelope, requiredCapability: 'project:write', commandId: 'excel-project', draft: { name: '合成项目', customerId: customer.id, manager: '合成人' } }, session)
    await createProductionSupplierService(storage).execute({ ...envelope, requiredCapability: 'supplier:write', commandId: 'excel-supplier', draft: { name: '合成分供方', supplierCategory: '其他', contact: '合成人' } }, session)
    const signatory = await createProductionOurSignatoryService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', commandId: 'excel-signatory', baseVersion: null, draft: { name: '合成我方主体', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '合成资料', status: 'active' } }, session)
    await createProductionConstructionContractService(storage).execute({ ...envelope, requiredCapability: 'construction-contract:write', commandId: 'excel-main', draft: { name: '合成施工主合同', projectId: project.id, customerId: customer.id, content: '合成内容', signDate: '2026-10-07', ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, status: '已签订' } }, session)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['导入分组号', '合同编号', '合同名称', '项目名称', '施工主合同名称或编号', '分供方名称', '我方签约主体', '含税合同金额'], ['G1', 'SYN-1', '合成采购一', '合成项目', '合成施工主合同', '合成分供方', '合成我方主体', 20], ['G2', 'SYN-1', '合成采购二', '合成项目', '合成施工主合同', '合成分供方', '合成我方主体', 40]]), '合同主档')
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['导入分组号', '物资名称', '计量单位', '计价单位', '数量', '含税单价', '数量及单位已核实'], ['G1', '合成方管', '米', '米', 2, 10, '是'], ['G2', '合成线管', '米', '米', 4, 10, '是']]), '采购明细')
    const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
    const file = { fileName: '合成采购.xlsx', fileSize: bytes.length, payloadBase64: bytes.toString('base64') }
    let service = createProductionMaterialContractService(storage)
    const preview = await service.previewExcel({ file }, session)
    const decisions = preview.rows.map(row => ({ key: row.key, fingerprint: row.fingerprint, kind: 'create', project: row.projects[0], supplier: row.suppliers[0], signatory: row.signatories[0], main: { id: row.mains[0]!.id, projectId: row.mains[0]!.projectId, basis: row.mains[0]!.basis } }))
    const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, file, decisions }
    const bad = { ...request, decisions: [decisions[0], { ...decisions[1], supplier: { ...decisions[1]!.supplier, version: '999' } }] }
    await expect(service.importExcel(bad, session)).rejects.toThrow('分供方')
    expect(await storage.select('SELECT * FROM material_contract_records')).toEqual([])
    expect(await storage.select('SELECT * FROM file_refs')).toEqual([])
    let originals = 0
    const failingStorage: typeof storage = {
      ...storage,
      withTransaction: async work => storage.withTransaction(tx => work({ ...tx, execute: async (sql, ...args) => {
        if (/INSERT INTO file_payloads/i.test(sql) && ++originals === 2)
          throw new Error('synthetic-second-original-failure')
        return tx.execute(sql, ...args)
      } })),
    }
    await expect(createProductionMaterialContractService(failingStorage).importExcel(request, session)).rejects.toThrow('synthetic-second-original-failure')
    expect(await storage.select('SELECT * FROM material_contract_records')).toEqual([])
    expect(await storage.select('SELECT * FROM file_refs')).toEqual([])
    expect(await storage.select('SELECT * FROM material_contract_commands')).toEqual([])
    expect(await storage.select('SELECT * FROM construction_scope_links WHERE source_domain=\'material-contract\'')).toEqual([])
    const result = await service.importExcel(request, session)
    expect(result.results).toHaveLength(2)
    expect(await storage.select('SELECT * FROM construction_scope_links WHERE source_domain=\'material-contract\'')).toHaveLength(2)
    for (const receipt of result.results) {
      expect(receipt).not.toBeNull()
      const form = await service.form(receipt!.id, session)
      expect(form.draft.no).toBe('SYN-1')
      expect(form.draft.status).toBe('草稿')
      expect(form.draft.lineItems).toHaveLength(1)
      expect(form.attachments).toHaveLength(1)
      expect(Buffer.from((await service.file(receipt!.id, form.attachments[0]!.id, session)).bytes).equals(bytes)).toBe(true)
    }
    await storage.close()
    service = createProductionMaterialContractService(storage)
    expect(await service.importExcel(request, session)).toEqual(result)
    expect(await storage.select('SELECT * FROM material_contract_records')).toHaveLength(2)
  }
  finally { await storage.close() }
})
