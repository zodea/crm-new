import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it } from 'vitest'
import WorkerExcelReview from '~/components/crew-worker/WorkerExcelReview.vue'

it('分页核对同名工人，并选择明确班组与项目', async () => {
  const entries = Array.from({ length: 11 }, (_, index) => ({
    index,
    rowNumber: index + 2,
    row: { name: `合成人${index}`, crewName: '合成班组', projectName: '合成项目' },
    sameFileRows: [],
    preview: { fingerprint: 'a'.repeat(64), candidates: [{ id: `worker-${index}`, name: `合成人${index}`, version: '1', matchedBy: ['name'] as Array<'name'>, fields: { name: `合成人${index}`, crewName: '旧班组', projectName: null } }], crews: [{ id: 'crew-1', name: '合成班组', version: '1' }, { id: 'crew-2', name: '合成班组', version: '1' }], projects: [{ id: 'project-1', name: '合成项目', version: '1' }] },
  }))
  const result = render(WorkerExcelReview, { props: { entries, fields: [{ key: 'name', label: '姓名' }, { key: 'crewName', label: '所属班组' }, { key: 'projectName', label: '当前项目' }], choices: {}, relations: {}, locked: false } })
  await fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('旧班组')).toBeTruthy()
  await fireEvent.update(screen.getByLabelText('第 12 行处理方式'), 'replace:worker-10')
  await fireEvent.update(screen.getByLabelText('第 12 行所属班组'), 'crew-2')
  await fireEvent.update(screen.getByLabelText('第 12 行当前项目'), 'project-1')
  expect(result.emitted('choose')).toEqual([[10, 'replace:worker-10']])
  expect(result.emitted('relation')).toEqual([[10, 'crew', 'crew-2'], [10, 'project', 'project-1']])
})
