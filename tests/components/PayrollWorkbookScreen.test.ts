import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import PayrollWorkbookScreen from '~/components/payroll/PayrollWorkbookScreen.vue'

let ui: ReturnType<typeof fixture>
vi.mock('~/composables/usePayrollWorkbook', () => ({ usePayrollWorkbook: () => ui }))
function fixture() {
  const pending = ref<null | { projectId: string }>(null)
  return {
    projectId: ref('project-one'),
    mode: ref('leader-cycle'),
    subjectKey: ref('book-one'),
    rosterArchiveId: ref(''),
    list: ref({ projects: [{ id: 'project-one', name: '合成项目' }] }),
    subjects: ref([]),
    selected: ref([{}]),
    matchingRosters: ref([]),
    current: ref(null),
    opened: ref<null | { input: { mode: string }, rosterRef: object | null }>({ input: { mode: 'leader-cycle' }, rosterRef: {} }),
    versions: ref([]),
    busy: ref(false),
    error: ref(''),
    canSave: computed(() => !pending.value),
    privateReadable: ref(false),
    returnTo: ref('/subcontract/payroll'),
    rosterTo: ref('/base/worker/roster'),
    pending,
    load: vi.fn(),
    leave: vi.fn(),
    changeProject: vi.fn(),
    change: vi.fn(),
    buildPreview: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
    recover: vi.fn(),
    download: vi.fn(),
  }
}
const stubs = {
  EntityFormShell: { template: '<main><slot /><footer><slot name="footer" /></footer></main>' },
  KitButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
  PayrollWorkbookSelection: { props: ['disabled'], template: '<section data-testid="selection" :aria-disabled="disabled"><slot name="roster-link" /></section>' },
  PayrollWorkbookHistory: true,
  PayrollWorkbookPreview: true,
  NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}
beforeEach(() => {
  ui = fixture()
  vi.stubGlobal('useTabTitle', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it('已保存目录分开提供公开工资与需独立权限的私密包，不再沿用未定稿归档窗口', async () => {
  const wrapper = mount(PayrollWorkbookScreen, { global: { stubs } })
  expect(wrapper.text()).not.toContain('暂不分配')
  expect(wrapper.text()).not.toContain('下载工资、名册与照片 ZIP')
  await wrapper.findAll('button').find(button => button.text() === '下载工资 XLSX')!.trigger('click')
  expect(ui.download).toHaveBeenCalledWith('xlsx')
  ui.privateReadable.value = true
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === '下载工资、名册与照片 ZIP')!.trigger('click')
  expect(ui.download).toHaveBeenCalledWith('private-zip')
  ui.opened.value!.rosterRef = null
  await flushPromises()
  expect(wrapper.text()).not.toContain('下载工资、名册与照片 ZIP')
  wrapper.unmount()
})

it('保存结果未知时禁用范围和下载，仅提供原提交核对入口', async () => {
  ui.pending.value = { projectId: 'project-one' }
  const wrapper = mount(PayrollWorkbookScreen, { global: { stubs } })
  expect(wrapper.find('[data-testid="selection"]').attributes('aria-disabled')).toBe('true')
  const buttons = wrapper.findAll('button')
  expect(buttons.filter(button => !button.attributes('disabled') && !button.element.disabled).map(button => button.text())).toEqual(['核对原保存结果'])
  await buttons.find(button => button.text() === '核对原保存结果')!.trigger('click')
  expect(ui.recover).toHaveBeenCalledTimes(1)
  expect(ui.save).not.toHaveBeenCalled()
  expect(ui.download).not.toHaveBeenCalled()
  wrapper.unmount()
})
