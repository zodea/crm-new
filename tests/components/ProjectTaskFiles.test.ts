import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectTaskFiles from '~/components/project/ProjectTaskFiles.vue'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}))

const task = {
  id: '',
  projectId: 'project-1',
  phaseIndex: 1,
  taskIndex: 0,
  title: '施工组织设计方案',
  description: '归档',
  responsible: '资料员',
  status: 'pending' as const,
}
const projectTasks = [
  task,
  {
    ...task,
    taskIndex: 1,
    title: '开工报告及开工令',
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('project task files public behavior', () => {
  it('uploads browser content through the complete default task set', async () => {
    const addFiles = vi.fn().mockResolvedValue([])
    vi.stubGlobal('usePhaseTaskStore', () => ({
      files: [],
      addFiles,
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      undoToast: vi.fn(),
      warning: vi.fn(),
    }))
    vi.stubGlobal('useFileRefAccess', () => ({
      preview: vi.fn(),
      download: vi.fn(),
    }))

    const wrapper = mount(ProjectTaskFiles, {
      props: { task, projectTasks },
    })
    const input = wrapper.get<HTMLInputElement>('input[type="file"]')
    const file = new File(['phase-content'], '施工组织设计.pdf', {
      type: 'application/pdf',
    })
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    })

    await input.trigger('change')
    await flushPromises()

    expect(addFiles).toHaveBeenCalledOnce()
    expect(addFiles.mock.calls[0]?.[0]).toEqual(task)
    expect(addFiles.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        fileName: '施工组织设计.pdf',
        fileSize: 13,
        mimeType: 'application/pdf',
        payloadBase64: expect.any(String),
      }),
    ])
    expect(addFiles.mock.calls[0]?.[2]).toEqual(projectTasks)
  })
})
