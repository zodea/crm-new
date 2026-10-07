import type { LookupOption } from '~/lib/kit/lookup'
import type { ScheduleContractBindingPreview } from '~/lib/schedule/contract-binding'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import ScheduleContractBindingScreen from '~/components/schedule/ScheduleContractBindingScreen.vue'

const isDesktopRuntime = vi.hoisted(() => vi.fn())
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime }))

const LookupSelectStub = defineComponent({
  props: {
    modelValue: {
      type: String,
      default: null,
    },
    fetch: {
      type: Function,
      required: true,
    },
    placeholder: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const options = shallowRef<LookupOption[]>([])
    return () => h('div', [
      h('input', {
        'aria-label': props.placeholder,
        'onInput': async (event: Event) => {
          options.value = await (props.fetch as (keyword: string) => Promise<LookupOption[]>)(
            (event.target as HTMLInputElement).value,
          )
        },
      }),
      ...options.value.map(option => h('button', {
        key: option.id,
        type: 'button',
        onClick: () => emit('update:modelValue', option.id),
      }, `${option.label} ${option.hint ?? ''}`)),
    ])
  },
})

const ReviewStub = defineComponent({
  props: {
    preview: {
      type: Object,
      required: true,
    },
    busy: Boolean,
  },
  emits: ['bind'],
  setup(props, { emit }) {
    return () => h('section', [
      h('p', (props.preview as ScheduleContractBindingPreview).contractName),
      h('button', {
        type: 'button',
        disabled: props.busy,
        onClick: () => emit('bind'),
      }, '确认绑定合同'),
    ])
  },
})

const preview: ScheduleContractBindingPreview = {
  groupId: 'group-1',
  groupName: '前期1-2栋',
  projectId: 'project-1',
  contractId: 'contract-1',
  contractNo: 'SG-001',
  contractName: '施工总承包合同',
  buildings: [],
  extraContractBuildings: [],
  items: [],
  blockers: [],
  warnings: ['合同还包含分组外楼栋：3栋'],
  canBind: true,
}

const push = vi.fn()
const confirm = vi.fn()
const success = vi.fn()
const toastError = vi.fn()
const store = {
  snapshot: {
    id: 'project-1',
    groups: [{
      id: 'group-1',
      name: '前期1-2栋',
      scopeBasis: 'provisional',
    }],
  },
  contracts: [{
    id: 'contract-1',
    projectId: 'project-1',
    no: 'SG-001',
    name: '施工总承包合同',
    lineCount: 12,
  }, {
    id: 'contract-2',
    projectId: 'project-1',
    no: 'SG-002',
    name: '机电施工合同',
    lineCount: 8,
  }],
  saving: false,
  loadProject: vi.fn(),
  loadContracts: vi.fn(),
  previewContractBinding: vi.fn(),
  bindContract: vi.fn(),
  readBinding: vi.fn(),
  cancelBindingRead: vi.fn(),
}

