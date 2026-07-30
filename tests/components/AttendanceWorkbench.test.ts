import type { Component } from 'vue'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import AttendanceGrid from '~/components/payroll/AttendanceGrid.vue'
import AttendanceScreen from '~/components/payroll/AttendanceScreen.vue'
import AttendanceSummary from '~/components/payroll/AttendanceSummary.vue'

const workers = [
  { id: 'worker-a', name: '张师傅', crewId: 'crew-a' },
  { id: 'worker-b', name: '李师傅', crewId: 'crew-a' },
]

const records = [
  {
    id: 'attendance-a',
    projectId: 'project-a',
    crewId: 'crew-a',
    workerId: 'worker-a',
    workerName: '张师傅',
    workDate: '2026-07-02',
    hours: 8,
    overtimeHours: 2,
    workContent: '墙砖铺贴',
    note: '',
  },
]

const SectionHeaderStub = defineComponent({
  props: {
    title: String,
    subtitle: String,
  },
  setup(props) {
    return () => h('header', [
      h('h2', props.title),
      h('p', props.subtitle),
    ])
  },
})

describe('attendance workbench components', () => {
  it('summarizes persisted attendance facts without invented progress', () => {
    render(AttendanceSummary, {
      props: {
        workerCount: 2,
        records,
        blockedWorkerCount: 1,
      },
    })

    const summary = screen.getByRole('region', { name: '考勤事实汇总' })
    expect(within(summary).getByText('当前名册').closest('article')?.textContent).toContain('2人')
    expect(within(summary).getByText('正常工时').closest('article')?.textContent).toContain('8小时')
    expect(within(summary).getByText('已有考勤')).not.toBeNull()
    expect(within(summary).getByText('1 人已有记录')).not.toBeNull()
    expect(within(summary).getByText('C2 签工或 C1 已发放')).not.toBeNull()
  })

  it('focuses the cell editor, preserves values on service error, and blocks duplicate save', async () => {
    const view = render(AttendanceGrid, {
      props: {
        projectId: 'project-a',
        crewId: 'crew-a',
        month: '2026-07',
        workers,
        records,
        blockedWorkerIds: ['worker-b'],
        saving: false,
        saveError: '',
      },
      global: {
        components: { SectionHeader: SectionHeaderStub },
      },
    })

    const lockedCell = screen.getByRole<HTMLButtonElement>('button', {
      name: '李师傅 2026-07-02 考勤',
    })
    expect(lockedCell.disabled).toBe(true)

    await fireEvent.click(screen.getByRole('button', {
      name: '张师傅 2026-07-02 考勤',
    }))
    await nextTick()

    const normalHours = screen.getByRole<HTMLInputElement>('spinbutton', { name: '正常工时' })
    const overtimeHours = screen.getByRole<HTMLInputElement>('spinbutton', { name: '加班工时' })
    const content = screen.getByRole<HTMLInputElement>('textbox', { name: '施工内容' })
    expect(document.activeElement).toBe(normalHours)
    expect(normalHours.value).toBe('8')
    expect(overtimeHours.value).toBe('2')
    expect(content.value).toBe('墙砖铺贴')

    await fireEvent.update(normalHours, '20')
    await fireEvent.update(overtimeHours, '8')
    await fireEvent.update(content, '错误提交后仍保留')
    await fireEvent.submit(screen.getByRole('form', { name: '考勤单元格编辑' }))

    expect(view.emitted().save?.[0]?.[0]).toEqual({
      projectId: 'project-a',
      crewId: 'crew-a',
      workerId: 'worker-a',
      workDate: '2026-07-02',
      hours: 20,
      overtimeHours: 8,
      workContent: '错误提交后仍保留',
    })

    await view.rerender({
      projectId: 'project-a',
      crewId: 'crew-a',
      month: '2026-07',
      workers,
      records,
      blockedWorkerIds: ['worker-b'],
      saving: false,
      saveError: '正常工时与加班工时合计不能超过 24 小时',
    })
    expect(screen.getByRole('alert').textContent).toContain('当前填写内容已保留')
    expect(normalHours.value).toBe('20')
    expect(overtimeHours.value).toBe('8')
    expect(content.value).toBe('错误提交后仍保留')

    await view.rerender({
      projectId: 'project-a',
      crewId: 'crew-a',
      month: '2026-07',
      workers,
      records,
      blockedWorkerIds: ['worker-b'],
      saving: true,
      saveError: '',
    })
    const savingButton = screen.getByRole<HTMLButtonElement>('button', { name: '正在保存' })
    expect(savingButton.disabled).toBe(true)
    await fireEvent.click(savingButton)
    expect(view.emitted().save).toHaveLength(1)

    await view.rerender({
      projectId: 'project-a',
      crewId: 'crew-a',
      month: '2026-07',
      workers,
      records,
      blockedWorkerIds: [],
      loading: true,
      saving: false,
      saveError: '',
    })
    expect(screen.getByRole<HTMLButtonElement>('button', {
      name: '张师傅 2026-07-02 考勤',
    }).disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '正常工时' }).disabled).toBe(true)
    await fireEvent.submit(screen.getByRole('form', { name: '考勤单元格编辑' }))
    expect(view.emitted().save).toHaveLength(1)

    await view.rerender({
      projectId: 'project-a',
      crewId: 'crew-a',
      month: '2026-08',
      workers,
      records,
      blockedWorkerIds: [],
      loading: false,
      saving: false,
      saveError: '',
    })
    expect(screen.queryByRole('form', { name: '考勤单元格编辑' })).toBeNull()
  })
})

