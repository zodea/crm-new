import type { DeliveryRecordSourceFile } from '~/stores/delivery-record'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { useObjectUrl } from '@vueuse/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onActivated, shallowRef, watch } from 'vue'
import DeliveryRecordSourcePanel from '~/components/delivery/DeliveryRecordSourcePanel.vue'

const picker = vi.hoisted(() => ({ open: vi.fn(), picked: undefined as ((files: FileList) => unknown) | undefined }))
vi.mock('@vueuse/core', async () => ({
  ...await vi.importActual('@vueuse/core'),
  useFileDialog: () => ({ open: picker.open, onChange: (callback: typeof picker.picked) => { picker.picked = callback } }),
}))

const loadSourceFile = vi.fn()
const saveSourceFile = vi.fn()
const exportFile = vi.fn()
const error = vi.fn()
const warning = vi.fn()
const source: DeliveryRecordSourceFile & { assetId: string } = { assetId: 'original-asset', fileName: '完整原件.pdf', mimeType: 'application/pdf', fileSize: 4, bytes: new Uint8Array([1, 2, 3, 4]) }
const KitButton = defineComponent({
  props: { disabled: Boolean, loading: Boolean },
  setup: (props, { slots }) => () => h('button', { disabled: props.disabled || props.loading }, slots.default?.()),
})
function mount(props: { recordId: string, assetId?: string | null, readOnly?: boolean } = { recordId: 'delivery-1' }) {
  return render(DeliveryRecordSourcePanel, { props, global: { components: { KitButton } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  loadSourceFile.mockReset().mockResolvedValue(source)
  saveSourceFile.mockReset()
  exportFile.mockReset().mockResolvedValue({ status: 'cancelled' })
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onActivated', onActivated)
  vi.stubGlobal('useObjectUrl', useObjectUrl)
  vi.stubGlobal('useFileDialog', () => ({ open: picker.open, onChange: (callback: typeof picker.picked) => {
    picker.picked = callback
  } }))
  vi.stubGlobal('useDeliveryRecordStore', () => ({
    canWrite: true,
    sourceVersion: '1',
    byId: () => ({ version: '3' }),
    loadSourceFile,
    saveSourceFile,
  }))
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn().mockResolvedValue(true), success: vi.fn(), error, warning, exportFile }))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:delivery'), revokeObjectURL: vi.fn() })
})

describe('送货原件读写边界', () => {
  it('切换记录立即撤下旧原件，取消旧读取，迟到结果不能覆盖新记录', async () => {
    const view = mount()
    await flushPromises()
    expect(screen.getByTitle('完整原件.pdf 原始 PDF')).toBeTruthy()
    let resolve!: (value: DeliveryRecordSourceFile) => void
    loadSourceFile.mockImplementationOnce(() => new Promise<DeliveryRecordSourceFile>((done) => {
      resolve = done
    }))
    await view.rerender({ recordId: 'delivery-2' })
    expect(screen.queryByTitle('完整原件.pdf 原始 PDF')).toBeNull()
    expect(screen.queryByText('完整原件.pdf')).toBeNull()
    const delayedOptions = loadSourceFile.mock.calls.at(-1)![1]
    await view.rerender({ recordId: 'delivery-3' })
    await flushPromises()
    expect(delayedOptions.signal.aborted).toBe(true)
    resolve({ ...source, fileName: '迟到的第二份.pdf' })
    await flushPromises()
    expect(screen.queryByText('迟到的第二份.pdf')).toBeNull()
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('历史版明确无原件时不借用当前原件，历史版始终只读', async () => {
    mount({ recordId: 'delivery-1', assetId: null, readOnly: true })
    await flushPromises()
    expect(loadSourceFile).not.toHaveBeenCalled()
    expect(screen.getByTestId('delivery-source-empty')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /补传|替换|选择其他/ })).toBeNull()
  })

  it('替换必须填写原因并提交初始版本，保存失败保留文件与原因', async () => {
    mount()
    await flushPromises()
    const replacement = new File(['%PDF-1.7'], '补正.pdf', { type: 'application/pdf' })
    await picker.picked?.([replacement] as unknown as FileList)
    await flushPromises()
    expect(saveSourceFile).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '确认保存原件' }))
    expect(saveSourceFile).not.toHaveBeenCalled()
    await fireEvent.update(screen.getByRole('textbox', { name: /原件修订原因/ }), '补充清晰扫描页')
    saveSourceFile.mockRejectedValueOnce(new Error('当前原件已更新'))
    await fireEvent.click(screen.getByRole('button', { name: '确认保存原件' }))
    await flushPromises()
    expect(saveSourceFile.mock.calls.map(args => [args[0], args[1] === replacement, args[2], args[3]])).toEqual([['delivery-1', true, '补充清晰扫描页', '3']])
    expect(error).toHaveBeenCalledWith('当前原件已更新')
    expect((screen.getByRole('textbox', { name: /原件修订原因/ }) as HTMLTextAreaElement).value).toBe('补充清晰扫描页')
    expect(screen.getByText('补正.pdf')).toBeTruthy()
  })

  it('下载先交统一保存入口，用户取消选目录时不再次读取正文', async () => {
    mount()
    await flushPromises()
    loadSourceFile.mockClear()
    await fireEvent.click(screen.getByRole('button', { name: '下载原件' }))
    await flushPromises()
    expect(exportFile).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Function), defaultName: '完整原件.pdf', signal: expect.any(AbortSignal) }))
    expect(loadSourceFile).not.toHaveBeenCalled()
  })

  it('目录选择期间当前原件变化，下载仍核验点击时的资产且名称与字节一致', async () => {
    mount()
    await flushPromises()
    let proceed!: () => void
    let downloaded: Uint8Array | undefined
    exportFile.mockImplementationOnce(async (options: { data: () => Promise<Uint8Array> }) => {
      await new Promise<void>((resolve) => {
        proceed = resolve
      })
      downloaded = await options.data()
      return { status: 'exported' }
    })
    await fireEvent.click(screen.getByRole('button', { name: '下载原件' }))
    loadSourceFile.mockImplementation(async (_id, options) => options.assetId === source.assetId ? source : { ...source, assetId: 'replacement', fileName: '新原件.pdf', bytes: new Uint8Array([9]) })
    proceed()
    await flushPromises()
    expect(loadSourceFile).toHaveBeenLastCalledWith('delivery-1', expect.objectContaining({ assetId: 'original-asset' }))
    expect(downloaded).toEqual(source.bytes)
  })

  it('从当前原件切到无原件历史再返回，不保留上一身份的待补传草稿', async () => {
    const view = mount()
    await flushPromises()
    await picker.picked?.([new File(['%PDF-1.7'], '未保存原件.pdf', { type: 'application/pdf' })] as unknown as FileList)
    await flushPromises()
    expect(screen.getByText('未保存原件.pdf')).toBeTruthy()
    await view.rerender({ recordId: 'delivery-1', assetId: null, readOnly: true })
    await view.rerender({ recordId: 'delivery-1', assetId: undefined, readOnly: false })
    await flushPromises()
    expect(screen.queryByText('未保存原件.pdf')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认保存原件' })).toBeNull()
  })
})
