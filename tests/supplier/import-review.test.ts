import { expect, it } from 'vitest'
import { supplierImportFileDuplicates } from '~/lib/supplier/import-review'

it('按文件内名称及身份码标出重复，并保留原始行位置；忽略空值', () => {
  const rows = [
    { index: 0, draft: { name: '合成材料', externalRef: 'ID-1' } },
    { index: 4, draft: { name: '合成材料', externalRef: 'ID-2' } },
    { index: 8, draft: { name: '另一材料', externalRef: 'id-1' } },
    { index: 9, draft: { name: '独立材料', externalRef: '' } },
  ]
  expect([...supplierImportFileDuplicates(rows)]).toEqual([[0, [4, 8]], [4, [0]], [8, [0]]])
  expect([...supplierImportFileDuplicates(rows.filter(row => row.index === 4 || row.index === 8))]).toEqual([])
})
