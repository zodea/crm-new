import type { ScheduleTaskView } from '~/lib/schedule/read-model'
import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, ref, shallowRef, watch } from 'vue'
import ScheduleTaskDialog from '~/components/schedule/ScheduleTaskDialog.vue'

const FormDialog = defineComponent({
  props: { open: Boolean },
  emits: ['save'],
  setup(props, { emit, slots }) {
    return () => props.open ? h('div', [slots.default?.(), h('button', { onClick: () => emit('save') }, '保存调整')]) : null
  },
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('仅改人工进度仍发送同一前置，依赖往返不重置未提交日期', async () => {
  for (const [key, value] of Object.entries({ computed, ref, shallowRef, watch }))
    vi.stubGlobal(key, value)
  const task = { id: 't', projectId: 'p', groupId: 'g', name: '现场交接', trade: '综合', durationDays: 2, plannedStart: '2026-09-02', plannedFinish: '2026-09-03', actualProgress: 0, manualProgress: 0, floorPlans: [], itemNames: [], hasQty: false } as unknown as ScheduleTaskView
  const props = { open: true, draftKey: 1, task, groupName: '一栋', predecessorTasks: [], dependency: { id: 'dep', predId: 'previous', succId: 't', lagDays: -1 } }
  const { emitted, rerender } = render(ScheduleTaskDialog, { props, global: { stubs: { FormDialog, Button: true } } })
  await fireEvent.update(screen.getByLabelText('计划完成'), '2026-09-06')
  await rerender({ ...props, open: false })
  await rerender(props)
  expect((screen.getByLabelText('计划完成') as HTMLInputElement).value).toBe('2026-09-06')
  await fireEvent.update(screen.getByLabelText('人工进度百分比'), '75')
  await fireEvent.click(screen.getByText('保存调整'))
  expect(emitted().save?.[0]).toEqual([{ task: { plannedStart: '2026-09-02', plannedFinish: '2026-09-06', manualProgress: 0.75 }, dependency: { predecessorId: 'previous', lagDays: -1 }, floorPlans: [] }])
})
