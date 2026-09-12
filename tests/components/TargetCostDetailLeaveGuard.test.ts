import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import TargetCostDetailScreen from '~/components/target-cost/NativeTargetCostDetailScreen.vue'

const routerMocks = vi.hoisted(() => ({
  leaveGuard: undefined as undefined | (() => Promise<boolean>),
  updateGuard: undefined as undefined | (() => Promise<boolean>),
}))

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn((guard: () => Promise<boolean>) => {
    routerMocks.leaveGuard = guard
  }),
  onBeforeRouteUpdate: vi.fn((guard: () => Promise<boolean>) => {
    routerMocks.updateGuard = guard
  }),
}))

const route = {
  params: { id: 'target-1' },
}
const confirm = vi.fn()
const saveItems = vi.fn()
const notifyError = vi.fn()
const current = shallowRef({
  header: {
    id: 'target-1',
    projectId: 'project-1',
    projectCode: 'P-01',
    projectName: '测试项目',
    name: '开工基线',
    isBaseline: true,
    contractRevenue: 5000,
    plannedProfit: 1000,
    signedContractSum: 200,
    taxInclusiveTotal: 4000,
    taxExclusiveTotal: 3600,
    taxAmount: 400,
    status: 'draft' as const,
    note: '',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
  },
  items: [{
    id: 'item-1',
    category: '材料' as const,
    itemName: 'BV 电线',
    unit: 'm',
    qty: 100,
    unitPrice: 2.5,
    amount: 250,
    note: '',
    sortOrder: 0,
  }],
  categories: [],
  summary: {
    itemTotal: 250,
    signedAmount: 0,
    settledAmount: 0,
    paidAmount: 0,
    remainingAmount: 250,
  },
})
const loadedId = shallowRef('target-1')
const loading = shallowRef(false)
const error = shallowRef('')
const savingItems = shallowRef(false)

const EntityDetailShell = defineComponent({
  setup(_props, { slots }) {
    return () => h('main', [
      slots.actions?.(),
      slots.default?.(),
    ])
  },
})
const KitButton = defineComponent({
  emits: ['click'],
  setup(_, { emit, slots }) {
    return () => h('button', {
      type: 'button',
      onClick: () => emit('click'),
    }, slots.default?.())
  },
})
const SegTab = defineComponent({
  template: '<nav />',
})
const TargetCostItemTable = defineComponent({
  emits: ['edit'],
  setup(_, { emit }) {
    return () => h('button', {
      type: 'button',
      onClick: () => emit('edit'),
    }, '编辑科目')
  },
})
let validationCalls = 0
const TargetCostItemEditor = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue', 'save', 'cancel'],
  setup(props, { emit, expose }) {
    expose({
      validate: async () => {
        validationCalls += 1
        return []
      },
    })
    return () => h('section', [
      h('button', {
        type: 'button',
        onClick: () => emit('update:modelValue', [{
          ...props.modelValue[0],
          amount: 300,
        }]),
      }, '修改草稿'),
      h('button', {
        type: 'button',
        onClick: () => emit('save'),
      }, '保存草稿'),
    ])
  },
})
const EmptyStub = defineComponent({ setup: () => () => h('div') })

const globalComponents: Record<string, Component> = {
  EntityDetailShell,
  KitButton,
  SegTab,
  TargetCostItemTable,
  TargetCostItemEditor,
  TargetCostDetailSummary: EmptyStub,
  TargetCostComparisonTable: EmptyStub,
}

describe('目标成本科目草稿离开保护', () => {
  beforeEach(() => {
    routerMocks.leaveGuard = undefined
    routerMocks.updateGuard = undefined
    confirm.mockReset()
    saveItems.mockReset()
    notifyError.mockReset()
    validationCalls = 0
    current.value!.items[0]!.amount = 250
    saveItems.mockResolvedValue(undefined)

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useTargetCostDetailStore', () => ({
      load: vi.fn().mockResolvedValue(undefined),
      saveItems,
    }))
    vi.stubGlobal('storeToRefs', () => ({
      current,
      loadedId,
      loading,
      error,
      savingItems,
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning: vi.fn(),
      error: notifyError,
    }))
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useEventListener', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())
  })

  it('路由离开统一确认，拒绝时保留草稿，接受时才放弃', async () => {
    const wrapper = mount(TargetCostDetailScreen, {
      global: { components: globalComponents },
    })
    await wrapper.findAll('button').find(button => button.text() === '编辑科目')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '修改草稿')!.trigger('click')

    confirm.mockResolvedValueOnce(false)
    expect(await routerMocks.leaveGuard?.()).toBe(false)
    expect(wrapper.text()).toContain('保存草稿')

    confirm.mockResolvedValueOnce(true)
    expect(await routerMocks.leaveGuard?.()).toBe(true)
    expect(wrapper.text()).not.toContain('保存草稿')
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('离开后修改将丢失'),
    }))
    expect(routerMocks.updateGuard).toBeTypeOf('function')
  })

  it('保存成功解除离开保护，保存失败仍保留草稿并重新定位校验', async () => {
    const wrapper = mount(TargetCostDetailScreen, {
      global: { components: globalComponents },
    })
    const buttons = () => wrapper.findAll('button')
    await buttons().find(button => button.text() === '编辑科目')!.trigger('click')
    await buttons().find(button => button.text() === '修改草稿')!.trigger('click')

    saveItems.mockRejectedValueOnce(new Error('保存失败'))
    await buttons().find(button => button.text() === '保存草稿')!.trigger('click')
    await Promise.resolve()
    expect(wrapper.text()).toContain('保存草稿')
    expect(validationCalls).toBe(2)
    expect(notifyError).toHaveBeenCalled()

    await buttons().find(button => button.text() === '保存草稿')!.trigger('click')
    await Promise.resolve()
    expect(await routerMocks.leaveGuard?.()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })
})
