import type { OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  onActivated,
  onMounted,
  shallowRef,
  watch,
} from 'vue'
import OwnerDocumentListScreen from '~/components/owner-document/OwnerDocumentListScreen.vue'

const listRows: OwnerDocumentListRecord[] = [
  {
    id: 'change-1',
    no: 'BQ-001',
    name: '地下室签证',
    projectId: 'project-1',
    projectName: '合和新城',
    contractId: 'contract-1',
    contractName: '合和新城施工合同',
    supplierId: null,
    supplierName: '',
    crewId: null,
    crewName: '',
    type: 'site_visa',
    period: '',
    amount: 120,
    secondaryAmount: 110,
    tertiaryAmount: 108,
    quantity: null,
    date: '2026-07-30',
    status: 'approved',
  },
]

const ToolbarStub = defineComponent({
  props: ['title', 'project', 'type', 'view', 'projectOptions', 'typeOptions', 'views'],
  emits: ['update:project', 'update:type', 'update:view', 'create', 'refresh'],
  setup(props, { emit }) {
    const select = (label: string, value: unknown, options: any[], event: string) =>
      h('select', {
        'aria-label': label,
        'value': value,
        'onChange': (input: Event) =>
          emit(event, (input.target as HTMLSelectElement).value),
      }, options.map(option => h('option', { value: option.key }, option.label)))
    return () => h('section', { 'data-ui': 'owner-document-list-toolbar' }, [
      h('h1', props.title),
      select('项目', props.project, props.projectOptions, 'update:project'),
      select('类型', props.type, props.typeOptions, 'update:type'),
      select('状态', props.view, props.views, 'update:view'),
    ])
  },
})

const KitTableStub = defineComponent({
  inheritAttrs: false,
  props: ['columns', 'data', 'empty', 'page'],
  emits: ['emptyAction'],
  setup(props, { attrs, emit }) {
    return () => h('section', {
      ...attrs,
      'aria-label': '业务单据宽表',
      'data-min-width': (props.columns as any[]).reduce(
        (sum, column) => sum + (column.width ?? column.minWidth ?? 0),
        0,
      ),
    }, [
      h('div', { role: 'row' }, (props.columns as any[]).map(column =>
        h('span', { role: 'columnheader' }, column.title))),
      ...(props.data as any[]).map(row => h('div', { role: 'row' }, `${row.no} ${row.name}`)),
      ...(props.data as any[]).length === 0
        ? [h('div', { 'role': 'status', 'aria-label': props.empty.title }, [
            props.empty.title,
            h('button', { onClick: () => emit('emptyAction') }, props.empty.actionLabel),
          ])]
        : [],
    ])
  },
})

const route = {
  path: '/owner/change',
  query: { project: 'project-1' } as Record<string, string>,
}
const navigateTo = vi.fn()
const loadKind = vi.fn(async () => listRows)

const global = {
  components: {
    EntityLink: defineComponent({ props: ['label'], template: '<span>{{ label }}</span>' }),
    KitTable: KitTableStub,
    NuxtLink: defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' }),
    OwnerDocumentListToolbar: ToolbarStub,
    RowActionMenu: true,
    StatePanel: defineComponent({
      props: ['title', 'actionLabel'],
      emits: ['action'],
      template: '<div role="alert">{{ title }}<button @click="$emit(\'action\')">{{ actionLabel }}</button></div>',
    }),
  },
}

describe('owner document list screen', () => {
  beforeEach(() => {
    navigateTo.mockReset()
    loadKind.mockClear()
    route.query = { project: 'project-1' }
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('onActivated', onActivated)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      undoToast: vi.fn(),
      error: vi.fn(),
    }))
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      recordsFor: () => listRows,
      listLoadingFor: () => false,
      listError: () => '',
      loadKind,
      removeForm: vi.fn(),
      restoreForm: vi.fn(),
    }))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('watch', watch)
  })

  it('呈现类型化列、具名筛选、来源范围与可局部横滚的宽表', () => {
    render(OwnerDocumentListScreen, {
      props: { kind: 'owner_change' },
      global,
    })

    expect(document.querySelector('[data-ui="owner-document-list-toolbar"]')).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '项目' })).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '类型' })).not.toBeNull()
    expect(screen.getByRole('combobox', { name: '状态' })).not.toBeNull()
    expect(document.querySelector('[data-ui="owner-document-route-context"]')?.textContent)
      .toContain('项目：合和新城')

    const table = screen.getByRole('region', { name: '业务单据宽表' })
    const headings = within(table).getAllByRole('columnheader').map(item => item.textContent)
    expect(headings).toEqual(expect.arrayContaining([
      '变更编号',
      '施工合同',
      '含税审定金额',
      '无税审定金额',
      '无税申报金额',
    ]))
    expect(Number(table.getAttribute('data-min-width'))).toBeGreaterThan(1200)
  })

  it('筛选无结果显示业务空态并可清除筛选', async () => {
    render(OwnerDocumentListScreen, {
      props: { kind: 'owner_change' },
      global,
    })

    await fireEvent.update(screen.getByRole('combobox', { name: '状态' }), 'submitted')
    expect(screen.getByRole('status', { name: '没有符合条件的甲方变洽签' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect((screen.getByRole('combobox', { name: '状态' }) as HTMLSelectElement).value)
      .toBe('approved')
  })
})
