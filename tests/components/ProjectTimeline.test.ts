import { fireEvent, render, screen, within } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import ProjectTimeline from '~/components/project/ProjectTimeline.vue'

const load = vi.fn().mockResolvedValue(undefined)

vi.stubGlobal('usePhaseTaskStore', () => ({
  byProject: () => [],
  load,
  saveProject: vi.fn().mockResolvedValue([]),
  undoSave: vi.fn().mockResolvedValue(undefined),
}))
vi.stubGlobal('useKitUI', () => ({
  undoToast: vi.fn(),
  error: vi.fn(),
}))

describe('项目阶段时间线', () => {
  beforeEach(() => load.mockClear())

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
    expect(within(flow).getAllByRole('listitem')).toHaveLength(6)

    const firstPhase = within(flow).getByRole('button', { name: /查看项目立项任务/ })
    expect(firstPhase.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: '项目立项阶段任务' })).not.toBeNull()

    await fireEvent.click(firstPhase)
    expect(firstPhase.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: '项目立项阶段任务' })).toBeNull()
    expect(load).toHaveBeenCalled()
  })
})
