import { fireEvent, within } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { contractStages } from '~/lib/contract/detail'
import ContractDetailDocuments from '~/pages/contract/_components/ContractDetailDocuments.vue'
import ContractDetailFiles from '~/pages/contract/_components/ContractDetailFiles.vue'
import ContractLifecycle from '~/pages/contract/_components/ContractLifecycle.vue'

const preview = vi.fn()
const download = vi.fn()

const SectionHeader = defineComponent({
  props: ['title', 'subtitle'],
  template: '<header><h2>{{ title }}</h2><p>{{ subtitle }}</p></header>',
})

const StatePanel = defineComponent({
  props: ['title', 'description'],
  template: '<div role="status" :aria-label="title">{{ title }} {{ description }}</div>',
})

const KitTable = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    return () => h('div', { 'data-testid': 'table-stub' }, (props.data ?? []).map((row: unknown) =>
      h('div', [
        slots.no?.({ row }),
        slots.name?.({ row }),
        slots.amount?.({ row }),
        slots.status?.({ row }),
      ]),
    ))
  },
})

const global = {
  components: {
    KitTable,
    SectionHeader,
    StatePanel,
  },
  stubs: {
    NuxtLink: {
      props: ['to'],
      template: '<a :href="to"><slot /></a>',
    },
  },
}

describe('contract detail sections', () => {
  beforeAll(() => {
    vi.stubGlobal('useFileRefAccess', () => ({ preview, download }))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    { status: '草稿', current: '拟定' },
    { status: '审批中', current: '审批与签订' },
    { status: '履约中', current: '履约' },
    { status: '已结算', current: '结算' },
    { status: '已结清', current: '结清' },
  ])('合同状态 $status 为 $current 节点设置 aria-current', ({ status, current }) => {
    const wrapper = mount(ContractLifecycle, {
      props: { stages: contractStages(status) },
      global,
    })

    expect(wrapper.get('[aria-current="step"]').text()).toContain(current)
    expect(wrapper.findAll('li').map(item => item.get('span[title]').text())).toEqual(['拟定', '审批与签订', '履约', '结算', '结清'])
    wrapper.unmount()
  })

  it('关联单据展示真实下钻；无数据时展示明确空态', () => {
    const wrapper = mount(ContractDetailDocuments, {
      props: {
        rows: [{
          id: 'change-a',
          group: '甲方变洽签',
          no: 'BG-001',
          name: '现场签证',
          amount: 120,
          date: '2026-06-01',
          status: 'approved',
          to: '/owner/change/change-a',
        }],
      },
      global,
    })
    expect(wrapper.get('a').attributes('href')).toBe('/owner/change/change-a')
    expect(wrapper.text()).toContain('BG-001')
    expect(wrapper.text()).toContain('现场签证')

    const empty = mount(ContractDetailDocuments, {
      props: { rows: [] },
      global,
    })
    expect(empty.get('[role="status"]').attributes('aria-label')).toBe('暂无关联单据')
  })

  it('合同文件只对真实文件引用提供预览和下载动作', async () => {
    const file = {
      id: 'file-a',
      ownerType: 'contract',
      ownerId: 'contract-a',
      fileName: '正式合同.pdf',
      filePath: '',
      fileSize: 2048,
      mimeType: 'application/pdf',
      category: '正式合同',
      uploader: '经办人',
      uploadedAt: '2026-07-30',
      deletedAt: null,
    }
    const wrapper = mount(ContractDetailFiles, {
      props: { files: [file] },
      global,
    })

    const files = within(wrapper.element as HTMLElement)
    await fireEvent.click(files.getByRole('button', { name: '预览' }))
    await fireEvent.click(files.getByRole('button', { name: '下载' }))
    expect(preview).toHaveBeenCalledWith(file)
    expect(download).toHaveBeenCalledWith(file)
    expect(wrapper.text()).toContain('2.0 KB')
  })
})
