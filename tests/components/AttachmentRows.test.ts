import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ContractAttachmentSection from '~/components/contract/ContractAttachmentSection.vue'
import MasterDataAttachmentSection from '~/components/master-data/MasterDataAttachmentSection.vue'
import FileRefAttachmentSection from '~/components/shared/FileRefAttachmentSection.vue'

const global = {
  components: { SectionHeader: defineComponent({ props: ['title'], template: '<h2>{{ title }}</h2>' }) },
}
const storedFile = {
  id: 'real-original',
  ownerId: 'real-owner',
  fileName: '原件.pdf',
  filePath: '',
  fileSize: 24,
  mimeType: 'application/pdf',
  category: '',
  uploader: '',
  uploadedAt: '2026-10-11T01:00:00Z',
  deletedAt: null,
}
const draftFile = { localId: 'pending-original', fileName: '待存原件.pdf', category: '待核对' }

describe('附件编辑区共享行', () => {
  it('文件引用在只读状态保留下载按钮引用，待删后撤下下载并显示撤销状态', async () => {
    const wrapper = mount(FileRefAttachmentSection, {
      global,
      props: {
        attachments: [{ ...storedFile, ownerType: 'payment_application' }],
        pendingAttachments: [draftFile],
        pendingRemoveIds: [],
        pendingRestoreIds: [],
        note: '',
        canDownload: true,
        readonly: true,
      },
    })
    expect(wrapper.text()).toContain('未分类')
    const trigger = wrapper.get('button[aria-label="下载原件 原件.pdf"]')
    expect(wrapper.findAll('button')).toHaveLength(1)
    await trigger.trigger('click')
    expect(wrapper.emitted('download')).toEqual([[storedFile.id, trigger.element]])
    await wrapper.setProps({ readonly: false })
    const category = wrapper.get('input[aria-label="附件分类"]')
    expect(category.classes()).toContain('w-36')
    await category.setValue('支付依据')
    expect(wrapper.emitted('patchPending')).toEqual([[draftFile.localId, { category: '支付依据' }]])

    await wrapper.setProps({ pendingRemoveIds: [storedFile.id] })
    expect(wrapper.find('button[aria-label="下载原件 原件.pdf"]').exists()).toBe(false)
    const undo = wrapper.findAll('button').find(button => button.text() === '撤销删除')!
    expect(undo.classes()).toContain('text-danger')
    expect(undo.element.parentElement?.classList.contains('bg-danger-soft')).toBe(true)
    await undo.trigger('click')
    expect(wrapper.emitted('toggleExisting')).toEqual([[storedFile.id]])
  })

  it('合同保留待恢复样式、禁用控制和提交给上层的分类补丁', async () => {
    const wrapper = mount(ContractAttachmentSection, {
      global,
      props: {
        attachments: [{ ...storedFile, ownerType: 'contract', deletedAt: '2026-10-12T01:00:00Z' }],
        pendingAttachments: [draftFile],
        pendingRemoveIds: [],
        pendingRestoreIds: [storedFile.id],
        filesDisabled: true,
        note: '',
      },
    })
    expect(wrapper.text()).toContain('已删除')
    const restore = wrapper.findAll('button').find(button => button.text() === '取消恢复')!
    const remove = wrapper.findAll('button').find(button => button.text() === '移除')!
    const picker = wrapper.get<HTMLInputElement>('input[type="file"]')
    const category = wrapper.get('input[aria-label="附件分类"]')
    expect(restore.classes()).toContain('text-brand')
    expect(restore.element.parentElement?.classList.contains('bg-brand-soft')).toBe(true)
    expect(restore.attributes('disabled')).toBeDefined()
    expect(remove.attributes('disabled')).toBeDefined()
    expect(picker.element.disabled).toBe(true)
    expect(category.attributes('disabled')).toBeDefined()
    expect(category.classes()).toContain('w-36')
    expect(wrapper.find('button[aria-label="下载原件 原件.pdf"]').exists()).toBe(false)
    await restore.trigger('click')
    expect(wrapper.emitted('toggleExisting')).toBeUndefined()

    await wrapper.setProps({ filesDisabled: false })
    expect(picker.element.disabled).toBe(false)
    await restore.trigger('click')
    await remove.trigger('click')
    await category.setValue('变更依据')
    expect(wrapper.emitted('toggleExisting')).toEqual([[storedFile.id]])
    expect(wrapper.emitted('removePending')).toEqual([[draftFile.localId]])
    expect(wrapper.emitted('patchPending')).toEqual([[draftFile.localId, { category: '变更依据' }]])
  })

  it('主档保留待删文件的下载和完整记录参数，分类以原字符串传出', async () => {
    const wrapper = mount(MasterDataAttachmentSection, {
      global,
      props: {
        attachments: [{ ...storedFile, ownerType: 'customer' }],
        pendingAttachments: [draftFile],
        pendingRemoveIds: [storedFile.id],
        pendingRestoreIds: [],
        filesDisabled: true,
        storesOriginals: true,
        title: '资料附件',
      },
    })
    const trigger = wrapper.get('button[aria-label="下载原件 原件.pdf"]')
    expect(trigger.attributes('disabled')).toBeUndefined()
    await trigger.trigger('click')
    expect(wrapper.emitted('download')?.[0]?.[0]).toBe(wrapper.props('attachments')[0])
    const category = wrapper.get('input[aria-label="附件分类"]')
    expect(wrapper.get<HTMLInputElement>('input[type="file"]').element.disabled).toBe(true)
    expect(category.classes()).toContain('w-32')
    expect(category.attributes('disabled')).toBeDefined()
    await wrapper.setProps({ filesDisabled: false })
    await category.setValue('客户资料')
    expect(wrapper.emitted('updatePendingCategory')).toEqual([[draftFile.localId, '客户资料']])
  })
})
