import type { ReceiptFileContent } from '../../app/lib/receipt/contract'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import { useReceiptFiles } from '../../app/composables/useReceiptFiles'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { command, references, session } from '../receipt/fixtures'

describe('收款附件预览与下载生命周期', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:${crypto.randomUUID()}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  function fixture() {
    const commands = createReceiptCommandTestInstance({ references: () => references })
    const saved = commands.execute(command({ attachments: { add: [{ fileName: 'a.txt', fileSize: 1, payloadBase64: 'YQ==', mimeType: 'text/plain' }, { fileName: 'b.txt', fileSize: 1, payloadBase64: 'Yg==', mimeType: 'text/plain' }] } }), session)
    const record = shallowRef(commands.form(saved.id, session))
    const content = vi.fn(async (id: string, fileId: string) => commands.fileContent(id, fileId, session))
    const exporter = vi.fn(async () => ({ status: 'cancelled' as const }))
    let files!: ReturnType<typeof useReceiptFiles>
    const wrapper = mount(defineComponent({
      setup() {
        files = useReceiptFiles({
          record: () => record.value,
          repository: {
            fileContent: content,
          },
          exportFile: exporter,
        })
        return () => h('div')
      },
    }))
    return { commands, saved, record, content, exporter, files, wrapper }
  }

  it('取消旧读取后预览另一附件，迟到旧响应不会替换或撤销当前预览', async () => {
    const { files, content, record, commands, wrapper } = fixture()
    let resolveOld!: (value: ReceiptFileContent) => void
    content.mockImplementationOnce(() => new Promise(resolve => resolveOld = resolve))
    const old = files.preview(record.value.attachments[0]!)
    files.cancel()
    await files.preview(record.value.attachments[1]!)
    const currentUrl = files.previewUrl.value
    resolveOld(commands.fileContent(record.value.id, record.value.attachments[0]!.id, session))
    await old
    expect(files.previewUrl.value).toBe(currentUrl)
    expect(files.previewTitle.value).toBe('b.txt')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(currentUrl)
    files.cancel()
    await Promise.resolve()
    expect(files.previewOpen.value).toBe(false)
    wrapper.unmount()
  })

  it('正文在导出能力调用后惰性读取，取消保存不读取正文；记录版本变化取消预览', async () => {
    const { files, content, record, exporter, wrapper } = fixture()
    await files.download(record.value.attachments[0]!)
    expect(exporter).toHaveBeenCalledTimes(1)
    expect(content).not.toHaveBeenCalled()
    await files.preview(record.value.attachments[0]!)
    expect(files.previewOpen.value).toBe(true)
    record.value = { ...record.value, version: '2' }
    await Promise.resolve()
    expect(files.previewOpen.value).toBe(false)
    wrapper.unmount()
  })
})
