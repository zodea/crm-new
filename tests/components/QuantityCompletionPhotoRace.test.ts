import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import QuantityCompletionDialog from '~/components/quantity/QuantityCompletionDialog.vue'

const picker = vi.hoisted(() => ({ change: undefined as undefined | ((files: FileList) => Promise<void>), read: vi.fn() }))
vi.mock('@vueuse/core', async original => ({
  ...await original<typeof import('@vueuse/core')>(),
  useBase64: (file: File) => ({ promise: { value: picker.read(file) } }),
  useFileDialog: () => ({ open: vi.fn(), reset: vi.fn(), onChange: (callback: (files: FileList) => Promise<void>) => picker.change = callback }),
}))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))

beforeEach(() => {
  picker.read.mockReset()
  const state = reactive({
    completionOrigin: 'real',
    completionCanWrite: true,
    completionSaving: false,
    completionLoading: false,
    completionError: '',
    loadCompletion: vi.fn(),
    completionWorkspace: { projectId: 'p', matrixArchivedAt: null, unit: { id: 'u', name: '101户', buildingName: '1栋', floorName: '1层' }, planWindow: null, stages: ['A', 'B'].map(id => ({ id, name: `${id}阶段`, trade: '泥水工', currentAssignment: { id: 'assignment', assigneeName: '当前班组', available: true }, completion: null, photos: [], warnings: [], quantities: [] })) },
  })
  for (const [key, value] of Object.entries({ computed, ref, shallowRef, watch, useQuantityStore: () => state, useKitUI: () => ({ confirm: vi.fn().mockResolvedValue(true), error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }))
    vi.stubGlobal(key, value)
})

it('照片仍在读取时切换阶段，旧文件迟到不会加入新阶段草稿', async () => {
  let complete!: (data: string) => void
  picker.read.mockReturnValue(new Promise<string>(resolve => complete = resolve))
  const wrapper = mount(QuantityCompletionDialog, { props: { projectId: 'p', unitId: 'u', origin: 'real', open: true }, global: { stubs: { FormDialog: { template: '<div><slot /></div>' }, SegTab: true } } })
  await flushPromises()
  const reading = picker.change!([new File(['photo'], 'A阶段照片.png', { type: 'image/png' })] as unknown as FileList)
  await wrapper.findAll('button').find(button => button.text().includes('B阶段'))!.trigger('click')
  await flushPromises()
  complete('data:image/png;base64,cGhvdG8=')
  await reading
  await flushPromises()
  expect(wrapper.text()).not.toContain('A阶段照片.png')
})
