import type { ScheduleTaskView } from '~/lib/schedule/read-model'
import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  nextTick,
  shallowRef,
  watch,
} from 'vue'
import ScheduleDependencyDialog from '~/components/schedule/ScheduleDependencyDialog.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('nextTick', nextTick)
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('watch', watch)

function task(input: Partial<ScheduleTaskView> & Pick<ScheduleTaskView, 'id' | 'name' | 'plannedStart' | 'plannedFinish' | 'sortOrder'>): ScheduleTaskView {
  return {
    projectId: 'project-1',
    groupId: 'group-1',
    parentId: null,
    trade: '泥水工',
    color: '#7c5ce7',
    durationDays: 5,
    baselineStart: null,
    baselineFinish: null,
    hasQty: false,
    manualProgress: 0,
    stageId: null,
    itemIds: [],
    itemNames: [],
    boqLineIds: [],
    floorPlans: [],
    applicableUnits: null,
    completedUnits: null,
    actualProgress: 0,
    actualStart: null,
    actualFinish: null,
    plannedProgress: 0,
    deviationDays: 0,
    sourceLibraryTaskId: null,
    sourceLibraryVersion: null,
    ...input,
  }
}

const current = task({
  id: 'current',
  name: '卫生间回填及防水',
  plannedStart: '2026-07-10',
  plannedFinish: '2026-07-15',
  sortOrder: 2,
})
const earlier = task({
  id: 'earlier',
  name: '给排水安装',
  plannedStart: '2026-07-01',
  plannedFinish: '2026-07-09',
  sortOrder: 1,
})
const later = task({
  id: 'later',
  name: '墙砖粘贴',
  plannedStart: '2026-07-12',
  plannedFinish: '2026-07-20',
  sortOrder: 3,
})

const DialogStub = defineComponent({
  props: { open: Boolean },
  setup(props, { slots }) {
    return () => props.open ? h('div', slots.default?.()) : null
  },
})
const DialogContentStub = defineComponent({
  emits: ['escapeKeyDown'],
  setup(_, { emit, slots }) {
    return () => h('div', {
      role: 'dialog',
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape')
          emit('escapeKeyDown', event)
      },
    }, slots.default?.())
  },
})
const DialogTitleStub = defineComponent({
  setup(_, { slots }) {
    return () => h('h2', slots.default?.())
  },
})
const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { disabled: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: props.disabled,
      onClick: () => emit('click'),
    }, slots.default?.())
  },
})
const SelectFilterStub = defineComponent({
  props: {
    modelValue: String,
    options: { type: Array, default: () => [] },
    ariaLabel: String,
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('select', {
      'aria-label': props.ariaLabel,
      'value': props.modelValue,
      'onChange': (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value),
    }, (props.options as { key: string, label: string }[]).map(option =>
      h('option', { value: option.key }, option.label),
    ))
  },
})

const global = {
  components: {
    Button: ButtonStub,
    Dialog: DialogStub,
    DialogContent: DialogContentStub,
    DialogTitle: DialogTitleStub,
    SelectFilter: SelectFilterStub,
  },
}

describe('schedule dependency dialog', () => {
  it('只列同组较早工序，并实时展示最早日期与冲突天数', async () => {
    const result = render(ScheduleDependencyDialog, {
      props: {
        open: true,
        task: current,
        groupName: '户内1栋-2栋',
        groupTasks: [earlier, current, later],
        dependencies: [],
        dependency: null,
        disabledDependencies: [],
      },
      global,
    })

    const predecessorSelect = screen.getByRole('combobox', { name: '前置工序' })
    expect(predecessorSelect.textContent).toContain('给排水安装')
    expect(predecessorSelect.textContent).not.toContain('墙砖粘贴')
    await fireEvent.update(screen.getByRole('spinbutton', { name: 'Lag 天数' }), '2')
    expect(screen.getByText('2026-07-11', { exact: true })).not.toBeNull()
    expect(screen.getByText(/当前计划提前了 1 天/)).not.toBeNull()
    expect(screen.getByText('给排水安装完成后等待 2 天，卫生间回填及防水开始')).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '保存依赖' }))
    expect(result.emitted().save?.[0]).toEqual([{ predecessorId: 'earlier', lagDays: 2 }])
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(result.emitted().requestClose).toEqual([[true]])
  })

  it('循环关系会显示原因并禁用保存', () => {
    render(ScheduleDependencyDialog, {
      props: {
        open: true,
        task: current,
        groupName: '户内1栋-2栋',
        groupTasks: [earlier, current],
        dependencies: [{
          id: 'reverse',
          predId: current.id,
          succId: earlier.id,
          dependencyType: 'FS',
          lagDays: 0,
        }],
        dependency: null,
        disabledDependencies: [],
      },
      global,
    })

    expect(screen.getByText(/形成循环依赖/)).not.toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存依赖' }).disabled).toBe(true)
  })

  it('未修改可直接请求关闭，修改后会标记脏状态交给页面确认', async () => {
    const result = render(ScheduleDependencyDialog, {
      props: {
        open: true,
        task: current,
        groupName: '户内1栋-2栋',
        groupTasks: [earlier, current],
        dependencies: [],
        dependency: null,
        disabledDependencies: [],
      },
      global,
    })

    await fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(result.emitted().requestClose).toEqual([[false]])
    await fireEvent.update(screen.getByRole('spinbutton', { name: 'Lag 天数' }), '3')
    await fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(result.emitted().requestClose?.at(-1)).toEqual([true])
    expect(screen.getByText('楼栋分组：户内1栋-2栋')).not.toBeNull()
    expect(screen.getByText('完成 → 开始（FS）')).not.toBeNull()
  })
})
