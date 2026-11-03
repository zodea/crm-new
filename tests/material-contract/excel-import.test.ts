import type { RawImportWorkbook } from '../../app/lib/util/excel'
import { expect, it } from 'vitest'
import { materialExcelBatchKey, materialExcelCommandIds } from '../../app/lib/material-contract/excel-batch-key'
import { prepareMaterialExcelWorkbook } from '../../app/lib/material-contract/excel-import'
import { commandFingerprint } from '../../server/utils/command-journal'
import { materialExcelPreview } from '../../server/utils/material-excel-import'

function workbook(): RawImportWorkbook {
  const source = { sourceFileName: '合成采购.xlsx', sourceHash: 'a'.repeat(64), headerRow: 0, range: '', mergeRanges: [], formulaCount: 0, columns: [] }
  return { sheets: [
    { ...source, name: '合同主档', rowNumbers: [2], rows: [{ 导入分组号: 'G-1', 合同名称: '合成合同', 项目名称: '合成项目', 施工主合同名称或编号: '主合同一', 分供方名称: '合成供方', 税率: '13%', 质保金比例: '5%', 含税合同金额: '200' }] },
    { ...source, name: '采购明细', rowNumbers: [4], rows: [{ 导入分组号: 'G-1', 物资名称: '合成方管', 计量单位: '米', 计价单位: '米', 数量: '10', 含税单价: '20', 数量及单位已核实: '是' }] },
  ] }
}

it('按明确分组连接合同与明细，并保留来源行、单位核实与税率口径', () => {
  const result = prepareMaterialExcelWorkbook(workbook())
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ key: 'G-1', projectName: '合成项目', supplierName: '合成供方', draft: { name: '合成合同', taxRate: 13, retentionRatio: 0.05, amount: 200 }, lineItems: [{ materialName: '合成方管', qty: 10, taxInclusiveUnitPrice: 20, source: { fileName: '合成采购.xlsx', sheetName: '采购明细', rowNumber: 4, sourceHash: 'a'.repeat(64), priceUnit: '米', quantityUnitVerified: true } }] })
})
it('缺来源、分组歧义、孤立明细及未核实单位均拒绝整批', () => {
  const duplicate = workbook()
  duplicate.sheets[0]!.rows.push({ ...duplicate.sheets[0]!.rows[0] })
  expect(() => prepareMaterialExcelWorkbook(duplicate)).toThrow('唯一')
  const orphan = workbook()
  orphan.sheets[1]!.rows[0]!.导入分组号 = 'OTHER'
  expect(() => prepareMaterialExcelWorkbook(orphan)).toThrow('未找到唯一')
  const unverified = workbook()
  unverified.sheets[1]!.rows[0]!.数量及单位已核实 = '否'
  expect(() => prepareMaterialExcelWorkbook(unverified)).toThrow('未核实')
  const missing = workbook()
  missing.sheets[1]!.sourceHash = 'b'.repeat(64)
  expect(() => prepareMaterialExcelWorkbook(missing)).toThrow('完整文件来源')
})

it('浏览器和中央计算同一批次编号，可恢复每个非跳过行的原命令', async () => {
  const input = { workspaceId: '合成工作区', actorId: '合成人', fileHash: 'a'.repeat(64), fileName: '合成.xlsx', fileSize: 123, decisions: [{ key: 'G1', fingerprint: 'b'.repeat(64), kind: 'skip' as const }, { key: 'G2', fingerprint: 'c'.repeat(64), kind: 'create' as const }] }
  const key = await materialExcelBatchKey(input)
  expect(key).toBe(commandFingerprint(input))
  expect(materialExcelCommandIds(key, [1])).toEqual([`matx-${key}-1`])
  expect(() => materialExcelCommandIds(key, [1, 1])).toThrow('编号')
})

it('合同编号按现行精确口径预览，大小写不同不当作同号', () => {
  const [group] = prepareMaterialExcelWorkbook(workbook())
  group!.draft.no = 'ABC-01'
  const actor = { workspaceId: 'synthetic', actorId: 'synthetic', capabilities: ['material-contract:read', 'material-contract:write', 'material-contract:sensitive:read', 'project:list:read', 'supplier:list:read', 'construction-contract:read', 'construction-scope:read', 'our-signatory:read'] }
  const contract = { id: 'existing', draft: { id: 'existing', name: '其他名称', no: 'abc-01' }, version: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', history: [], attachments: [] }
  const inputs = { contracts: [contract], projects: [], suppliers: [], mains: [], signatories: [] }
  expect(materialExcelPreview([group!], inputs, actor)[0]!.candidates).toEqual([])
  contract.draft.no = 'ABC-01'
  expect(materialExcelPreview([group!], inputs, actor)[0]!.candidates).toMatchObject([{ id: 'existing', no: 'ABC-01' }])
})
