import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import QuantityAssignmentDialog from '~/components/quantity/QuantityAssignmentDialog.vue'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const load = vi.fn()
const state = reactive({ assignmentWorkspace: null as object | null, assignmentOrigin: 'real', assignmentCanWrite: true, assignmentSaving: false, assignmentLoading: false, assignmentError: '', loadAssignments: load })
beforeEach(() => {
  state.assignmentWorkspace = null
  state.assignmentOrigin = 'real'
  state.assignmentCanWrite = true
  load.mockReset().mockImplementation(async (projectId: string, origin: string) => {
    state.assignmentOrigin = origin
    state.assignmentCanWrite = origin === 'real'
    state.assignmentWorkspace = { projectId, matrixArchivedAt: null, units: [], trades: ['泥水工'], assignees: [], assignments: [], scopeOptions: [] }
  })
  for (const [key, value] of Object.entries({ computed, ref, shallowRef, watch, useQuantityStore: () => state, useKitUI: () => ({ confirm: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }))
    vi.stubGlobal(key, value)
})

it('已打开责任配置同项目切换来源重新读取并撤销正式写权限', async () => {
  const wrapper = mount(QuantityAssignmentDialog, { props: { projectId: 'p', origin: 'real', open: true }, global: { stubs: { FormDialog: { template: '<div><slot /></div>' }, SelectFilter: true, SegTab: true, QuantityAssignmentUnitPicker: true, QuantityAssignmentScopePicker: true } } })
  await flushPromises()
  expect(wrapper.get('[data-testid="quantity-assignment-fields"]').attributes('disabled')).toBeUndefined()
  await wrapper.setProps({ origin: 'demo' })
  await flushPromises()
  expect(load.mock.calls).toEqual([['p', 'real'], ['p', 'demo']])
  expect(wrapper.get('[data-testid="quantity-assignment-fields"]').attributes()).toHaveProperty('disabled')
})
