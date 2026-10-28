import { mount } from '@vue/test-utils'
import { useObjectUrl } from '@vueuse/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, onScopeDispose, shallowReactive, shallowRef, watch } from 'vue'
import { useDeliveryRecognitionWorkspace } from '~/composables/useDeliveryRecognitionWorkspace'

function setup() {
  const pending = new Map<string, (file: File) => void>()
  const activeUrls = new Map<string, File>()
  let urlSequence = 0
  const OriginalURL = URL
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL(file: File) {
      const url = `blob:test-${++urlSequence}`
      activeUrls.set(url, file)
      return url
    }

    static revokeObjectURL(url: string) {
      activeUrls.delete(url)
    }
  })
  const duplicates = shallowRef([{ id: 'a', kind: 'pdf' }, { id: 'b', kind: 'pdf' }])
  const store = {
    duplicates,
    files: [],
    loadPendingPrintQueue: vi.fn().mockResolvedValue(undefined),
    loadDuplicateFile: (id: string) => new Promise<File>(resolve => pending.set(id, resolve)),
    loadDuplicateRepresentativeFile: async (id: string) => new File([id], `${id}-source.pdf`),
  }
  const globals = {
    computed,
    shallowRef,
    shallowReactive,
    watch,
    onMounted,
    onBeforeUnmount,
    onScopeDispose,
    useObjectUrl,
    useDeliveryStore: () => store,
    useDeliveryRecordStore: () => ({ origin: 'real', canWrite: true, list: [], context: { projects: [], suppliers: [] }, load: vi.fn().mockResolvedValue(undefined) }),
    useSupplierCommandStore: () => ({}),
    useKitUI: () => ({ confirm: vi.fn(), promise: vi.fn(), warning: vi.fn() }),
    useFileDialog: () => ({ open: vi.fn(), onChange: vi.fn() }),
    useDropZone: () => ({ isOverDropZone: shallowRef(false) }),
  }
  for (const [key, value] of Object.entries(globals))
    vi.stubGlobal(key, value)
  let workspace!: ReturnType<typeof useDeliveryRecognitionWorkspace>
  const wrapper = mount(defineComponent({
    setup() {
      workspace = useDeliveryRecognitionWorkspace(shallowRef(null))
      return () => h('div')
    },
  }))
  async function finish(id: string) {
    pending.get(id)!(new File([id], `${id}.pdf`))
    // Allow both the parallel file reads and Vue's URL watchers to settle.
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
  }
  return { workspace, wrapper, finish, activeUrls, duplicates }
}

afterEach(() => vi.unstubAllGlobals())

describe('送货单重复对照预览', () => {
  it('过期请求不结束当前加载，后选文件始终胜出，卸载后释放全部 URL', async () => {
    const { workspace, wrapper, finish, activeUrls } = setup()
    try {
      const latest = workspace.selectDuplicate('b')
      await finish('a')
      expect(workspace.duplicateLoading.value).toBe(true)
      expect(workspace.duplicatePreview.value).toBeNull()
      await finish('b')
      await latest
      expect(activeUrls.get(workspace.duplicatePreview.value!.duplicateUrl)?.name).toBe('b.pdf')
      expect(activeUrls.size).toBe(2)
    }
    finally {
      wrapper.unmount()
    }
    expect(activeUrls.size).toBe(0)
  })

  it('较早请求最后完成时不能覆盖当前预览或遗留地址', async () => {
    const { workspace, wrapper, finish, activeUrls } = setup()
    try {
      const latest = workspace.selectDuplicate('b')
      await finish('b')
      await latest
      await finish('a')
      expect(activeUrls.get(workspace.duplicatePreview.value!.duplicateUrl)?.name).toBe('b.pdf')
      expect(activeUrls.size).toBe(2)
    }
    finally {
      wrapper.unmount()
    }
    expect(activeUrls.size).toBe(0)
  })

  it.each(['unmount', 'empty'] as const)('请求途中 %s 后不再创建预览', async (action) => {
    const { workspace, wrapper, finish, activeUrls, duplicates } = setup()
    try {
      if (action === 'unmount')
        wrapper.unmount()
      else
        duplicates.value = []
      await nextTick()
      await finish('a')
      expect(workspace.duplicatePreview.value).toBeNull()
      expect(workspace.duplicateLoading.value).toBe(false)
      expect(activeUrls.size).toBe(0)
    }
    finally {
      if (action !== 'unmount')
        wrapper.unmount()
    }
  })
})
