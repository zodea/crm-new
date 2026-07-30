import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import SignedDayworkEntryForm from '~/components/payroll/SignedDayworkEntryForm.vue'
import SignedDayworkTable from '~/components/payroll/SignedDayworkTable.vue'

const workers = [
  { id: 'worker-a', name: '张师傅', crewId: 'crew-a' },
  { id: 'worker-b', name: '李师傅', crewId: 'crew-b' },
]

describe('signed daywork components', () => {
  it('emits a confirmed whole/half work record with proof fields', async () => {
    const { emitted } = render(SignedDayworkEntryForm, {
      props: {
        projectId: 'project-a',
        crewId: 'crew-a',
        month: '2026-07',
        workers,
      },
    })
    await fireEvent.update(screen.getByLabelText('日期'), '2026-07-10')
    await fireEvent.update(screen.getByLabelText('施工内容'), '地下室材料转运')
    await fireEvent.update(screen.getByLabelText('用工数'), '0.5')
    await fireEvent.update(screen.getByLabelText('证明人'), '王工')
    await fireEvent.update(screen.getByLabelText('确认日期'), '2026-07-11')
    await fireEvent.click(screen.getByRole('button', { name: '保存签工' }))

    expect(emitted().save?.[0]?.[0]).toMatchObject({
      projectId: 'project-a',
      crewId: 'crew-a',
      workerId: 'worker-a',
      workDate: '2026-07-10',
      workContent: '地下室材料转运',
      laborUnits: 0.5,
      witness: '王工',
      confirmedOn: '2026-07-11',
      status: 'confirmed',
    })
  })

  it('renders long records inside a local horizontal-scroll table', async () => {
    const { container, emitted } = render(SignedDayworkTable, {
      props: {
        loading: false,
        records: [{
          id: 'record-a',
          projectId: 'project-a',
          projectName: '项目甲',
          crewId: 'crew-a',
          crewName: '泥水班',
          workerId: 'worker-a',
          workerName: '张师傅',
          workDate: '2026-07-10',
          workContent: '地下室积水清理、材料转运及成品保护',
          startTime: '08:00',
          endTime: '18:00',
          laborUnits: 1,
          witness: '王工',
          confirmedOn: '2026-07-11',
          status: 'confirmed',
          note: '',
          updatedAt: '2026-07-11',
        }],
      },
    })
    expect(screen.getByText('地下室积水清理、材料转运及成品保护')).not.toBeNull()
    expect(container.querySelector('.daywork-table')?.getAttribute('tabindex')).toBe('0')
    expect(container.querySelector('.daywork-table > table')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '编辑签工记录' }))
    expect(emitted().edit?.[0]?.[0]).toMatchObject({ id: 'record-a' })
  })

  it('edits a pending record and preserves its id when confirming', async () => {
    const record = {
      id: 'record-draft',
      projectId: 'project-a',
      projectName: '项目甲',
      crewId: 'crew-a',
      crewName: '泥水班',
      workerId: 'worker-a',
      workerName: '张师傅',
      workDate: '2026-07-10',
      workContent: '待确认搬运',
      startTime: '08:00',
      endTime: '12:00',
      laborUnits: 0.5 as const,
      witness: '',
      confirmedOn: null,
      status: 'draft' as const,
      note: '',
      updatedAt: '2026-07-10',
    }
    const { emitted } = render(SignedDayworkEntryForm, {
      props: {
        projectId: 'project-a',
        crewId: 'crew-a',
        month: '2026-07',
        workers,
        record,
      },
    })
    await fireEvent.update(screen.getByLabelText('状态'), 'confirmed')
    await fireEvent.update(screen.getByLabelText('证明人'), '王工')
    await fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(emitted().save?.[0]?.[0]).toMatchObject({
      id: 'record-draft',
      status: 'confirmed',
      witness: '王工',
    })
  })
})
