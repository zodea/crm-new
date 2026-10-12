import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
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

  it('emits browser-selected file metadata and resets the input', async () => {
    const wrapper = mount(FileRefAttachmentSection, {
      props: {
        attachments: [attachment(null)],
        pendingAttachments: [],
        pendingRemoveIds: [],
        pendingRestoreIds: [],
        note: '',
      },
      global: { components: { SectionHeader } },
    })
    const input = wrapper.get<HTMLInputElement>('[data-testid="finance-attachment-input"]')
    const file = new File(['receipt'], '回单.pdf', { type: 'application/pdf' })
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    })
    await input.trigger('change')
    expect(wrapper.emitted('files')?.[0]?.[0]).toEqual([file])
    expect(input.element.value).toBe('')
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
