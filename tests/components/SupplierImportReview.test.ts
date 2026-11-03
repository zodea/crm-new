import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import SupplierImportReview from '~/components/supplier/SupplierImportReview.vue'

it('多于一页的重复资料均可到达、查看差异并选择替换', async () => {
  const entries = Array.from({ length: 11 }, (_, index) => ({
    index,
    rowNumber: index + 2,
    row: { name: `合成公司${index}`, contact: '新联系人' },
    preview: { fingerprint: 'a'.repeat(64), candidates: [{ id: `supplier-${index}`, version: '1', name: `已有公司${index}`, matchedBy: ['name'] as Array<'name'>, fields: { name: `已有公司${index}`, contact: '原联系人' } }] },
    sameFileRows: [],
  }))
  const { emitted } = render(SupplierImportReview, { props: { entries, fields: [{ key: 'name', label: '名称' }, { key: 'contact', label: '联系人' }], choices: {}, locked: false } })
  expect(screen.queryByLabelText('第 12 行处理方式')).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('已有：已有公司10（公司名称匹配）')).toBeTruthy()
  expect(screen.getByText('原联系人')).toBeTruthy()
  expect(screen.getByText('新联系人')).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('第 12 行处理方式'), 'replace:supplier-10')
  expect(emitted('choose')).toEqual([[10, 'replace:supplier-10']])
})