describe('scheduleContractBindingScreen', () => {
  beforeEach(() => {
    isDesktopRuntime.mockReset().mockReturnValue(true)
    push.mockReset()
    confirm.mockReset().mockResolvedValue(true)
    success.mockReset()
    toastError.mockReset()
    store.loadProject.mockReset().mockResolvedValue(undefined)
    store.loadContracts.mockReset().mockResolvedValue(undefined)
    store.previewContractBinding.mockReset().mockResolvedValue(preview)
    store.bindContract.mockReset().mockResolvedValue({ preview, logId: 'log-1' })
    store.readBinding.mockReset().mockRejectedValue(new Error('当前身份无法读取中央绑定资料'))
    vi.stubGlobal('useRouter', () => ({ push }))
    vi.stubGlobal('useScheduleStore', () => store)
    vi.stubGlobal('useState', (_key: string, init: () => Record<string, string>) => shallowRef(init()))
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      error: toastError,
      success,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('桌面旧适配只检索当前项目施工合同，预览后确认绑定并返回原分组', async () => {
    render(ScheduleContractBindingScreen, {
      props: {
        projectId: 'project-1',
        groupId: 'group-1',
      },
      global: {
        components: {
          LookupSelect: LookupSelectStub,
          ScheduleContractBindingReview: ReviewStub,
        },
      },
    })

    await waitFor(() => expect(store.loadProject).toHaveBeenCalledWith('project-1'))
    expect(store.loadContracts).toHaveBeenCalledWith('project-1')

    const search = await screen.findByRole('textbox', { name: '搜索合同名称或编号' })
    await fireEvent.update(search, 'SG-001')
    expect(screen.getByRole('button', { name: /施工总承包合同 SG-001/ })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /机电施工合同/ })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: /施工总承包合同 SG-001/ }))
    await waitFor(() =>
      expect(store.previewContractBinding).toHaveBeenCalledWith('group-1', 'contract-1'),
    )
    expect(screen.getByText('施工总承包合同')).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '确认绑定合同' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '绑定施工合同「施工总承包合同」？',
      confirmLabel: '确认绑定',
    })))
    expect(store.bindContract).toHaveBeenCalledWith('group-1', 'contract-1')
    expect(success).toHaveBeenCalledWith('施工合同已绑定')
    expect(push).toHaveBeenCalledWith({
      path: '/schedule/project-1',
      query: { group: 'group-1' },
    })
  })

  it('桌面旧适配单份合同预览失败时保留检索入口供重新选择', async () => {
    store.previewContractBinding.mockRejectedValueOnce(new Error('合同清单尚未拆表'))
    render(ScheduleContractBindingScreen, {
      props: {
        projectId: 'project-1',
        groupId: 'group-1',
      },
      global: {
        components: {
          LookupSelect: LookupSelectStub,
          ScheduleContractBindingReview: ReviewStub,
        },
      },
    })

    const search = await screen.findByRole('textbox', { name: '搜索合同名称或编号' })
    await fireEvent.update(search, 'SG-001')
    await fireEvent.click(screen.getByRole('button', { name: /施工总承包合同 SG-001/ }))

    expect((await screen.findByRole('alert')).textContent).toContain('合同清单尚未拆表')
    expect(screen.getByRole('textbox', { name: '搜索合同名称或编号' })).not.toBeNull()
  })

  it('浏览器中央绑定读取失败时明确报错，不回退读取或调用本地绑定', async () => {
    isDesktopRuntime.mockReturnValue(false)
    vi.stubGlobal('useRoute', () => ({ fullPath: '/schedule/project-1/bind/group-1?origin=real', query: { origin: 'real' } }))
    vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {}, close: vi.fn() }))
    render(ScheduleContractBindingScreen, {
      props: { projectId: 'project-1', groupId: 'group-1' },
      global: { components: { LookupSelect: LookupSelectStub, ScheduleContractBindingReview: ReviewStub } },
    })

    expect((await screen.findByRole('alert')).textContent).toContain('当前身份无法读取中央绑定资料')
    expect(store.readBinding).toHaveBeenCalledExactlyOnceWith('project-1', 'group-1', '', 'real')
    expect(screen.queryByRole('textbox', { name: '搜索合同名称或编号' })).toBeNull()
    expect(screen.queryByRole('button', { name: '确认绑定合同' })).toBeNull()
    expect(store.loadProject).not.toHaveBeenCalled()
    expect(store.loadContracts).not.toHaveBeenCalled()
    expect(store.previewContractBinding).not.toHaveBeenCalled()
    expect(store.bindContract).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    await fireEvent.click(screen.getAllByRole('button', { name: '返回施工进度' })[0]!)
    expect(push).toHaveBeenCalledWith({ path: '/schedule', query: { project: 'project-1', group: 'group-1', origin: 'real' } })
  })
})