const NuxtLinkStub = defineComponent({
  props: { to: [String, Object] },
  setup(props, { slots }) {
    return () => {
      if (typeof props.to === 'string')
        return h('a', { href: props.to }, slots.default?.())
      const location = props.to as { path?: string, query?: Record<string, string> }
      const query = new URLSearchParams(location.query ?? {}).toString()
      return h('a', {
        href: `${location.path ?? ''}${query ? `?${query}` : ''}`,
      }, slots.default?.())
    }
  },
})

const KitButtonStub = defineComponent({
  props: {
    loading: Boolean,
    disabled: Boolean,
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () => h('button', {
      disabled: props.disabled,
      onClick: () => emit('click'),
    }, slots.default?.())
  },
})

const StatePanelStub = defineComponent({
  props: {
    title: String,
    description: String,
  },
  setup(props, { slots }) {
    return () => h('section', [
      h('h2', props.title),
      h('p', props.description),
      slots.action?.(),
    ])
  },
})

const passthroughStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

const screenComponents: Record<string, Component> = {
  NuxtLink: NuxtLinkStub,
  KitButton: KitButtonStub,
  StatePanel: StatePanelStub,
  AttendanceSummary: passthroughStub,
  AttendanceGrid: passthroughStub,
}

function createScreenStore(options: {
  projects?: typeof workers
  workers?: typeof workers
  crews?: typeof workers
} = {}) {
  return {
    options: {
      projects: options.projects ?? [],
      crews: options.crews ?? [],
      workers: options.workers ?? [],
      c2SubjectConfigs: [],
    },
    filters: reactive({
      projectId: options.projects?.[0]?.id ?? '',
      crewId: '',
      month: '2026-07',
    }),
    records: [],
    blockedWorkerIds: [],
    loading: false,
    saving: false,
    error: '',
    load: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(false),
  }
}

describe('attendance screen truth-first states', () => {
  it('shows the real no-project state instead of an empty matrix', async () => {
    const store = createScreenStore()
    vi.stubGlobal('useAttendanceStore', () => store)
    vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn() }))
    vi.stubGlobal('useRoute', () => ({ query: {} }))

    render(AttendanceScreen, {
      global: { components: screenComponents },
    })

    expect(await screen.findByRole('heading', { name: '暂无可用项目' })).not.toBeNull()
    expect(screen.getByRole('link', { name: '前往项目列表' })).not.toBeNull()
    expect(store.load).toHaveBeenCalledWith({ clearFacts: true })
  })

  it('shows the scoped no-worker state and explains that roster ownership is not fabricated', async () => {
    const store = createScreenStore({
      projects: [{ id: 'project-a', name: '项目甲', crewId: null }],
    })
    vi.stubGlobal('useAttendanceStore', () => store)
    vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn() }))
    vi.stubGlobal('useRoute', () => ({ query: {} }))

    render(AttendanceScreen, {
      global: { components: screenComponents },
    })

    expect(await screen.findByRole('heading', {
      name: '当前范围没有可录考勤的工人',
    })).not.toBeNull()
    expect(screen.getByText(/本页不会临时创建名册关系/)).not.toBeNull()
    expect(screen.getByRole('link', { name: '查看工人名册' })).not.toBeNull()
  })

  it('initializes from payroll query, clears facts on scope change, and preserves return status', async () => {
    const store = createScreenStore({
      projects: [
        { id: 'project-a', name: '项目甲', crewId: null },
        { id: 'project-b', name: '项目乙', crewId: null },
      ],
      crews: [{ id: 'crew-a', name: '泥水班', crewId: null }],
      workers,
    })
    vi.stubGlobal('useAttendanceStore', () => store)
    vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn() }))
    vi.stubGlobal('useRoute', () => ({
      query: {
        project: 'project-a',
        month: '2026-05',
        crew: 'crew-a',
        status: 'released',
      },
    }))

    render(AttendanceScreen, {
      global: { components: screenComponents },
    })

    expect(store.filters).toEqual({
      projectId: 'project-a',
      month: '2026-05',
      crewId: 'crew-a',
    })
    expect(store.load).toHaveBeenCalledWith({ clearFacts: true })
    await nextTick()
    expect(screen.getByRole('link', { name: '工资核算' }).getAttribute('href')).toBe(
      '/subcontract/payroll?project=project-a&month=2026-05&crew=crew-a&status=released',
    )

    await fireEvent.update(screen.getByLabelText('月份'), '2026-06')
    expect(store.load).toHaveBeenLastCalledWith({ clearFacts: true })
    expect(screen.getByRole('link', { name: '工资核算' }).getAttribute('href')).toBe(
      '/subcontract/payroll?project=project-a&month=2026-06&crew=crew-a&status=released',
    )
  })
})
