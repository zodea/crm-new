import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import CrewExcelReview from '~/components/crew-worker/CrewExcelReview.vue'

it('每页可核对班组差异并明确选择替换', async () => {
  const entries = Array.from({ length: 11 }, (_, index) => ({
    index,
    rowNumber: index + 2,
    row: { name: `合成班组${index}`, note: '新备注' },
    preview: { fingerprint: 'a'.repeat(64), candidates: [{ id: `crew-${index}`, version: '1', name: `已有班组${index}`, fields: { name: `已有班组${index}`, note: '原备注' } }] },
    sameFileRows: [],
  }))
  const result = render(CrewExcelReview, { props: { entries, fields: [{ key: 'name', label: '班组名称' }, { key: 'note', label: '备注' }], choices: {}, locked: false } })
  expect(screen.queryByLabelText('第 12 行处理方式')).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('原备注')).toBeTruthy()
  expect(screen.getByText('新备注')).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('第 12 行处理方式'), 'replace:crew-10')
  expect(result.emitted('choose')).toEqual([[10, 'replace:crew-10']])
})
