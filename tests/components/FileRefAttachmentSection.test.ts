import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import FileRefAttachmentSection from '~/components/shared/FileRefAttachmentSection.vue'

const SectionHeader = defineComponent({
  props: { title: { type: String, required: true } },
  template: '<h2>{{ title }}</h2>',
})

function attachment(deletedAt: string | null) {
  return {
    id: 'file-real-id',
    ownerType: 'payment_application',
    ownerId: 'application-real-id',
    fileName: '付款申请.pdf',
    filePath: 'C:\\finance\\付款申请.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    category: '申请附件',
    uploader: '',
    uploadedAt: '2026-07-25T09:00:00.000Z',
    deletedAt,
  }
}

describe('fileRefAttachmentSection restore flow', () => {
  it('surfaces deleted file refs and emits a restore toggle for the real ID', async () => {
    const wrapper = mount(FileRefAttachmentSection, {
      props: {
        attachments: [attachment('2026-07-25T10:00:00.000Z')],
        pendingAttachments: [],
        pendingRemoveIds: [],
        pendingRestoreIds: [],
        note: '',
      },
      global: { components: { SectionHeader } },
    })

    expect(wrapper.text()).toContain('已删除')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('toggleExisting')).toEqual([['file-real-id']])
  })

  it('emits multiple browser-selected files and resets the input', async () => {
    const wrapper = mount(FileRefAttachmentSection, {
      props: {
        attachments: [attachment(null)],
        pendingAttachments: [],
        pendingRemoveIds: [],
        pendingRestoreIds: [],
        note: '',
        pickerDescription: '文件随资料一同保存',
      },
      global: { components: { SectionHeader } },
    })
    const input = wrapper.get<HTMLInputElement>('[data-testid="finance-attachment-input"]')
    expect(input.element.multiple).toBe(true)
    expect(input.element.closest('label')?.textContent).toContain('文件随资料一同保存')
    const files = [
      new File(['receipt'], '回单.pdf', { type: 'application/pdf' }),
      new File(['supplement'], '补充说明.pdf', { type: 'application/pdf' }),
    ]
    Object.defineProperty(input.element, 'files', { configurable: true, value: files })
    const setValue = vi.spyOn(input.element, 'value', 'set')
    await input.trigger('change')
    expect(wrapper.emitted('files')).toEqual([[files]])
    expect(setValue).toHaveBeenCalledWith('')
  })

  it('只读模式保留附件内容但隐藏全部变更入口', () => {
    const wrapper = mount(FileRefAttachmentSection, {
      props: {
        attachments: [attachment(null)],
        pendingAttachments: [{
          localId: 'pending-file-323',
          fileName: '未上传依据.pdf',
          filePath: '',
          fileSize: 323,
          mimeType: 'application/pdf',
          category: '变更依据',
          uploader: '',
        }],
        pendingRemoveIds: [],
        pendingRestoreIds: [],
        note: '仅供复制',
        readonly: true,
      },
      global: { components: { SectionHeader } },
    })

    expect(wrapper.find('[data-testid="finance-attachment-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('付款申请.pdf')
    expect(wrapper.text()).toContain('未上传依据.pdf')
    expect((wrapper.get('input[aria-label="附件分类"]').element as HTMLInputElement).value).toBe('变更依据')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('仅供复制')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('input[aria-label="附件分类"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  })

  it('受控分类模式显示 canonical 分类但不允许改写', () => {
    const wrapper = mount(FileRefAttachmentSection, {
      props: {
        attachments: [],
        pendingAttachments: [{
          localId: 'pending-acceptance-324',
          fileName: '验收报告.pdf',
          filePath: '',
          fileSize: 324,
          mimeType: 'application/pdf',
          category: 'acceptance-report',
          uploader: '',
        }],
        pendingRemoveIds: [],
        pendingRestoreIds: [],
        note: '',
        categoryReadonly: true,
      },
      global: { components: { SectionHeader } },
    })

    expect(wrapper.get('input[aria-label="附件分类"]').attributes('readonly')).toBeDefined()
  })
})
