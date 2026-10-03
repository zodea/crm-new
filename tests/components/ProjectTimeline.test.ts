import type { PhaseTask } from '~/stores/phase-task'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref, watch } from 'vue'
import ProjectPhaseEditor from '~/components/project/ProjectPhaseEditor.vue'
import ProjectTimeline from '~/components/project/ProjectTimeline.vue'

const load = vi.fn().mockResolvedValue(undefined)

describe('项目阶段时间线', () => {
  beforeEach(() => {
    load.mockClear()
    vi.stubGlobal('usePhaseTaskStore', () => ({ byProject: () => [], load, saveProject: vi.fn().mockResolvedValue([]), undoSave: vi.fn() }))
    vi.stubGlobal('useKitUI', () => ({ undoToast: vi.fn(), error: vi.fn() }))
  })

  it('用六个紧凑阶段节点表达流程，并保留任务展开行为', async () => {
    render(ProjectTimeline, {
      props: { projectId: 'project-1' },
      global: {
        components: {
          ProjectTaskFiles: defineComponent({ template: '<span>任务文件</span>' }),
          ProjectPhaseEditor: defineComponent({
            props: ['open', 'projectId', 'tasks'],
            emits: ['update:open', 'save'],
            template: '<div />',
          }),
        },
      },
    })

    const flow = screen.getByRole('list', { name: '项目六阶段流程' })
    expect(within(flow).getAllByRole('button').map(button => button.getAttribute('aria-label')?.split('，')[0])).toEqual([
      '查看项目立项任务',
      '查看施工准备任务',
      '查看施工中任务',
      '查看完工及验收任务',
      '查看交付任务',
      '查看保修任务',
    ])

    const firstPhase = within(flow).getByRole('button', { name: /查看项目立项任务/ })
    expect(firstPhase.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: '项目立项阶段任务' })).not.toBeNull()

    await fireEvent.click(firstPhase)
    expect(firstPhase.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: '项目立项阶段任务' })).toBeNull()
    expect(load).toHaveBeenCalled()
  })

  it.each([
    { phaseIndex: 1, phaseName: '施工准备', status: 'confirmed', title: ' 材料样板已核 ', expectedTitle: '材料样板已核', expectedProgress: '1/1' },
    { phaseIndex: 2, phaseName: '施工中', status: 'uploaded', title: ' 隐蔽验收资料 ', expectedTitle: '隐蔽验收资料', expectedProgress: '1/1' },
    { phaseIndex: 5, phaseName: '保修', status: 'pending', title: ' 保修回访记录 ', expectedTitle: '保修回访记录', expectedProgress: '0/1' },
  ] as const)('$phaseName 编辑 $status 经过统一保存，重新打开读取已保存内容', async ({ phaseIndex, phaseName, status, title, expectedTitle, expectedProgress }) => {
    const original: PhaseTask = { id: 'task-edited', projectId: 'project-edit', phaseIndex, taskIndex: 0, title: '原阶段资料', description: '', responsible: '资料员', status: 'pending' }
    const tasks = ref<PhaseTask[]>([original])
    const saveProject = vi.fn(async (_projectId: string, next: PhaseTask[]) => {
      tasks.value = next
      return ['phase-save-log']
    })
    const undoToast = vi.fn()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('usePhaseTaskStore', () => ({ byProject: () => tasks.value, load, saveProject, undoSave: vi.fn() }))
    vi.stubGlobal('useKitUI', () => ({ undoToast, error: vi.fn(), warning: vi.fn() }))
    const FormDialog = defineComponent({
      props: ['open', 'title', 'saveLabel'],
      emits: ['save', 'cancel'],
      template: '<section v-if="open" role="dialog" :aria-label="title"><slot /><button @click="$emit(\'save\')">{{ saveLabel }}</button></section>',
    })
    render(ProjectTimeline, {
      props: { projectId: 'project-edit' },
      global: { components: { ProjectPhaseEditor, FormDialog, ProjectTaskFiles: defineComponent({ template: '<span>任务文件</span>' }) } },
    })
    await fireEvent.click(screen.getByRole('button', { name: '编辑阶段', exact: true }))
    const editor = screen.getByRole('dialog', { name: '编辑阶段任务 · 全部六阶段' })
    await fireEvent.update(within(editor).getByRole('textbox', { name: '任务名称 *' }), title)
    await fireEvent.update(within(editor).getByRole('combobox', { name: '状态' }), status)
    await fireEvent.click(within(editor).getByRole('button', { name: '保存阶段任务', exact: true }))
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledWith('project-edit', [{ ...original, title: expectedTitle, status }]))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: `查看${phaseName}任务，已完成 ${expectedProgress}`, exact: true })).not.toBeNull()
    expect(undoToast).toHaveBeenCalledWith('阶段任务已更新', expect.any(Function))
    await fireEvent.click(screen.getByRole('button', { name: '编辑阶段', exact: true }))
    expect((screen.getByRole('textbox', { name: '任务名称 *' }) as HTMLInputElement).value).toBe(expectedTitle)
    expect((screen.getByRole('combobox', { name: '状态' }) as HTMLSelectElement).value).toBe(status)
  })
})
